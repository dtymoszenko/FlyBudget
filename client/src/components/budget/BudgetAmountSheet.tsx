import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useCategoryHistory } from '../../hooks/useBudget';
import { useCanSave } from '../../hooks/useConnection';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import { centsToInput, formatCurrency, parseCents } from '../../utils/currency';
import type { BudgetCategory } from '../../types';

interface Props {
  category: BudgetCategory | null;
  isIncome: boolean;
  month: string;
  onClose: () => void;
  onSave: (categoryId: string, cents: number) => void;
  /** Sets the amount for this month and the 11 after it */
  onApplyBulk: (categoryId: string, cents: number) => void;
}

/**
 * Phones: planning a category's amount in a sheet (the desktop edits in place). Shows
 * last month and the monthly average, which can be used with one tap.
 */
export function BudgetAmountSheet({
  category,
  isIncome,
  month,
  onClose,
  onSave,
  onApplyBulk,
}: Props) {
  return (
    <Modal
      isOpen={category !== null}
      onClose={onClose}
      title={category ? `Plan ${category.name}` : 'Plan'}
      size="sm"
    >
      {category && (
        // Keyed so reopening for another category starts fresh
        <SheetBody
          key={category.id}
          category={category}
          isIncome={isIncome}
          month={month}
          onClose={onClose}
          onSave={onSave}
          onApplyBulk={onApplyBulk}
        />
      )}
    </Modal>
  );
}

function SheetBody({
  category,
  isIncome,
  month,
  onClose,
  onSave,
  onApplyBulk,
}: Omit<Props, 'category'> & { category: BudgetCategory }) {
  const [raw, setRaw] = useState(category.budgeted ? centsToInput(category.budgeted) : '');
  const [allYear, setAllYear] = useState(false);
  const { data: history } = useCategoryHistory(category.id, month);
  const canSave = useCanSave();

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    const cents = Math.abs(parseCents(raw));
    if (allYear) onApplyBulk(category.id, cents);
    else onSave(category.id, cents);
    onClose();
  }

  const suggestions = [
    { label: isIncome ? 'Earned last month' : 'Spent last month', cents: history?.lastMonth },
    { label: 'Monthly average', cents: history?.average },
  ].filter((s): s is { label: string; cents: number } => !!s.cents);

  return (
    <form onSubmit={save} className="grid gap-4">
      <p className="text-sm text-text-secondary">{format(parseISO(`${month}-01`), 'MMMM yyyy')}</p>
      <label className="grid gap-1">
        <span className="text-sm font-medium text-text-secondary">Planned</span>
        <input
          autoFocus
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          aria-label={`Planned for ${category.name}`}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-md border border-border bg-surface px-3 py-2.5 text-right tabular-nums text-text focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
        />
      </label>

      {suggestions.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setRaw(centsToInput(s.cents))}
              className="min-h-11 rounded-lg bg-surface-alt px-3 py-2 text-left"
            >
              <span className="block text-sm font-semibold tabular-nums text-text">
                {formatCurrency(s.cents)}
              </span>
              <span className="block text-xs text-text-tertiary">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      <label className="flex min-h-11 items-center gap-3 text-sm text-text">
        <input
          type="checkbox"
          checked={allYear}
          onChange={(e) => setAllYear(e.target.checked)}
          className="h-5 w-5 accent-brand-600"
        />
        Use this amount for the next 12 months
      </label>

      <SavingPausedHint />
      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="min-h-11 flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" className="min-h-11 flex-1" disabled={!canSave}>
          Save
        </Button>
      </div>
    </form>
  );
}
