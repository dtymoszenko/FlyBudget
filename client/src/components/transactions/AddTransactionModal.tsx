import { useState, useRef, useEffect } from 'react';
import { format, isValid as isValidDate, parseISO } from 'date-fns';
import { MinusCircle, PlusCircle, ChevronDown } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { SavedOnDeviceHint } from '../connection/SavingPausedHint';
import { CurrencyInput } from '../ui/CurrencyInput';
import { AmountFields, useAmountValidity } from '../ui/amountValidity';
import { formatMoney } from '../../utils/currency';
import { useAccounts } from '../../hooks/useAccounts';
import { useAddTransaction } from '../../hooks/useOffline';
import { useAccountCurrency, useConverted } from '../../hooks/useCurrency';
import { MerchantSelect } from './MerchantSelect';
import { CategorySelectButton } from './CategorySelectButton';
import { AccountIcon } from '../accounts/AccountIcon';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const inputClass =
  'block w-full rounded-md border border-border px-3 py-2 text-sm text-text bg-surface placeholder-text-disabled focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600';

export function AddTransactionModal({ isOpen, onClose }: Props) {
  const [type, setType] = useState<'debit' | 'credit'>('debit');
  const [amount, setAmount] = useState(0);
  const [payeeName, setPayeeName] = useState('');
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [notes, setNotes] = useState('');
  // A transfer between currencies: the amount on the other account's side, in its currency.
  // Filled in at the day's rate until it's typed over (the bank's rate and fees differ).
  const [otherAmount, setOtherAmount] = useState(0);
  const [otherTyped, setOtherTyped] = useState(false);
  const currencyOf = useAccountCurrency();

  const accountRef = useRef<HTMLDivElement>(null);

  const { data: accounts = [] } = useAccounts();
  const newTx = useAddTransaction();

  const openAccounts = accounts.filter((a) => !a.closedAt);
  // The category list always ends with a transfer to each other account (issue #89), even
  // before the account is chosen
  const transferAccounts = openAccounts.filter((a) => a.id !== accountId);
  const transferToId = categoryId?.startsWith('transfer:')
    ? categoryId.slice('transfer:'.length)
    : null;
  // A transfer's own side can't be the account it goes to
  const accountChoices = openAccounts.filter((a) => a.id !== transferToId);
  const onBudgetAccounts = accountChoices.filter((a) => !a.isOffBudget);
  const offBudgetAccounts = accountChoices.filter((a) => a.isOffBudget);
  const selectedAccount = openAccounts.find((a) => a.id === accountId);
  const accountLabel = transferToId
    ? type === 'debit'
      ? 'From account'
      : 'To account'
    : 'Account';
  const ownCurrency = currencyOf(accountId || null);
  const otherCurrency = transferToId ? currencyOf(transferToId) : null;
  const crossCurrency = !!transferToId && !!accountId && ownCurrency !== otherCurrency;
  const otherName = openAccounts.find((a) => a.id === transferToId)?.name ?? 'the other account';
  const { data: converted } = useConverted(
    { from: ownCurrency, to: otherCurrency, date, amount },
    crossCurrency && !otherTyped,
  );
  useEffect(() => {
    if (crossCurrency && !otherTyped && converted?.amount != null) setOtherAmount(converted.amount);
  }, [crossCurrency, otherTyped, converted]);

  const hasConfirmedMerchant = payeeId !== null;
  const dateValid = date !== '' && /^\d{4}-\d{2}-\d{2}$/.test(date) && isValidDate(parseISO(date));
  // Text in the amount that isn't an amount: the amount from before would be saved
  const { allValid: amountValid, report } = useAmountValidity();
  const isValid =
    amount > 0 &&
    amountValid &&
    (!crossCurrency || otherAmount > 0) &&
    (hasConfirmedMerchant || transferToId !== null) &&
    dateValid &&
    accountId !== '';

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setShowAccountPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setType('debit');
      setAmount(0);
      setPayeeName('');
      setPayeeId(null);
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setAccountId('');
      setShowAccountPicker(false);
      setCategoryId(null);
      setNotes('');
      setOtherAmount(0);
      setOtherTyped(false);
    }
  }, [isOpen]);

  function chooseAccount(id: string) {
    setAccountId(id);
    setShowAccountPicker(false);
    // A transfer to the account just chosen would go nowhere
    if (categoryId === `transfer:${id}`) setCategoryId(null);
  }

  function handleSubmit() {
    if (!isValid) return;
    if (transferToId) {
      // A debit moves money out of this account, a credit brings it in. Between currencies,
      // each side's amount is in its own account's currency.
      const [sent, arrived] = type === 'debit' ? [amount, otherAmount] : [otherAmount, amount];
      newTx.add(
        {
          kind: 'transfer',
          data: {
            fromAccountId: type === 'debit' ? accountId : transferToId,
            toAccountId: type === 'debit' ? transferToId : accountId,
            date,
            amount: crossCurrency ? sent : amount,
            ...(crossCurrency ? { toAmount: arrived } : {}),
            notes: notes || null,
          },
        },
        onClose,
      );
      return;
    }
    const finalAmount = type === 'debit' ? -amount : amount;
    newTx.add(
      {
        kind: 'transaction',
        data: {
          accountId,
          date,
          amount: finalAmount,
          payeeId,
          payeeName,
          categoryId,
          notes: notes || null,
        },
      },
      onClose,
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add transaction" size="md">
      <AmountFields report={report}>
        <div className="space-y-5">
          {/* Debit / Credit toggle */}
          <div className="flex gap-1 bg-surface-alt rounded-lg p-1">
            <button
              type="button"
              onClick={() => setType('debit')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-md transition-all cursor-pointer ${
                type === 'debit'
                  ? 'bg-negative-subtle text-negative ring-1 ring-negative/20'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-hover'
              }`}
            >
              <MinusCircle size={15} />
              Debit
            </button>
            <button
              type="button"
              onClick={() => setType('credit')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-md transition-all cursor-pointer ${
                type === 'credit'
                  ? 'bg-positive-subtle text-positive ring-1 ring-positive/20'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-hover'
              }`}
            >
              <PlusCircle size={15} />
              Credit
            </button>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-text mb-1">Amount *</label>
            <CurrencyInput
              value={amount}
              onChange={setAmount}
              aria-label="Amount"
              currency={ownCurrency}
            />
          </div>

          {/* Between currencies: what the other account sees */}
          {crossCurrency && (
            <div>
              <label className="block text-sm font-medium text-text mb-1">
                {type === 'debit' ? 'Amount received' : 'Amount sent'} in {otherName} (
                {otherCurrency}) *
              </label>
              <CurrencyInput
                value={otherAmount}
                onChange={(v) => {
                  setOtherAmount(v);
                  setOtherTyped(true);
                }}
                aria-label={`Amount in ${otherCurrency}`}
                currency={otherCurrency}
              />
              <p className="mt-1 text-xs text-text-secondary">
                {otherTyped
                  ? 'As your bank shows it.'
                  : converted?.rate
                    ? `At the rate on ${converted.date} (${converted.rate}). Change it to what your bank shows.`
                    : `No rate for this day: type what ${type === 'debit' ? 'arrived' : 'was sent'}.`}
              </p>
            </div>
          )}

          {/* Merchant (a transfer has none: it's named after the other account) */}
          {!transferToId && (
            <div>
              <label className="block text-sm font-medium text-text mb-1">Merchant *</label>
              <MerchantSelect
                value={{ id: payeeId, name: payeeName }}
                onChange={(v) => {
                  setPayeeId(v.id);
                  setPayeeName(v.name);
                }}
              />
            </div>
          )}

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-text mb-1">Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Account */}
          <div>
            <label className="block text-sm font-medium text-text mb-1">{accountLabel} *</label>
            <div ref={accountRef} className="relative">
              <button
                type="button"
                onClick={() => setShowAccountPicker(!showAccountPicker)}
                className={`${inputClass} text-left flex items-center justify-between cursor-pointer`}
              >
                <span className="flex items-center gap-2 truncate">
                  {selectedAccount ? (
                    <>
                      <AccountIcon
                        name={selectedAccount.name}
                        type={selectedAccount.type}
                        logo={selectedAccount.logo}
                      />
                      <span className="text-text">{selectedAccount.name}</span>
                    </>
                  ) : (
                    <span className="text-text-disabled">Select account...</span>
                  )}
                </span>
                <ChevronDown size={14} className="text-text-tertiary shrink-0" />
              </button>
              {showAccountPicker && (
                <div
                  className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto origin-top animate-menu-in"
                  onClick={(e) => e.stopPropagation()}
                >
                  {onBudgetAccounts.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-xs font-medium text-text-tertiary bg-surface-alt">
                        On Budget
                      </div>
                      {onBudgetAccounts.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            chooseAccount(a.id);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-hover cursor-pointer ${
                            accountId === a.id ? 'bg-brand-50 text-brand-700' : 'text-text'
                          }`}
                        >
                          <AccountIcon name={a.name} type={a.type} logo={a.logo} />
                          <span className="truncate flex-1">{a.name}</span>
                          <span
                            className={`text-xs tabular-nums shrink-0 ${a.balance >= 0 ? 'text-text-tertiary' : 'text-negative'}`}
                          >
                            {formatMoney(a.balance, a.currency)}
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                  {offBudgetAccounts.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-xs font-medium text-text-tertiary bg-surface-alt">
                        Off Budget
                      </div>
                      {offBudgetAccounts.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            chooseAccount(a.id);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-hover cursor-pointer ${
                            accountId === a.id ? 'bg-brand-50 text-brand-700' : 'text-text'
                          }`}
                        >
                          <AccountIcon name={a.name} type={a.type} logo={a.logo} />
                          <span className="truncate flex-1">{a.name}</span>
                          <span
                            className={`text-xs tabular-nums shrink-0 ${a.balance >= 0 ? 'text-text-tertiary' : 'text-negative'}`}
                          >
                            {formatMoney(a.balance, a.currency)}
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-text mb-1">Category</label>
            <CategorySelectButton
              value={categoryId}
              onChange={setCategoryId}
              position="above"
              transferAccounts={transferAccounts}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-text mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add a note..."
              className={inputClass}
            />
          </div>

          {/* Footer */}
          <SavedOnDeviceHint className="text-right" />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="md"
              onClick={handleSubmit}
              disabled={!isValid || newTx.pending || !newTx.allowed}
            >
              {newTx.pending ? 'Adding...' : newTx.onDevice ? 'Save on device' : 'Add transaction'}
            </Button>
          </div>
        </div>
      </AmountFields>
    </Modal>
  );
}
