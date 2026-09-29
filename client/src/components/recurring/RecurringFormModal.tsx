import { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Input, Select } from '../ui/Input';
import { CurrencyInput } from '../ui/CurrencyInput';
import { MerchantSelect } from '../transactions/MerchantSelect';
import { CategorySelectButton } from '../transactions/CategorySelectButton';
import { useAccounts } from '../../hooks/useAccounts';
import { usePayees } from '../../hooks/usePayees';
import { useCanSave } from '../../hooks/useConnection';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import { format } from 'date-fns';
import {
  RECURRENCE_TYPE_LABELS,
  type Schedule,
  type RecurrenceType,
  type AmountType,
  type WeekendAdjust,
} from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  editItem?: Schedule | null;
}

const AMOUNT_TYPE_OPTIONS: { value: AmountType; label: string }[] = [
  { value: 'exact', label: 'Exact' },
  { value: 'approximate', label: 'Approx' },
  { value: 'variable', label: 'Variable' },
];

const WEEKEND_ADJUST_OPTIONS: { value: WeekendAdjust; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'before', label: 'Before weekend' },
  { value: 'after', label: 'After weekend' },
  { value: 'closest', label: 'Closest weekday' },
];

export default function RecurringFormModal({ isOpen, onClose, onSave, editItem }: Props) {
  const { data: accounts = [] } = useAccounts();
  const { data: payees = [] } = usePayees();
  const canSave = useCanSave();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState(0);
  const [isExpense, setIsExpense] = useState(true);
  const [amountType, setAmountType] = useState<AmountType>('exact');
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('monthly');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState('');
  const [weekendAdjust, setWeekendAdjust] = useState<WeekendAdjust>('none');
  const [dateFlexibility, setDateFlexibility] = useState(3);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [payeeValue, setPayeeValue] = useState<{ id: string | null; name: string }>({
    id: null,
    name: '',
  });
  const [notes, setNotes] = useState('');
  const [autoCreate, setAutoCreate] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (editItem) {
        setName(editItem.name);
        setAmount(Math.abs(editItem.amount));
        setIsExpense(editItem.amount < 0);
        setAmountType(editItem.amountType);
        setRecurrenceType(editItem.recurrenceType);
        setStartDate(editItem.startDate);
        setEndDate(editItem.endDate || '');
        setWeekendAdjust(editItem.weekendAdjust);
        setDateFlexibility(editItem.dateFlexibility);
        setAccountId(editItem.accountId || '');
        setCategoryId(editItem.categoryId || '');
        const matchedPayee = editItem.payeeId
          ? payees.find((p) => p.id === editItem.payeeId)
          : null;
        setPayeeValue({ id: editItem.payeeId, name: matchedPayee?.name || '' });
        setNotes(editItem.notes || '');
        setAutoCreate(Boolean(editItem.autoCreate));
        setShowAdvanced(editItem.weekendAdjust !== 'none' || editItem.dateFlexibility !== 3);
      } else {
        setName('');
        setAmount(0);
        setIsExpense(true);
        setAmountType('exact');
        setRecurrenceType('monthly');
        setStartDate(format(new Date(), 'yyyy-MM-dd'));
        setEndDate('');
        setWeekendAdjust('none');
        setDateFlexibility(3);
        setAccountId(accounts.length > 0 ? accounts[0].id : '');
        setCategoryId('');
        setPayeeValue({ id: null, name: '' });
        setNotes('');
        setAutoCreate(false);
        setShowAdvanced(false);
      }
    }
  }, [isOpen, editItem, accounts, payees]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const signedAmount = isExpense ? -Math.abs(amount) : Math.abs(amount);
    onSave({
      name,
      amount: signedAmount,
      amountType,
      recurrenceType,
      startDate,
      endDate: endDate || null,
      weekendAdjust,
      dateFlexibility,
      accountId: accountId || null,
      categoryId: categoryId || null,
      payeeId: payeeValue.id || null,
      notes: notes || null,
      autoCreate: autoCreate ? 1 : 0,
    });
  }

  const showWeekendAdjust =
    recurrenceType !== 'once' && recurrenceType !== 'weekly' && recurrenceType !== 'biweekly';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editItem ? 'Edit Recurring' : 'Add Recurring'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Name</label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Name"
            placeholder="e.g. Netflix, Rent, Paycheck…"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {amountType === 'variable' ? 'Estimated Amount' : 'Amount'}
            </label>
            <CurrencyInput value={amount} onChange={setAmount} aria-label="Amount" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Type</label>
            <div className="flex gap-1 mt-1">
              <button
                type="button"
                onClick={() => setIsExpense(true)}
                aria-pressed={isExpense}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                  isExpense
                    ? 'bg-negative-subtle text-negative ring-1 ring-negative/20'
                    : 'text-text-tertiary hover:bg-hover'
                }`}
              >
                Expense
              </button>
              <button
                type="button"
                onClick={() => setIsExpense(false)}
                aria-pressed={!isExpense}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                  !isExpense
                    ? 'bg-positive-subtle text-positive ring-1 ring-positive/20'
                    : 'text-text-tertiary hover:bg-hover'
                }`}
              >
                Income
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Amount Precision
          </label>
          <div className="flex gap-1">
            {AMOUNT_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAmountType(opt.value)}
                aria-pressed={amountType === opt.value}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                  amountType === opt.value
                    ? 'bg-brand-50 text-brand-600 ring-1 ring-brand-600/20'
                    : 'text-text-tertiary hover:bg-hover'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {amountType === 'variable' && (
            <p className="text-xs text-text-tertiary mt-1">
              Amount is estimated — used for forecasting and matching, not an exact expectation.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Frequency</label>
            <Select
              aria-label="Frequency"
              value={recurrenceType}
              onChange={(e) => setRecurrenceType(e.target.value as RecurrenceType)}
            >
              {RECURRENCE_TYPE_LABELS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Account</label>
            <Select
              aria-label="Account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">No account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Start Date</label>
            <Input
              type="date"
              aria-label="Start date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              End Date <span className="text-text-tertiary font-normal">(optional)</span>
            </label>
            <Input
              type="date"
              aria-label="End date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Payee <span className="text-text-tertiary font-normal">(optional)</span>
          </label>
          <MerchantSelect value={payeeValue} onChange={setPayeeValue} />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Category</label>
          <CategorySelectButton
            value={categoryId || null}
            onChange={(id) => setCategoryId(id ?? '')}
            position="above"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Notes <span className="text-text-tertiary font-normal">(optional)</span>
          </label>
          <Input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes…"
            aria-label="Notes"
          />
        </div>

        <div className="flex items-center gap-6 pt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoCreate}
              onChange={(e) => setAutoCreate(e.target.checked)}
              className="rounded border-border text-brand-600 focus:ring-brand-600"
            />
            <span className="text-sm text-text-secondary">Auto-create transactions</span>
          </label>
        </div>

        {/* Advanced settings */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs font-medium text-text-tertiary hover:text-text-secondary"
          >
            {showAdvanced ? '▾ Advanced' : '▸ Advanced'}
          </button>
          {showAdvanced && (
            <div className="mt-2 space-y-3 pl-2 border-l-2 border-border-light">
              {showWeekendAdjust && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Weekend Adjustment
                  </label>
                  <Select
                    aria-label="Weekend adjustment"
                    value={weekendAdjust}
                    onChange={(e) => setWeekendAdjust(e.target.value as WeekendAdjust)}
                  >
                    {WEEKEND_ADJUST_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Date Flexibility{' '}
                  <span className="text-text-tertiary font-normal">(± days for matching)</span>
                </label>
                <Input
                  type="number"
                  aria-label="Date flexibility"
                  value={dateFlexibility}
                  onChange={(e) =>
                    setDateFlexibility(Math.max(0, Math.min(14, parseInt(e.target.value) || 0)))
                  }
                  min={0}
                  max={14}
                />
              </div>
            </div>
          )}
        </div>

        <SavingPausedHint className="text-right" />
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-text-secondary bg-surface border border-border rounded-md hover:bg-surface-alt transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name || amount === 0 || !canSave}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-md hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {editItem ? 'Save Changes' : 'Add Recurring'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
