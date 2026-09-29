import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertCircle, CloudUpload, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { discardWaiting, retryWaiting, sendWaiting, useOutbox } from '../../offline/outbox';
import { useConnectionStore } from '../../store/connectionStore';
import { formatCurrency } from '../../utils/currency';
import { outboxEntryFor, type OutboxItem } from '../../utils/offline';
import { ConfirmModal } from '../ui/ConfirmModal';

interface Props {
  /** The account whose register this is (all accounts when absent) */
  accountId?: string;
  categoryName: (id: string) => string | undefined;
  accountName: (id: string) => string | undefined;
}

/**
 * New transactions saved on this device while FlyBudget couldn't reach its server, shown
 * above the register until they're sent. They aren't in balances or the budget yet.
 */
export function WaitingTransactions({ accountId, categoryName, accountName }: Props) {
  const qc = useQueryClient();
  const items = useOutbox((s) => s.items);
  const sending = useOutbox((s) => s.sending);
  const connected = useConnectionStore((s) => s.status === 'connected');
  const [discarding, setDiscarding] = useState<OutboxItem | null>(null);

  const shown = items
    .map((item) => ({ item, entry: outboxEntryFor(item, accountId) }))
    .filter((x): x is { item: OutboxItem; entry: NonNullable<typeof x.entry> } => x.entry !== null);
  if (shown.length === 0) return null;

  const status = sending
    ? 'Sending…'
    : connected
      ? null
      : 'Sent when FlyBudget reconnects. Not in balances or the budget yet.';

  function payeeOf(item: OutboxItem) {
    if (item.kind === 'transfer') {
      const other =
        accountId === item.data.toAccountId ? item.data.fromAccountId : item.data.toAccountId;
      return `Transfer: ${accountName(other) ?? 'another account'}`;
    }
    return item.data.payeeName || 'No payee';
  }

  function detailOf(item: OutboxItem) {
    if (item.kind === 'transfer') return 'Transfer';
    if (item.data.splits?.length) return `Split (${item.data.splits.length})`;
    return (item.data.categoryId && categoryName(item.data.categoryId)) || 'Uncategorized';
  }

  return (
    <section
      aria-label="Saved on this device"
      className="border-b border-caution/30 bg-caution-subtle/40"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 border-b border-caution/20">
        <CloudUpload size={15} className="text-caution shrink-0" aria-hidden />
        <span className="text-sm font-medium text-text">Saved on this device</span>
        {status && (
          <span className="text-xs text-text-secondary flex items-center gap-1">
            {sending && <Loader2 size={12} className="animate-spin" aria-hidden />}
            {status}
          </span>
        )}
      </div>
      <ul>
        {shown.map(({ item, entry }) => (
          <li
            key={item.id}
            data-testid="waiting-transaction"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-b border-border-light last:border-b-0"
          >
            <span className="text-xs text-text-tertiary w-24 shrink-0 tabular-nums">
              {format(parseISO(item.data.date), 'MMM d, yyyy')}
            </span>
            <span className="flex-1 min-w-0 grid">
              <span className="truncate text-sm font-medium text-text">{payeeOf(item)}</span>
              <span className="truncate text-xs text-text-tertiary">
                {detailOf(item)}
                {!accountId && ` · ${accountName(entry.accountId) ?? ''}`}
              </span>
            </span>
            <span
              className={`text-sm font-medium tabular-nums ${entry.amount > 0 ? 'text-positive' : 'text-text'}`}
            >
              {entry.amount > 0 ? '+' : ''}
              {formatCurrency(entry.amount)}
            </span>
            {item.error ? (
              <span className="basis-full flex flex-wrap items-center gap-2 text-xs">
                <span className="flex items-center gap-1 text-negative">
                  <AlertCircle size={12} aria-hidden /> Not saved: {item.error}
                </span>
                <button
                  onClick={() => void retryWaiting(item.id).then(() => sendWaiting(qc))}
                  aria-label={`Try again: ${payeeOf(item)}`}
                  disabled={!connected}
                  className="px-2 py-1 max-md:min-h-11 rounded border border-border bg-surface text-text-secondary hover:text-text disabled:opacity-50"
                >
                  Try again
                </button>
                <button
                  onClick={() => setDiscarding(item)}
                  aria-label={`Discard ${payeeOf(item)}`}
                  className="px-2 py-1 max-md:min-h-11 rounded border border-border bg-surface text-negative hover:bg-negative-subtle"
                >
                  Discard
                </button>
              </span>
            ) : (
              <button
                onClick={() => setDiscarding(item)}
                aria-label={`Discard ${payeeOf(item)}`}
                className="text-xs px-2 py-1 max-md:min-h-11 rounded text-text-tertiary hover:text-negative hover:bg-surface"
              >
                Discard
              </button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmModal
        isOpen={discarding !== null}
        onClose={() => setDiscarding(null)}
        onConfirm={() => {
          if (discarding) void discardWaiting(discarding.id);
          setDiscarding(null);
        }}
        title="Discard this transaction?"
        message="It was only saved on this device and hasn't been sent to FlyBudget, so it will be gone."
        confirmLabel="Discard"
        danger
      />
    </section>
  );
}
