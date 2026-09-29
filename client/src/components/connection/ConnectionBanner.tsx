import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CloudOff, Loader2, RefreshCw } from 'lucide-react';
import { useConnection } from '../../hooks/useConnection';
import { useConnectionStore } from '../../store/connectionStore';
import { retryLabel } from './RetryStatus';

const RECONNECTED_MS = 4_000;

/**
 * Top-of-page notice while FlyBudget can't reach its server mid-session. Everything
 * already loaded stays on screen; save buttons are disabled (useCanSave). When the
 * server is back, AuthGate refreshes the data and this says so briefly.
 */
export function ConnectionBanner() {
  const connection = useConnection();
  const reconnectedAt = useConnectionStore((s) => s.reconnectedAt);
  const [showReconnected, setShowReconnected] = useState(false);
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
          Can't reach FlyBudget. You can still look around; saving is paused.
        </span>
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
