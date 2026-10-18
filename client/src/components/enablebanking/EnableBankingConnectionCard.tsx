import { useState } from 'react';
import { AlertTriangle, KeyRound, Loader2, RefreshCw, Unlink } from 'lucide-react';
import { differenceInCalendarDays, formatDistanceToNow } from 'date-fns';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Button } from '../ui/Button';
import { SyncStatusBadge } from '../plaid/SyncStatusBadge';
import { useCanSave } from '../../hooks/useConnection';
import {
  useDisconnectEnableBanking,
  useSyncEnableBankingConnection,
} from '../../hooks/useEnableBanking';
import { formatDay } from '../../utils/dates';
import type { EnableBankingConnection } from '../../types';
import { ConnectEnableBankingModal } from './ConnectEnableBankingModal';

/** Warn this many days before the bank's access ends */
const EXPIRY_WARNING_DAYS = 7;

export function EnableBankingConnectionCard({
  connection,
}: {
  connection: EnableBankingConnection;
}) {
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [showReconnect, setShowReconnect] = useState(false);
  const sync = useSyncEnableBankingConnection();
  const disconnect = useDisconnectEnableBanking();
  const canSave = useCanSave();

  const isSyncing = sync.isPending || connection.syncStatus === 'syncing';
  const enabled = connection.accounts.filter((a) => a.isEnabled);
  const daysLeft = connection.validUntil
    ? differenceInCalendarDays(new Date(connection.validUntil), new Date())
    : null;
  const needsLogin =
    connection.syncStatus === 'login_required' || (daysLeft !== null && daysLeft < 0);
  const lastSkipped = sync.data
    ? sync.data.skipped.noDate + sync.data.skipped.badAmount + sync.data.skipped.otherCurrency
    : 0;

  return (
    <>
      <div className="bg-surface border border-border-light rounded-lg p-5 space-y-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center text-white font-semibold text-sm shrink-0">
              {connection.aspspName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-text truncate">{connection.aspspName}</h3>
                <span className="text-[10px] font-medium text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">
                  Enable Banking
                </span>
              </div>
              <SyncStatusBadge
                status={needsLogin ? 'login_required' : connection.syncStatus}
                className="mt-0.5"
              />
            </div>
          </div>
          {connection.lastSyncedAt && (
            <span className="text-xs text-text-tertiary">
              Last synced{' '}
              {formatDistanceToNow(new Date(connection.lastSyncedAt), { addSuffix: true })}
            </span>
          )}
        </div>

        {needsLogin ? (
          <div className="flex items-start gap-2 bg-caution-subtle border border-caution/20 rounded-md px-3 py-2">
            <KeyRound size={14} className="text-caution mt-0.5 shrink-0" />
            <p className="text-xs text-text">
              Your bank&apos;s access for FlyBudget has ended (banks ask again every few months).
              Reconnect to keep syncing; your accounts and history stay as they are.
            </p>
          </div>
        ) : (
          connection.syncStatus === 'error' &&
          connection.syncError && (
            <div className="flex items-start gap-2 bg-negative-subtle border border-negative/10 rounded-md px-3 py-2">
              <AlertTriangle size={14} className="text-negative mt-0.5 shrink-0" />
              <p className="text-xs text-negative">{connection.syncError}</p>
            </div>
          )
        )}

        {enabled.length > 0 && (
          <div className="space-y-1.5">
            {enabled.map((acct) => (
              <div
                key={acct.mappingId}
                className="flex items-center justify-between gap-3 text-xs text-text-secondary"
              >
                <span className="truncate">{acct.name}</span>
                <span className="text-text-tertiary shrink-0">
                  {acct.accountName ? `→ ${acct.accountName}` : 'Not linked'}
                </span>
              </div>
            ))}
          </div>
        )}

        {!needsLogin && daysLeft !== null && (
          <p
            className={`text-xs ${daysLeft <= EXPIRY_WARNING_DAYS ? 'text-caution' : 'text-text-tertiary'}`}
          >
            {daysLeft === 0
              ? 'Bank access ends today. Reconnect to keep syncing.'
              : `Bank access ends on ${formatDay(connection.validUntil!.slice(0, 10))} (in ${daysLeft} day${daysLeft === 1 ? '' : 's'})${
                  daysLeft <= EXPIRY_WARNING_DAYS ? '. Reconnect to keep syncing.' : ''
                }`}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {needsLogin || (daysLeft !== null && daysLeft <= EXPIRY_WARNING_DAYS) ? (
            <Button size="sm" onClick={() => setShowReconnect(true)} disabled={!canSave}>
              <KeyRound size={12} /> Reconnect
            </Button>
          ) : null}
          {!needsLogin && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => sync.mutate({ connectionId: connection.id })}
              disabled={isSyncing || !canSave}
            >
              {isSyncing ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Syncing…
                </>
              ) : (
                <>
                  <RefreshCw size={12} /> Sync now
                </>
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDisconnect(true)}
            className="ml-auto text-negative"
          >
            <Unlink size={12} /> Disconnect
          </Button>
        </div>

        {sync.isSuccess && sync.data && sync.data.errors.length === 0 && (
          <p className="text-xs text-positive">
            Synced: {sync.data.added} new transaction{sync.data.added === 1 ? '' : 's'}
            {lastSkipped > 0 ? `, ${lastSkipped} left out (no date or unreadable amount)` : ''}.
          </p>
        )}
        {sync.isError && <p className="text-xs text-negative">{(sync.error as Error).message}</p>}
        {disconnect.isError && (
          <p className="text-xs text-negative" role="alert">
            {(disconnect.error as Error).message}
          </p>
        )}
      </div>

      <ConfirmModal
        isOpen={showDisconnect}
        onClose={() => setShowDisconnect(false)}
        onConfirm={() => disconnect.mutate(connection.id)}
        title={`Disconnect ${connection.aspspName}`}
        message={`FlyBudget will end its access to ${connection.aspspName} at Enable Banking and stop syncing. Your accounts and transactions stay in FlyBudget.`}
        confirmLabel="Disconnect"
        danger
      />
      <ConnectEnableBankingModal
        isOpen={showReconnect}
        onClose={() => setShowReconnect(false)}
        reconnect={{ connectionId: connection.id, bankName: connection.aspspName }}
      />
    </>
  );
}
