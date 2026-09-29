import { useState } from 'react';
import { format } from 'date-fns';
import { Check, X, Split, Plus, Trash2 } from 'lucide-react';
import { PayeeCombobox } from './PayeeCombobox';
import { useCanAddTransaction } from '../../hooks/useOffline';
import { CategorySelect } from './CategorySelect';
import type { Account, CategoryGroup, Payee, Transaction } from '../../types';
import type { CreateTransactionData, SplitItem } from '../../api/transactions';
import { parseCents, centsToInput, formatCurrency } from '../../utils/currency';

interface Props {
  initial?: Transaction;
  accountId: string;
  groups: CategoryGroup[];
  payees: Payee[];
  accounts?: Account[];
  onSave: (data: CreateTransactionData) => void;
  onCancel: () => void;
  onDelete?: () => void;
  /** `row`: inline in the register (desktop). `sheet`: one column in a phone sheet. */
  layout?: 'row' | 'sheet';
}

interface SplitRow {
  categoryId: string | null;
  amount: string;
  notes: string;
}

export function TransactionFormRow({
  initial,
  accountId,
  groups,
  payees,
  accounts,
  onSave,
  onCancel,
  onDelete,
  layout = 'row',
}: Props) {
  const sheet = layout === 'sheet';
  const today = format(new Date(), 'yyyy-MM-dd');
  const [date, setDate] = useState(initial?.date ?? today);
  const [payee, setPayee] = useState({
    id: initial?.payeeId ?? null,
    name: initial?.payeeName ?? '',
  });
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [outflow, setOutflow] = useState(
    initial?.amount !== undefined && initial.amount < 0 ? centsToInput(initial.amount) : '',
  );
  const [inflow, setInflow] = useState(
    initial?.amount !== undefined && initial.amount > 0 ? centsToInput(initial.amount) : '',
  );
  const [splitMode, setSplitMode] = useState(false);
  // New transactions can be saved offline: they wait on this device until it reconnects
  const { allowed: canSave, onDevice } = useCanAddTransaction();
  const [splits, setSplits] = useState<SplitRow[]>([
    { categoryId: null, amount: '', notes: '' },
    { categoryId: null, amount: '', notes: '' },
  ]);

  const isTransfer = categoryId?.startsWith('transfer:');
  const isEditingParent = initial?.isParent === 1;

  function getTotalCents() {
    const inflowCents = parseCents(inflow);
    return inflowCents > 0 ? inflowCents : -parseCents(outflow);
  }

  function handleSave() {
    const amount = getTotalCents();

    if (splitMode) {
      const splitItems: SplitItem[] = splits
        .filter((s) => parseCents(s.amount) > 0)
        .map((s) => ({
          categoryId: s.categoryId,
          amount: amount < 0 ? -parseCents(s.amount) : parseCents(s.amount),
          notes: s.notes || null,
        }));

      if (splitItems.length < 2) return;

      onSave({
        accountId,
        date,
        payeeId: payee.id,
        payeeName: payee.name || null,
        categoryId: null,
        notes: notes || null,
        amount,
        splits: splitItems,
      });
      return;
    }

    onSave({
      accountId,
      date,
      payeeId: payee.id,
      payeeName: payee.name || null,
      categoryId,
      notes: notes || null,
      amount,
    });
  }

  function updateSplit(idx: number, field: keyof SplitRow, value: string | null) {
    setSplits((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function addSplitRow() {
    setSplits((prev) => [...prev, { categoryId: null, amount: '', notes: '' }]);
  }

  function removeSplitRow(idx: number) {
    setSplits((prev) => prev.filter((_, i) => i !== idx));
  }

  const splitTotal = splits.reduce((sum, s) => sum + parseCents(s.amount), 0);
  const totalCents = Math.abs(getTotalCents());
  const splitRemaining = totalCents - splitTotal;

  // Sheet: 16px text, so phones don't zoom into the field, and taller touch targets
  const inputCls = sheet
    ? 'w-full bg-surface text-base text-text placeholder-text-disabled border border-border rounded-md px-3 py-2.5 focus:outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600'
    : 'w-full bg-surface text-sm text-text placeholder-text-disabled border border-border rounded px-2 py-1.5 focus:outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600';
  const labelCls = sheet
    ? 'text-sm font-medium text-text-secondary mb-1 block'
    : 'text-xs text-text-tertiary mb-1 block';
  // In the row these sit bare in their cell; in the sheet they look like the other fields
  const pickerField = sheet ? inputCls : undefined;
  const sheetBtn =
    'min-h-11 px-4 rounded-md text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none';

  const saveButton = (
    <button
      onClick={handleSave}
      disabled={!canSave}
      className={
        sheet
          ? `${sheetBtn} flex-1 bg-brand-600 text-white`
          : 'p-1.5 rounded text-brand-600 hover:text-brand-700 hover:bg-brand-100 disabled:opacity-40 disabled:pointer-events-none'
      }
      title={
        !canSave
          ? 'Save (paused until FlyBudget reconnects)'
          : onDevice
            ? 'Save on this device (sent when FlyBudget reconnects)'
            : 'Save'
      }
      aria-label="Save"
    >
      <Check size={16} />
      {sheet && (onDevice && canSave ? 'Save on device' : 'Save')}
    </button>
  );
  const splitButton = !isEditingParent && !isTransfer && (
    <button
      onClick={() => setSplitMode(!splitMode)}
      aria-pressed={splitMode}
      className={
        sheet
          ? `${sheetBtn} border ${splitMode ? 'border-brand-600 text-brand-600 bg-brand-50' : 'border-border text-text-secondary'}`
          : `p-1.5 rounded ${splitMode ? 'text-brand-600 bg-brand-100' : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-alt'}`
      }
      title="Split transaction"
      aria-label="Split transaction"
    >
      <Split size={16} />
      {sheet && 'Split'}
    </button>
  );
  const cancelButton = (
    <button
      onClick={onCancel}
      className={
        sheet
          ? `${sheetBtn} border border-border text-text-secondary`
          : 'p-1.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-alt'
      }
      title="Cancel"
      aria-label="Cancel"
    >
      {sheet ? 'Cancel' : <X size={16} />}
    </button>
  );

  return (
    <div
      role="form"
      aria-label={initial ? 'Edit transaction' : 'New transaction'}
      className={sheet ? 'grid gap-4' : 'bg-brand-50 border-b border-brand-100 px-4 py-3'}
    >
      <div className={sheet ? 'grid gap-3' : 'grid grid-cols-4 gap-3 mb-3'}>
        <div>
          <label className={labelCls}>Date</label>
          <input
            type="date"
            aria-label="Date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Payee</label>
          <PayeeCombobox
            value={payee}
            onChange={setPayee}
            payees={payees}
            fieldClassName={pickerField}
          />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          {splitMode ? (
            <span className="text-sm text-brand-600 font-medium leading-8">Split</span>
          ) : (
            <CategorySelect
              value={categoryId}
              onChange={setCategoryId}
              groups={groups}
              accounts={accounts}
              currentAccountId={accountId}
              fieldClassName={pickerField}
            />
          )}
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
            aria-label="Notes"
            className={inputCls}
          />
        </div>
      </div>

      <div className={sheet ? 'grid grid-cols-2 gap-3' : 'flex items-end gap-3'}>
        <div className={sheet ? '' : 'w-28'}>
          <label className={labelCls}>Outflow</label>
          <input
            type="number"
            inputMode="decimal"
            value={outflow}
            aria-label="Outflow"
            onChange={(e) => setOutflow(e.target.value)}
            onFocus={() => setInflow('')}
            placeholder="0.00"
            min="0"
            step="0.01"
            className={`${inputCls} text-right tabular-nums`}
          />
        </div>
        <div className={sheet ? '' : 'w-28'}>
          <label className={labelCls}>Inflow</label>
          <input
            type="number"
            inputMode="decimal"
            value={inflow}
            aria-label="Inflow"
            onChange={(e) => setInflow(e.target.value)}
            onFocus={() => setOutflow('')}
            placeholder="0.00"
            min="0"
            step="0.01"
            className={`${inputCls} text-right tabular-nums`}
          />
        </div>
        {!sheet && (
          <>
            <div className="flex-1" />
            <div className="flex items-center gap-1 pb-0.5">
              {saveButton}
              {splitButton}
              {cancelButton}
              {onDelete && (
                <button
                  onClick={onDelete}
                  className="p-1.5 rounded text-text-tertiary hover:text-negative hover:bg-red-50 ml-1"
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {splitMode && (
        <div
          className={
            sheet
              ? 'grid gap-3 pt-3 border-t border-border-light'
              : 'mt-3 pt-3 border-t border-brand-100'
          }
        >
          {splits.map((s, i) => (
            <div
              key={i}
              className={
                sheet
                  ? 'grid grid-cols-[1fr_1fr_auto] gap-2 items-center'
                  : 'grid grid-cols-[1fr_1fr_120px_auto] gap-2 mb-2 items-center'
              }
            >
              <div className={sheet ? 'col-span-3' : 'contents'}>
                <CategorySelect
                  value={s.categoryId}
                  onChange={(v) => updateSplit(i, 'categoryId', v)}
                  groups={groups}
                  label={`Split ${i + 1} category`}
                  className="text-xs"
                  fieldClassName={pickerField}
                />
              </div>
              <input
                type="text"
                value={s.notes}
                onChange={(e) => updateSplit(i, 'notes', e.target.value)}
                placeholder="Notes"
                aria-label={`Split ${i + 1} notes`}
                className={`${inputCls} ${sheet ? '' : 'text-xs'}`}
              />
              <input
                type="number"
                inputMode="decimal"
                value={s.amount}
                onChange={(e) => updateSplit(i, 'amount', e.target.value)}
                aria-label={`Split ${i + 1} amount`}
                placeholder="0.00"
                min="0"
                step="0.01"
                className={`${inputCls} text-right tabular-nums ${sheet ? '' : 'text-xs'}`}
              />
              <div className={sheet ? 'w-11' : 'w-6'}>
                {splits.length > 2 && (
                  <button
                    onClick={() => removeSplitRow(i)}
                    aria-label={`Remove split ${i + 1}`}
                    className={`rounded text-text-tertiary hover:text-negative ${sheet ? 'w-11 h-11 flex items-center justify-center' : 'p-0.5'}`}
                  >
                    <Trash2 size={sheet ? 16 : 14} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between mt-2">
            <button
              onClick={addSplitRow}
              className={`flex items-center gap-1 text-brand-600 hover:text-brand-700 ${sheet ? 'text-sm min-h-11' : 'text-xs'}`}
            >
              <Plus size={12} /> Add split
            </button>
            <span
              className={`text-xs tabular-nums ${splitRemaining === 0 ? 'text-positive' : 'text-negative'}`}
            >
              {splitRemaining === 0 ? 'Balanced' : `${formatCurrency(splitRemaining)} remaining`}
            </span>
          </div>
        </div>
      )}

      {sheet && (
        <div className="flex gap-2">
          {cancelButton}
          {splitButton}
          {saveButton}
        </div>
      )}
    </div>
  );
}
