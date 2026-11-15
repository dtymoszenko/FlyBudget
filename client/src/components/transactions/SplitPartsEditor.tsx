import { Plus, Trash2 } from 'lucide-react';
import { CurrencyInput } from '../ui/CurrencyInput';
import { formatMoney } from '../../utils/currency';
import { CategorySelectButton } from './CategorySelectButton';
import { balancingPart, emptyPart, remainingOf, type SplitPart } from '../../utils/splitParts';
import { useTranslation } from 'react-i18next';

interface Props {
  parts: SplitPart[];
  onChange: (parts: SplitPart[]) => void;
  /** The whole amount, positive */
  total: number;
  /** The account's currency (null: the budget's) */
  currency?: string | null;
}

/**
 * The parts of a split in a dialog (Add transaction, Split transaction). Put it inside the
 * dialog's `<AmountFields>` so Save waits for amounts that can be read.
 */
export function SplitPartsEditor({ parts, onChange, total, currency }: Props) {
  const { t } = useTranslation();
  const update = (i: number, change: Partial<SplitPart>) =>
    onChange(parts.map((p, j) => (j === i ? { ...p, ...change } : p)));
  const remaining = remainingOf(total, parts);
  // Does the subtraction for a non-round amount: one click puts the rest on that part
  const suggestion = balancingPart(total, parts);

  return (
    <div className="space-y-3">
      {parts.map((p, i) => (
        <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2 items-start">
          <CategorySelectButton
            value={p.categoryId}
            onChange={(categoryId) => update(i, { categoryId })}
            label={t('transactions.splitParts.category', { n: i + 1 })}
          />
          <CurrencyInput
            value={p.amount}
            onChange={(amount) => update(i, { amount })}
            aria-label={t('transactions.splitParts.amount', { n: i + 1 })}
            currency={currency}
            className="text-right tabular-nums"
          />
          <div className="w-9 max-md:w-11">
            {parts.length > 2 && (
              <button
                type="button"
                onClick={() => onChange(parts.filter((_, j) => j !== i))}
                aria-label={t('transactions.splitParts.remove', { n: i + 1 })}
                className="h-9 w-9 max-md:h-11 max-md:w-11 flex items-center justify-center rounded text-text-tertiary hover:text-negative"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <input
            type="text"
            value={p.notes}
            onChange={(e) => update(i, { notes: e.target.value })}
            placeholder={t('transactions.splitParts.notes')}
            aria-label={t('transactions.splitParts.notesAria', { n: i + 1 })}
            className="col-span-2 block w-full rounded-md border border-border px-3 py-1.5 text-sm text-text bg-surface placeholder-text-disabled focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          />
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChange([...parts, emptyPart()])}
          className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 max-md:min-h-11"
        >
          <Plus size={14} /> {t('transactions.splitParts.add')}
        </button>
        <span
          className={`text-sm tabular-nums ${remaining === 0 ? 'text-positive' : 'text-negative'}`}
        >
          {remaining === 0
            ? t('transactions.splitParts.balanced')
            : t('transactions.splitParts.remaining', { amount: formatMoney(remaining, currency) })}
        </span>
      </div>
      {suggestion && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => update(suggestion.index, { amount: suggestion.amount })}
            className="text-sm text-brand-600 hover:text-brand-700 tabular-nums max-md:min-h-11"
          >
            {t('transactions.splitParts.setTo', {
              n: suggestion.index + 1,
              amount: formatMoney(suggestion.amount, currency),
            })}
          </button>
        </div>
      )}
    </div>
  );
}
