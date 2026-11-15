import { useState } from 'react';
import { RefreshCw, Unlink, AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SyncStatusBadge } from './SyncStatusBadge';
import { HostedLinkWaiting } from './HostedLinkWaiting';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Button } from '../ui/Button';
import { useSyncItem, useDisconnectItem } from '../../hooks/usePlaid';
import { usePlaidHostedLink } from '../../hooks/usePlaidHostedLink';
import { formatDistanceToNow } from 'date-fns';
import type { PlaidItem } from '../../types';

interface Props {
  item: PlaidItem;
}

export function ConnectedInstitutionCard({ item }: Props) {
  const { t } = useTranslation();
  const [showDisconnect, setShowDisconnect] = useState(false);
  const syncItem = useSyncItem();
  const disconnectItem = useDisconnectItem();

  const isSyncing = syncItem.isPending || item.syncStatus === 'syncing';
  const initial = item.institutionName.charAt(0).toUpperCase();

  async function handleSync() {
    await syncItem.mutateAsync(item.id);
  }

  // Re-authenticate in the user's browser (Plaid update mode), then sync
  const reconnect = usePlaidHostedLink(() => syncItem.mutate(item.id));

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
              {t('banks.card.lastSynced', {
                ago: formatDistanceToNow(new Date(item.lastSyncedAt), { addSuffix: true }),
              })}
            </span>
          )}
        </div>

        {item.syncStatus === 'error' && item.syncError && (
          <div className="flex items-start gap-2 bg-negative-subtle border border-negative/10 rounded-md px-3 py-2">
            <AlertTriangle size={14} className="text-negative mt-0.5 shrink-0" />
            <p className="text-xs text-negative">{item.syncError}</p>
          </div>
        )}

        {reconnect.state.phase === 'waiting' && (
          <HostedLinkWaiting onReopen={reconnect.reopen} onCancel={reconnect.cancel} />
        )}
        {reconnect.state.phase === 'error' && (
          <p className="text-xs text-negative">{reconnect.state.message}</p>
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
            <p className="text-xs text-caution">{t('banks.plaid.card.loginRequired')}</p>
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
                  {acct.accountName ? `→ ${acct.accountName}` : t('banks.card.notLinked')}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={handleSync} disabled={isSyncing}>
            {isSyncing ? (
              <>
                <Loader2 size={12} className="animate-spin" /> {t('banks.card.syncing')}
              </>
            ) : (
              <>
                <RefreshCw size={12} /> {t('banks.card.syncNow')}
              </>
            )}
          </Button>

          {item.syncStatus === 'login_required' && reconnect.state.phase !== 'waiting' && (
            <button
              onClick={() => reconnect.start(item.id)}
              disabled={reconnect.state.phase === 'starting'}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-caution bg-caution-subtle border border-caution/20 rounded-md hover:opacity-80 disabled:opacity-50 transition-colors"
            >
              {t('banks.plaid.card.reconnect')}
            </button>
          )}

          <button
            onClick={() => setShowDisconnect(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-negative hover:bg-negative-subtle rounded-md transition-colors ml-auto"
          >
            <Unlink size={12} /> {t('banks.card.disconnect')}
          </button>
        </div>

        {syncItem.isSuccess && syncItem.data && (
          <p className="text-xs text-positive">
            {t('banks.plaid.card.synced', {
              added: syncItem.data.added,
              modified: syncItem.data.modified,
              removed: syncItem.data.removed,
            })}
          </p>
        )}
      </div>

      <ConfirmModal
        isOpen={showDisconnect}
        onClose={() => setShowDisconnect(false)}
        onConfirm={handleDisconnect}
        title={t('banks.plaid.disconnect.title')}
        message={t('banks.plaid.disconnect.message', { name: item.institutionName })}
        confirmLabel={t('banks.card.disconnect')}
        danger
      />
    </>
  );
}
