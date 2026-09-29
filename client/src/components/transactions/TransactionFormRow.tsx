import { useState } from 'react';
import { format } from 'date-fns';
import { Check, X, Split, Plus, Trash2 } from 'lucide-react';
import { PayeeCombobox } from './PayeeCombobox';
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
}: Props) {
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

  const inputCls =
    'w-full bg-surface text-sm text-text placeholder-text-disabled border border-border rounded px-2 py-1.5 focus:outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600';

  return (
    <div
      role="form"
      aria-label={initial ? 'Edit transaction' : 'New transaction'}
      className="bg-brand-50 border-b border-brand-100 px-4 py-3"
    >
      <div className="grid grid-cols-4 gap-3 mb-3">
        <div>
          <label className="text-xs text-text-tertiary mb-1 block">Date</label>
          <input
            type="date"
            aria-label="Date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-xs text-text-tertiary mb-1 block">Payee</label>
          <PayeeCombobox value={payee} onChange={setPayee} payees={payees} />
        </div>
        <div>
          <label className="text-xs text-text-tertiary mb-1 block">Category</label>
          {splitMode ? (
            <span className="text-sm text-brand-600 font-medium leading-8">Split</span>
          ) : (
            <CategorySelect
              value={categoryId}
              onChange={setCategoryId}
              groups={groups}
              accounts={accounts}
              currentAccountId={accountId}
            />
          )}
        </div>
        <div>
          <label className="text-xs text-text-tertiary mb-1 block">Notes</label>
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

      <div className="flex items-end gap-3">
        <div className="w-28">
          <label className="text-xs text-text-tertiary mb-1 block">Outflow</label>
          <input
            type="number"
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
        <div className="w-28">
          <label className="text-xs text-text-tertiary mb-1 block">Inflow</label>
          <input
            type="number"
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
        <div className="flex-1" />
        <div className="flex items-center gap-1 pb-0.5">
          <button
            onClick={handleSave}
            className="p-1.5 rounded text-brand-600 hover:text-brand-700 hover:bg-brand-100"
            title="Save"
          >
            <Check size={16} />
          </button>
          {!isEditingParent && !isTransfer && (
            <button
              onClick={() => setSplitMode(!splitMode)}
              className={`p-1.5 rounded ${splitMode ? 'text-brand-600 bg-brand-100' : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-alt'}`}
              title="Split transaction"
            >
              <Split size={16} />
            </button>
          )}
          <button
            onClick={onCancel}
            className="p-1.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-alt"
            title="Cancel"
          >
            <X size={16} />
          </button>
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
      </div>

      {splitMode && (
        <div className="mt-3 pt-3 border-t border-brand-100">
          {splits.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_120px_auto] gap-2 mb-2 items-center">
              <CategorySelect
                value={s.categoryId}
                onChange={(v) => updateSplit(i, 'categoryId', v)}
                groups={groups}
                label={`Split ${i + 1} category`}
                className="text-xs"
              />
              <input
                type="text"
                value={s.notes}
                onChange={(e) => updateSplit(i, 'notes', e.target.value)}
                placeholder="Notes"
                aria-label={`Split ${i + 1} notes`}
                className={`${inputCls} text-xs`}
              />
              <input
                type="number"
                value={s.amount}
                onChange={(e) => updateSplit(i, 'amount', e.target.value)}
                aria-label={`Split ${i + 1} amount`}
                placeholder="0.00"
                min="0"
                step="0.01"
                className={`${inputCls} text-right tabular-nums text-xs`}
              />
              <div className="w-6">
                {splits.length > 2 && (
                  <button
                    onClick={() => removeSplitRow(i)}
                    aria-label={`Remove split ${i + 1}`}
                    className="p-0.5 rounded text-text-tertiary hover:text-negative"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between mt-2">
            <button
              onClick={addSplitRow}
              className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
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
    </div>
  );
}
