import { useState, useEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useFormReset } from '../../hooks/useFormReset';
import { Modal } from '../ui/Modal';
import { Input, Select } from '../ui/Input';
import { CurrencyInput } from '../ui/CurrencyInput';
import { MerchantSelect } from '../transactions/MerchantSelect';
import { CategorySelectButton } from '../transactions/CategorySelectButton';
import { useAccounts } from '../../hooks/useAccounts';
import { useAccountCurrency } from '../../hooks/useCurrency';
import { usePayees } from '../../hooks/usePayees';
import { useCanSave } from '../../hooks/useConnection';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import { freqLabel } from './scheduleFormat';
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

const AMOUNT_TYPES: AmountType[] = ['exact', 'approximate', 'variable'];

const WEEKEND_ADJUSTS: WeekendAdjust[] = ['none', 'before', 'after', 'closest'];

export default function RecurringFormModal({ isOpen, onClose, onSave, editItem }: Props) {
  const { t } = useTranslation();
  const { data: accounts = [] } = useAccounts();
  const { data: payees = [] } = usePayees();
  const canSave = useCanSave();
  const accountCurrency = useAccountCurrency();

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

  // Set when the form opened before accounts/payees had loaded: filled in once they arrive
  const pendingDefaults = useRef({ account: false, payee: false });

  // Filled once per opening: payees and accounts refetch (e.g. after picking or creating a
  // payee) and must not wipe the form
  useFormReset(isOpen ? (editItem?.id ?? 'new') : null, () => {
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
      const matchedPayee = editItem.payeeId ? payees.find((p) => p.id === editItem.payeeId) : null;
      setPayeeValue({ id: editItem.payeeId, name: matchedPayee?.name ?? '' });
      pendingDefaults.current = {
        account: false,
        payee: Boolean(editItem.payeeId && !matchedPayee),
      };
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
      pendingDefaults.current = { account: accounts.length === 0, payee: false };
      setCategoryId('');
      setPayeeValue({ id: null, name: '' });
      setNotes('');
      setAutoCreate(false);
      setShowAdvanced(false);
    }
  });

  // Data that loads after the dialog opened fills in what it couldn't, once, and only if
  // the user hasn't changed that field in the meantime
  useEffect(() => {
    if (!isOpen || !pendingDefaults.current.account || accounts.length === 0) return;
    pendingDefaults.current.account = false;
    setAccountId((current) => current || accounts[0].id);
  }, [isOpen, accounts]);
  useEffect(() => {
    const payeeId = editItem?.payeeId;
    if (!isOpen || !pendingDefaults.current.payee || !payeeId) return;
    const payee = payees.find((p) => p.id === payeeId);
    if (!payee) return;
    pendingDefaults.current.payee = false;
    setPayeeValue((current) =>
      current.id === payeeId && !current.name ? { id: payee.id, name: payee.name } : current,
    );
  }, [isOpen, editItem, payees]);

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
      title={editItem ? t('recurring.form.titleEdit') : t('recurring.form.titleAdd')}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            {t('recurring.form.name')}
          </label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={t('recurring.form.name')}
            placeholder={t('recurring.form.namePlaceholder')}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {amountType === 'variable'
                ? t('recurring.form.estimatedAmount')
                : t('recurring.form.amount')}
            </label>
            {/* In the account's currency: that's what its transactions will be in */}
            <CurrencyInput
              value={amount}
              onChange={setAmount}
              aria-label={t('recurring.form.amount')}
              currency={accountCurrency(accountId)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {t('recurring.form.type')}
            </label>
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
                {t('recurring.form.expense')}
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
                {t('recurring.form.income')}
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            {t('recurring.form.precision')}
          </label>
          <div className="flex gap-1">
            {AMOUNT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setAmountType(type)}
                aria-pressed={amountType === type}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                  amountType === type
                    ? 'bg-brand-50 text-brand-600 ring-1 ring-brand-600/20'
                    : 'text-text-tertiary hover:bg-hover'
                }`}
              >
                {t(`recurring.form.amountTypes.${type}`)}
              </button>
            ))}
          </div>
          {amountType === 'variable' && (
            <p className="text-xs text-text-tertiary mt-1">{t('recurring.form.variableHint')}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {t('recurring.form.frequency')}
            </label>
            <Select
              aria-label={t('recurring.form.frequency')}
              value={recurrenceType}
              onChange={(e) => setRecurrenceType(e.target.value as RecurrenceType)}
            >
              {RECURRENCE_TYPE_LABELS.map((f) => (
                <option key={f.value} value={f.value}>
                  {freqLabel(f.value)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {t('recurring.form.account')}
            </label>
            <Select
              aria-label={t('recurring.form.account')}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">{t('recurring.form.noAccount')}</option>
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
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {t('recurring.form.startDate')}
            </label>
            <Input
              type="date"
              aria-label={t('recurring.form.startDateLabel')}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              <Trans
                i18nKey="recurring.form.endDate"
                components={{ optional: <span className="text-text-tertiary font-normal" /> }}
              />
            </label>
            <Input
              type="date"
              aria-label={t('recurring.form.endDateLabel')}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            <Trans
              i18nKey="recurring.form.payee"
              components={{ optional: <span className="text-text-tertiary font-normal" /> }}
            />
          </label>
          <MerchantSelect
            value={payeeValue}
            onChange={setPayeeValue}
            label={t('recurring.form.payeeLabel')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            {t('recurring.form.category')}
          </label>
          <CategorySelectButton
            value={categoryId || null}
            onChange={(id) => setCategoryId(id ?? '')}
            position="above"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            <Trans
              i18nKey="recurring.form.notes"
              components={{ optional: <span className="text-text-tertiary font-normal" /> }}
            />
          </label>
          <Input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('recurring.form.notesPlaceholder')}
            aria-label={t('recurring.form.notesLabel')}
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
            <span className="text-sm text-text-secondary">{t('recurring.form.autoCreate')}</span>
          </label>
        </div>

        {/* Advanced settings */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs font-medium text-text-tertiary hover:text-text-secondary"
          >
            {showAdvanced ? t('recurring.form.advancedOpen') : t('recurring.form.advancedClosed')}
          </button>
          {showAdvanced && (
            <div className="mt-2 space-y-3 pl-2 border-l-2 border-border-light">
              {showWeekendAdjust && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    {t('recurring.form.weekendAdjustment')}
                  </label>
                  <Select
                    aria-label={t('recurring.form.weekendAdjustmentLabel')}
                    value={weekendAdjust}
                    onChange={(e) => setWeekendAdjust(e.target.value as WeekendAdjust)}
                  >
                    {WEEKEND_ADJUSTS.map((opt) => (
                      <option key={opt} value={opt}>
                        {t(`recurring.form.weekendOptions.${opt}`)}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  <Trans
                    i18nKey="recurring.form.dateFlexibility"
                    components={{ hint: <span className="text-text-tertiary font-normal" /> }}
                  />
                </label>
                <Input
                  type="number"
                  aria-label={t('recurring.form.dateFlexibilityLabel')}
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
            {t('common.actions.cancel')}
          </button>
          <button
            type="submit"
            disabled={!name || amount === 0 || !canSave}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-md hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {editItem ? t('recurring.form.saveChanges') : t('recurring.form.add')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
