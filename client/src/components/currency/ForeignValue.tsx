import { AlertTriangle } from 'lucide-react';
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
  if (!tx.mainAmountSource) return null;
  if (tx.mainAmountSource === 'missing') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs text-caution ${className}`}
        title="No exchange rate for this day yet: the budget counts it as nothing until there is one"
      >
        <AlertTriangle size={11} aria-hidden />
        No rate
      </span>
    );
  }
  return (
    <span className={`text-xs tabular-nums text-text-tertiary ${className}`}>
      ≈ {formatCurrency(Math.abs(tx.mainAmount ?? tx.amount))}
    </span>
  );
}
