import { useState } from 'react';
import { RefreshCw, Unlink, AlertTriangle, Loader2 } from 'lucide-react';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Button } from '../ui/Button';
import { useSyncSimplefinConnection, useDisconnectSimplefin } from '../../hooks/useSimplefin';
import { formatDistanceToNow } from 'date-fns';
import type { SimplefinConnection, SimplefinSyncStatus } from '../../types';

const statusConfig: Record<SimplefinSyncStatus, { dot: string; label: string }> = {
  good: { dot: 'bg-positive', label: 'Synced' },
  syncing: { dot: '', label: 'Syncing...' },
  error: { dot: 'bg-negative', label: 'Error' },
};

interface Props {
  connection: SimplefinConnection;
}

export function SimplefinConnectionCard({ connection }: Props) {
  const [showDisconnect, setShowDisconnect] = useState(false);
  const syncConnection = useSyncSimplefinConnection();
  const disconnectConnection = useDisconnectSimplefin();

  const isSyncing = syncConnection.isPending || connection.syncStatus === 'syncing';
  const initial = connection.connectionName.charAt(0).toUpperCase();
  const statusCfg = statusConfig[connection.syncStatus];
  const enabledAccounts = connection.accounts.filter((a) => a.isEnabled);

  return (
    <>
      <div className="bg-surface border border-border-light rounded-lg p-5 space-y-4 shadow-card">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center text-white font-semibold text-sm">
              {initial}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-text">{connection.connectionName}</h3>
                <span className="text-[10px] font-medium text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">
                  SimpleFIN
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary mt-0.5">
                {connection.syncStatus === 'syncing' ? (
                  <Loader2 size={12} className="animate-spin text-brand-500" />
                ) : (
                  <span className={`w-2 h-2 rounded-full ${statusCfg.dot}`} />
                )}
                {statusCfg.label}
              </span>
            </div>
          </div>
          {connection.lastSyncedAt && (
            <span className="text-xs text-text-tertiary">
              Last synced{' '}
              {formatDistanceToNow(new Date(connection.lastSyncedAt), { addSuffix: true })}
            </span>
          )}
        </div>

        {connection.syncStatus === 'error' && connection.syncError && (
          <div className="flex items-start gap-2 bg-negative-subtle border border-negative/10 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="text-negative mt-0.5 shrink-0" />
            <p className="text-xs text-negative">{connection.syncError}</p>
          </div>
        )}

        {enabledAccounts.length > 0 && (
          <div className="space-y-1.5">
            {enabledAccounts.map((acct) => (
              <div
                key={acct.simplefinAccountId}
                className="flex items-center justify-between text-xs text-text-secondary"
              >
                <span>{acct.simplefinAccountName}</span>
                <span className="text-text-tertiary">
                  {acct.accountName ? `→ ${acct.accountName}` : 'Not linked'}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => syncConnection.mutate(connection.id)}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Syncing...
              </>
            ) : (
              <>
                <RefreshCw size={12} /> Sync Now
              </>
            )}
          </Button>

          <button
            onClick={() => setShowDisconnect(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-negative hover:bg-negative-subtle rounded-md transition-colors ml-auto"
          >
            <Unlink size={12} /> Disconnect
          </button>
        </div>

        {syncConnection.isSuccess && syncConnection.data && (
          <p className="text-xs text-positive">
            Synced: {syncConnection.data.added} new transactions imported.
          </p>
        )}
      </div>

      <ConfirmModal
        isOpen={showDisconnect}
        onClose={() => setShowDisconnect(false)}
        onConfirm={() => disconnectConnection.mutateAsync(connection.id)}
        title="Disconnect SimpleFIN"
        message={`Are you sure you want to disconnect ${connection.connectionName}? FlyBudget will delete its stored access. To revoke it completely, also remove this app from your SimpleFIN Bridge account at bridge.simplefin.org. Your existing accounts and transactions will not be deleted.`}
        confirmLabel="Disconnect"
        danger
      />
    </>
  );
}
