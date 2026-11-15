import { useTranslation } from 'react-i18next';
import { CurrencyInput } from '../ui/CurrencyInput';
import { useUpdateTransaction } from '../../hooks/useTransactions';
import { useBudgetCurrency } from '../../hooks/useCurrency';
import { formatMoney } from '../../utils/currency';
import type { Transaction } from '../../types';

const SOURCES = ['rate', 'manual', 'transfer', 'missing'] as const;
const isSource = (source: string): source is (typeof SOURCES)[number] =>
  (SOURCES as readonly string[]).includes(source);

/**
 * For a transaction in another currency than the budget's: what the budget counts it as.
 * It can be typed in (what the card statement says it cost, fees included), or go back to
 * the day's rate. A transfer's value comes from its other side when that one is in the
 * budget's currency, so it isn't editable then.
 */
export function MainAmountField({ tx, disabled }: { tx: Transaction; disabled?: boolean }) {
  const { t } = useTranslation();
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
        {t('currency.mainAmount.label', { currency: budgetCurrency })}
      </label>
      {editable ? (
        <CurrencyInput
          value={value}
          onChange={save}
          currency={budgetCurrency}
          aria-label={t('currency.mainAmount.label', { currency: budgetCurrency })}
          placeholder={
            tx.mainAmountSource === 'missing' ? t('currency.mainAmount.noRate') : undefined
          }
        />
      ) : tx.mainAmount !== null && tx.mainAmount !== undefined ? (
        <div className="text-sm tabular-nums text-text">{formatMoney(value, budgetCurrency)}</div>
      ) : null}
      <p
        className={`mt-1 text-xs ${tx.mainAmountSource === 'missing' ? 'text-caution' : 'text-text-tertiary'}`}
      >
        {isSource(tx.mainAmountSource) && t(`currency.mainAmount.source.${tx.mainAmountSource}`)}
        {editable && tx.mainAmountSource === 'manual' && (
          <>
            {' '}
            <button
              type="button"
              onClick={() => updateTx.mutate({ id: tx.id, data: { mainAmount: null } })}
              className="underline hover:no-underline"
            >
              {t('currency.mainAmount.useRate')}
            </button>
          </>
        )}
      </p>
    </div>
  );
}
