import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CloudOff, Loader2, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useConnection } from '../../hooks/useConnection';
import { useOutbox } from '../../offline/outbox';
import { useOfflineCopy } from '../../offline/snapshot';
import { useConnectionStore } from '../../store/connectionStore';
import { retryLabel } from './RetryStatus';

const RECONNECTED_MS = 4_000;

/**
 * Top-of-page notice while FlyBudget can't reach its server. Everything already loaded
 * (or this device's offline copy) stays on screen; save buttons are disabled (useCanSave),
 * except for new transactions, which wait on the device. When the server is back, AuthGate
 * refreshes the data, OutboxSender sends what waited, and this says so briefly.
 */
export function ConnectionBanner() {
  const connection = useConnection();
  const reconnectedAt = useConnectionStore((s) => s.reconnectedAt);
  const [showReconnected, setShowReconnected] = useState(false);
  const dataAsOf = useOfflineCopy((s) => s.dataAsOf);
  const waiting = useOutbox((s) => s.items.length);
  const canWait = useOutbox((s) => s.available);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (connection.status === 'reconnecting') {
      wasOffline.current = true;
      setShowReconnected(false);
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setShowReconnected(true);
    const t = setTimeout(() => setShowReconnected(false), RECONNECTED_MS);
    return () => clearTimeout(t);
  }, [connection.status, reconnectedAt]);

  if (connection.status === 'reconnecting') {
    return (
      <div
        role="status"
        aria-label="Connection"
        className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm bg-caution-subtle text-text border-b border-caution/30"
      >
        <CloudOff size={16} className="text-caution shrink-0" aria-hidden />
        <span className="font-medium">
          Can't reach FlyBudget.{' '}
          {dataAsOf !== null
            ? `Showing your data as of ${formatDistanceToNow(dataAsOf, { addSuffix: true })}.`
            : 'You can still look around.'}{' '}
          {canWait
            ? 'New transactions are saved on this device; other changes wait until it reconnects.'
            : 'Saving is paused.'}
        </span>
        {waiting > 0 && (
          <span className="text-text-secondary">
            {waiting} transaction{waiting === 1 ? '' : 's'} waiting to send
          </span>
        )}
        <span className="text-text-secondary tabular-nums" aria-live="off">
          {retryLabel(connection, 'Retrying')}
        </span>
        <button
          onClick={() => void connection.retryNow()}
          disabled={connection.checking}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-border bg-surface text-text-secondary hover:text-text hover:bg-surface-alt disabled:opacity-50 transition-colors"
        >
          {connection.checking ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          Retry now
        </button>
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div
        role="status"
        aria-label="Connection"
        className="shrink-0 flex items-center gap-2 px-4 py-2 text-sm bg-positive-subtle text-text border-b border-positive/30 animate-fade-in"
      >
        <CheckCircle2 size={16} className="text-positive shrink-0" aria-hidden />
        Reconnected. Everything is up to date.
      </div>
    );
  }

  return null;
}
