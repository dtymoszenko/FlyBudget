import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CloudOff, Loader2, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useConnection } from '../../hooks/useConnection';
import { useOutbox } from '../../offline/outbox';
import { shownDataAsOf } from '../../offline/snapshot';
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
  const { t } = useTranslation();
  const connection = useConnection();
  const reconnectedAt = useConnectionStore((s) => s.reconnectedAt);
  const [showReconnected, setShowReconnected] = useState(false);
  const qc = useQueryClient();
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
    const timer = setTimeout(() => setShowReconnected(false), RECONNECTED_MS);
    return () => clearTimeout(timer);
  }, [connection.status, reconnectedAt]);

  if (connection.status === 'reconnecting') {
    // Worked out on each render: the countdown re-renders this every moment while offline
    const dataAsOf = shownDataAsOf(qc);
    return (
      <div
        role="status"
        aria-label={t('connection.banner.label')}
        className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm bg-caution-subtle text-text border-b border-caution/30"
      >
        <CloudOff size={16} className="text-caution shrink-0" aria-hidden />
        <span className="font-medium">
          {t('connection.banner.cantReach')}{' '}
          {dataAsOf !== null
            ? t('connection.banner.dataAsOf', {
                ago: formatDistanceToNow(dataAsOf, { addSuffix: true }),
              })
            : t('connection.banner.lookAround')}{' '}
          {t(canWait ? 'connection.banner.savedOnDevice' : 'connection.banner.savingPaused')}
        </span>
        {waiting > 0 && (
          <span className="text-text-secondary">
            {t('connection.banner.waiting', { count: waiting })}
          </span>
        )}
        <span className="text-text-secondary tabular-nums" aria-live="off">
          {retryLabel(connection, 'retrying')}
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
          {t('connection.banner.retryNow')}
        </button>
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div
        role="status"
        aria-label={t('connection.banner.label')}
        className="shrink-0 flex items-center gap-2 px-4 py-2 text-sm bg-positive-subtle text-text border-b border-positive/30 animate-fade-in"
      >
        <CheckCircle2 size={16} className="text-positive shrink-0" aria-hidden />
        {t('connection.banner.reconnected')}
      </div>
    );
  }

  return null;
}
