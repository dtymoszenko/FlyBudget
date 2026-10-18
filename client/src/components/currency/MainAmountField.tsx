import { CurrencyInput } from '../ui/CurrencyInput';
import { useUpdateTransaction } from '../../hooks/useTransactions';
import { useBudgetCurrency } from '../../hooks/useCurrency';
import { formatMoney } from '../../utils/currency';
import type { Transaction } from '../../types';

const SOURCE_TEXT: Record<string, string> = {
  rate: "At the day's exchange rate.",
  manual: 'As you typed it.',
  transfer: 'What the other side of the transfer is worth.',
  missing:
    'No exchange rate for this day yet, so the budget counts it as nothing. Type what it cost, or add a rate in Settings → Currencies.',
};

/**
 * For a transaction in another currency than the budget's: what the budget counts it as.
 * It can be typed in (what the card statement says it cost, fees included), or go back to
 * the day's rate. A transfer's value comes from its other side when that one is in the
 * budget's currency, so it isn't editable then.
 */
export function MainAmountField({ tx, disabled }: { tx: Transaction; disabled?: boolean }) {
  const budgetCurrency = useBudgetCurrency();
  const updateTx = useUpdateTransaction();
  // Shown without a sign, like the amount above it
  const value = Math.abs(tx.mainAmount ?? 0);
  if (!tx.mainAmountSource || !budgetCurrency) return null;
  const fromOtherSide = tx.mainAmountSource === 'transfer';
  const editable = !disabled && !fromOtherSide && !tx.parentTransactionId;

  function save(cents: number) {
    // Left without a change: it keeps coming from where it did
    if (cents === value && tx.mainAmountSource !== 'missing') return;
    updateTx.mutate({
      id: tx.id,
      data: { mainAmount: tx.amount < 0 ? -Math.abs(cents) : Math.abs(cents) },
    });
  }

  return (
    <div>
      <label className="text-xs font-medium text-text-secondary mb-1.5 block">
        Value in {budgetCurrency}
      </label>
      {editable ? (
        <CurrencyInput
          value={value}
          onChange={save}
          currency={budgetCurrency}
          aria-label={`Value in ${budgetCurrency}`}
          placeholder={tx.mainAmountSource === 'missing' ? 'No rate yet' : undefined}
        />
      ) : tx.mainAmount !== null && tx.mainAmount !== undefined ? (
        <div className="text-sm tabular-nums text-text">{formatMoney(value, budgetCurrency)}</div>
      ) : null}
      <p
        className={`mt-1 text-xs ${tx.mainAmountSource === 'missing' ? 'text-caution' : 'text-text-tertiary'}`}
      >
        {SOURCE_TEXT[tx.mainAmountSource] ?? ''}
        {editable && tx.mainAmountSource === 'manual' && (
          <>
            {' '}
            <button
              type="button"
              onClick={() => updateTx.mutate({ id: tx.id, data: { mainAmount: null } })}
              className="underline hover:no-underline"
            >
              Use the day&apos;s rate
            </button>
          </>
        )}
      </p>
    </div>
  );
}
