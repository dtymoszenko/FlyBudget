import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../../utils/currency';
import type { Transaction } from '../../types';

/**
 * Under an amount in another currency than the budget's: what the budget counts it as
 * ("≈ €12.34"), or that its rate is still missing. Nothing for amounts in the budget's currency.
 */
export function ForeignValue({
  tx,
  className = '',
}: {
  tx: Pick<Transaction, 'amount' | 'mainAmount' | 'mainAmountSource'>;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!tx.mainAmountSource) return null;
  if (tx.mainAmountSource === 'missing') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs text-caution ${className}`}
        title={t('currency.foreign.noRateHint')}
      >
        <AlertTriangle size={11} aria-hidden />
        {t('currency.foreign.noRate')}
      </span>
    );
  }
  return (
    <span className={`text-xs tabular-nums text-text-tertiary ${className}`}>
      ≈ {formatCurrency(Math.abs(tx.mainAmount ?? tx.amount))}
    </span>
  );
}
