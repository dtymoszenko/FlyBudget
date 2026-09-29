import { useMemo } from 'react';
import { ArrowLeftRight, ChevronRight, Lock, Split } from 'lucide-react';
import { PayeeIcon } from '../payees/PayeeIcon';
import { formatCurrency } from '../../utils/currency';
import { usePreferencesStore } from '../../store/preferencesStore';
import type { Transaction, PayeeWithCount } from '../../types';

interface Props {
  tx: Transaction;
  categoryEntry: { name: string; icon: string | null } | null;
  payees: PayeeWithCount[];
  /** Shown on the all-transactions page, where rows come from several accounts */
  accountName?: string;
  isSelected: boolean;
  onOpenDetail: (id: string) => void;
}

/**
 * A transaction in the register on a phone: one tap target instead of the desktop row's
 * hover controls. Payee and amount on top, category (or split / transfer), account and
 * notes below. Tapping opens the full-screen details, where it's edited.
 */
export function TransactionCard({
  tx,
  categoryEntry,
  payees,
  accountName,
  isSelected,
  onOpenDetail,
}: Props) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const isTransfer = !!tx.transferTransactionId;
  const isSplit = tx.isParent === 1 && !!tx.children?.length;
  const payeeName = tx.payeeName || (isTransfer ? 'Transfer' : '—');
  const payee = useMemo(
    () => (tx.payeeId ? payees.find((p) => p.id === tx.payeeId) : undefined),
    [payees, tx.payeeId],
  );

  const category = isSplit ? (
    <span className="inline-flex items-center gap-1 text-brand-600">
      <Split size={12} aria-hidden /> Split ({tx.children!.length})
    </span>
  ) : isTransfer ? (
    <span className="inline-flex items-center gap-1">
      <ArrowLeftRight size={12} aria-hidden /> Transfer
    </span>
  ) : categoryEntry ? (
    <span>
      {showCategoryIcons && categoryEntry.icon ? `${categoryEntry.icon} ` : ''}
      {categoryEntry.name}
    </span>
  ) : (
    <span className="text-caution">Uncategorized</span>
  );

  return (
    <button
      type="button"
      onClick={() => onOpenDetail(tx.id)}
      data-testid="transaction-card"
      aria-current={isSelected || undefined}
      className={`w-full min-h-14 flex items-center gap-3 px-4 py-2.5 text-left border-b border-border-light transition-colors ${
        isSelected ? 'bg-brand-50' : 'bg-surface active:bg-hover'
      }`}
    >
      <PayeeIcon name={payeeName} logo={payee?.logo} transfer={isTransfer} />
      <span className="flex-1 min-w-0 grid gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="flex-1 min-w-0 truncate text-[15px] font-medium text-text">
            {payeeName}
          </span>
          <span
            className={`shrink-0 text-[15px] font-medium tabular-nums ${tx.amount > 0 ? 'text-positive' : 'text-text'}`}
          >
            {tx.amount > 0 ? '+' : ''}
            {formatCurrency(Math.abs(tx.amount))}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-text-tertiary min-w-0">
          <span className="truncate">{category}</span>
          {accountName && <span className="truncate">· {accountName}</span>}
          {tx.reconciled ? (
            <Lock size={11} className="shrink-0 text-text-disabled" aria-label="Reconciled" />
          ) : null}
        </span>
        {tx.notes && <span className="text-xs text-text-tertiary truncate">{tx.notes}</span>}
      </span>
      <ChevronRight size={16} className="shrink-0 text-text-disabled" aria-hidden />
    </button>
  );
}
