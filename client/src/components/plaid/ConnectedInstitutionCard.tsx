import { useState, useCallback } from 'react';
import { RefreshCw, Unlink, AlertTriangle, Loader2 } from 'lucide-react';
import { SyncStatusBadge } from './SyncStatusBadge';
import { PlaidLinkButton } from './PlaidLinkButton';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Button } from '../ui/Button';
import { useSyncItem, useDisconnectItem, useCreateUpdateLinkToken } from '../../hooks/usePlaid';
import { formatDistanceToNow } from 'date-fns';
import type { PlaidItem } from '../../types';

interface Props {
  item: PlaidItem;
}

export function ConnectedInstitutionCard({ item }: Props) {
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [updateLinkToken, setUpdateLinkToken] = useState<string | null>(null);
  const syncItem = useSyncItem();
  const disconnectItem = useDisconnectItem();
  const createUpdateLink = useCreateUpdateLinkToken();

  const isSyncing = syncItem.isPending || item.syncStatus === 'syncing';
  const initial = item.institutionName.charAt(0).toUpperCase();

  async function handleSync() {
    await syncItem.mutateAsync(item.id);
  }

  async function handleReconnect() {
    try {
      const { linkToken } = await createUpdateLink.mutateAsync(item.id);
      setUpdateLinkToken(linkToken);
    } catch {
      // handled by mutation state
    }
  }

  const handleUpdateSuccess = useCallback(() => {
    setUpdateLinkToken(null);
    syncItem.mutate(item.id);
  }, [item.id, syncItem]);

  function handleDisconnect() {
    // Errors (e.g. Plaid unreachable, so access couldn't be revoked) are shown on the card
    disconnectItem.mutate(item.id);
  }

  const enabledAccounts = item.accounts.filter((a) => a.isEnabled);

  return (
    <>
      <div className="bg-surface border border-border-light rounded-lg p-5 space-y-4 shadow-card">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center text-white font-semibold text-sm">
              {initial}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text">{item.institutionName}</h3>
              <SyncStatusBadge status={item.syncStatus} className="mt-0.5" />
            </div>
          </div>
          {item.lastSyncedAt && (
            <span className="text-xs text-text-tertiary">
              Last synced {formatDistanceToNow(new Date(item.lastSyncedAt), { addSuffix: true })}
            </span>
          )}
        </div>

        {item.syncStatus === 'error' && item.syncError && (
          <div className="flex items-start gap-2 bg-negative-subtle border border-negative/10 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="text-negative mt-0.5 shrink-0" />
            <p className="text-xs text-negative">{item.syncError}</p>
          </div>
        )}

        {disconnectItem.isError && (
          <div className="flex items-start gap-2 bg-negative-subtle border border-negative/10 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="text-negative mt-0.5 shrink-0" />
            <p className="text-xs text-negative">{disconnectItem.error.message}</p>
          </div>
        )}

        {item.syncStatus === 'login_required' && (
          <div className="flex items-start gap-2 bg-caution-subtle border border-caution/10 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="text-caution mt-0.5 shrink-0" />
            <p className="text-xs text-caution">
              Your bank requires you to re-authenticate. Click "Reconnect" to update your
              credentials.
            </p>
          </div>
        )}

        {enabledAccounts.length > 0 && (
          <div className="space-y-1.5">
            {enabledAccounts.map((acct) => (
              <div
                key={acct.plaidAccountId}
                className="flex items-center justify-between text-xs text-text-secondary"
              >
                <span>
                  <span className="capitalize">{acct.plaidAccountType}</span>
                  {acct.mask && <span className="text-text-tertiary ml-1">****{acct.mask}</span>}
                </span>
                <span className="text-text-tertiary">
                  {acct.accountName ? `→ ${acct.accountName}` : 'Not linked'}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={handleSync} disabled={isSyncing}>
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

          {item.syncStatus === 'login_required' && !updateLinkToken && (
            <button
              onClick={handleReconnect}
              disabled={createUpdateLink.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-caution bg-caution-subtle border border-caution/20 rounded-md hover:opacity-80 disabled:opacity-50 transition-colors"
            >
              Reconnect
            </button>
          )}

          {updateLinkToken && (
            <PlaidLinkButton
              linkToken={updateLinkToken}
              onSuccess={handleUpdateSuccess}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-caution bg-caution-subtle border border-caution/20 rounded-md hover:opacity-80 transition-colors"
            >
              Open Link to Reconnect
            </PlaidLinkButton>
          )}

          <button
            onClick={() => setShowDisconnect(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-negative hover:bg-negative-subtle rounded-md transition-colors ml-auto"
          >
            <Unlink size={12} /> Disconnect
          </button>
        </div>

        {syncItem.isSuccess && syncItem.data && (
          <p className="text-xs text-positive">
            Synced: {syncItem.data.added} added, {syncItem.data.modified} modified,{' '}
            {syncItem.data.removed} removed.
          </p>
        )}
      </div>

      <ConfirmModal
        isOpen={showDisconnect}
        onClose={() => setShowDisconnect(false)}
        onConfirm={handleDisconnect}
        title="Disconnect Institution"
        message={`Are you sure you want to disconnect ${item.institutionName}? This revokes FlyBudget's access to this bank at Plaid. Your existing accounts and transactions will not be deleted.`}
        confirmLabel="Disconnect"
        danger
      />
    </>
  );
}
