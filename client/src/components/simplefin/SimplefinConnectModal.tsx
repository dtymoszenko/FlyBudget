import { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, Link2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  useSetupSimplefin,
  useMapSimplefinAccounts,
  useSyncSimplefinConnection,
} from '../../hooks/useSimplefin';
import { useAccounts } from '../../hooks/useAccounts';
import { formatCurrency } from '../../utils/currency';
import type {
  SimplefinDiscoveredAccount,
  SimplefinSetupResult,
  AccountType,
  Account,
} from '../../types';
import type { SimplefinAccountMappingAction } from '../../api/simplefin';
import { IS_DEMO } from '../../demo/demoApi';
import { NotInDemoModal } from '../demo/NotInDemo';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialSetupResult?: SimplefinSetupResult;
}

type Step = 'token' | 'mapping' | 'syncing' | 'done';

interface MappingChoice {
  simplefinAccountId: string;
  action: 'create' | 'link' | 'skip';
  accountId?: string;
  accountName: string;
  accountType: AccountType;
}

// The demo has no server to talk to the bank, so it explains that instead
export function SimplefinConnectModal(props: Props) {
  return IS_DEMO ? (
    <NotInDemoModal isOpen={props.isOpen} onClose={props.onClose} />
  ) : (
    <SimplefinConnectModalDialog {...props} />
  );
}

function SimplefinConnectModalDialog({ isOpen, onClose, initialSetupResult }: Props) {
  const [step, setStep] = useState<Step>('token');
  const [token, setToken] = useState('');
  const [setupResult, setSetupResult] = useState<SimplefinSetupResult | null>(null);
  const [mappings, setMappings] = useState<MappingChoice[]>([]);
  const [syncSummary, setSyncSummary] = useState<{ added: number; accounts: number } | null>(null);

  useEffect(() => {
    if (isOpen && initialSetupResult) {
      setSetupResult(initialSetupResult);
      setMappings(
        initialSetupResult.accounts.map((a: SimplefinDiscoveredAccount) => ({
          simplefinAccountId: a.simplefinAccountId,
          action: 'create' as const,
          accountName: a.name,
          accountType: 'checking' as AccountType,
        })),
      );
      setStep('mapping');
    }
  }, [isOpen, initialSetupResult]);

  const setupSimplefin = useSetupSimplefin();
  const mapAccounts = useMapSimplefinAccounts();
  const syncConnection = useSyncSimplefinConnection();
  const { data: existingAccounts = [] } = useAccounts();

  const linkedAccountIds = new Set(
    mappings.filter((m) => m.action === 'link').map((m) => m.accountId),
  );

  async function handleSetup() {
    try {
      const result = await setupSimplefin.mutateAsync(token);
      setSetupResult(result);
      setMappings(
        result.accounts.map((a: SimplefinDiscoveredAccount) => ({
          simplefinAccountId: a.simplefinAccountId,
          action: 'create' as const,
          accountName: a.name,
          accountType: 'checking' as AccountType,
        })),
      );
      setStep('mapping');
    } catch {
      // Error handled by mutation state
    }
  }

  function updateMapping(simplefinAccountId: string, updates: Partial<MappingChoice>) {
    setMappings((prev) =>
      prev.map((m) => (m.simplefinAccountId === simplefinAccountId ? { ...m, ...updates } : m)),
    );
  }

  async function handleSaveAndSync() {
    if (!setupResult) return;

    const actions: SimplefinAccountMappingAction[] = mappings.map((m) => ({
      simplefinAccountId: m.simplefinAccountId,
      action: m.action,
      accountId: m.action === 'link' ? m.accountId : undefined,
      accountName: m.action === 'create' ? m.accountName : undefined,
      accountType: m.action === 'create' ? m.accountType : undefined,
    }));

    setStep('syncing');

    try {
      await mapAccounts.mutateAsync({ connectionId: setupResult.connectionId, mappings: actions });
      const syncResult = await syncConnection.mutateAsync(setupResult.connectionId);
      const activeCount = mappings.filter((m) => m.action !== 'skip').length;
      setSyncSummary({ added: syncResult.added, accounts: activeCount });
      setStep('done');
    } catch {
      setStep('done');
      setSyncSummary({ added: 0, accounts: 0 });
    }
  }

  function handleClose() {
    setStep('token');
    setToken('');
    setSetupResult(null);
    setMappings([]);
    setSyncSummary(null);
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Connect via SimpleFIN" size="lg">
      {step === 'token' && (
        <div className="space-y-5">
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-lg bg-brand-50 flex items-center justify-center mx-auto mb-4">
              <Link2 size={32} className="text-brand-600" />
            </div>
            <h3 className="text-sm font-semibold text-text">Connect with SimpleFIN Bridge</h3>
            <p className="text-xs text-text-secondary mt-2 max-w-sm mx-auto leading-relaxed">
              Visit{' '}
              <a
                href="https://beta-bridge.simplefin.org/simplefin/create"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 underline"
              >
                SimpleFIN Bridge
              </a>{' '}
              to create a setup token, then paste it below. SimpleFIN costs $1.50/month paid
              directly to them.
            </p>
          </div>

          <div className="space-y-3">
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your SimpleFIN setup token..."
              className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600 font-mono"
            />
            <div className="flex justify-center">
              <Button onClick={handleSetup} disabled={!token.trim() || setupSimplefin.isPending}>
                {setupSimplefin.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Connecting...
                  </>
                ) : (
                  'Connect'
                )}
              </Button>
            </div>
          </div>

          {setupSimplefin.isError && (
            <p className="text-xs text-negative text-center">
              {(setupSimplefin.error as any)?.message ||
                'Failed to connect. Check your setup token and try again.'}
            </p>
          )}
        </div>
      )}

      {step === 'mapping' && setupResult && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-text">{setupResult.connectionName}</h3>
            <p className="text-xs text-text-secondary mt-0.5">
              Choose how to set up each discovered account.
            </p>
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto">
            {setupResult.accounts.map((account) => {
              const mapping = mappings.find(
                (m) => m.simplefinAccountId === account.simplefinAccountId,
              )!;
              return (
                <SimplefinAccountMappingCard
                  key={account.simplefinAccountId}
                  account={account}
                  mapping={mapping}
                  existingAccounts={existingAccounts}
                  linkedAccountIds={linkedAccountIds}
                  onChange={(updates) => updateMapping(account.simplefinAccountId, updates)}
                />
              );
            })}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveAndSync}
              disabled={mappings.every((m) => m.action === 'skip')}
            >
              Save & Sync
            </Button>
          </div>
        </div>
      )}

      {step === 'syncing' && (
        <div className="text-center py-10">
          <Loader2 size={40} className="animate-spin text-brand-500 mx-auto mb-4" />
          <h3 className="text-sm font-semibold text-text">Syncing Transactions</h3>
          <p className="text-xs text-text-secondary mt-1">
            Importing your transactions. This may take a moment...
          </p>
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-10">
          <div className="w-16 h-16 rounded-full bg-positive-subtle flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-positive" />
          </div>
          <h3 className="text-sm font-semibold text-text">Connection Complete</h3>
          {syncSummary && (
            <p className="text-xs text-text-secondary mt-1">
              Imported {syncSummary.added} transaction{syncSummary.added !== 1 ? 's' : ''} across{' '}
              {syncSummary.accounts} account{syncSummary.accounts !== 1 ? 's' : ''}.
            </p>
          )}
          <Button onClick={handleClose} className="mt-6">
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}

interface SimplefinAccountMappingCardProps {
  account: SimplefinDiscoveredAccount;
  mapping: MappingChoice;
  existingAccounts: Account[];
  linkedAccountIds: Set<string | undefined>;
  onChange: (updates: Partial<MappingChoice>) => void;
}

function SimplefinAccountMappingCard({
  account,
  mapping,
  existingAccounts,
  linkedAccountIds,
  onChange,
}: SimplefinAccountMappingCardProps) {
  const availableAccounts = existingAccounts.filter(
    (a) => !a.closedAt && (!linkedAccountIds.has(a.id) || mapping.accountId === a.id),
  );

  return (
    <div className="bg-brand-50 border border-brand-100 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">{account.name}</span>
        <span className="text-sm font-medium text-text-secondary">
          {formatCurrency(account.balance)}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() =>
            onChange({ action: 'create', accountName: account.name, accountType: 'checking' })
          }
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            mapping.action === 'create'
              ? 'bg-brand-600 text-white'
              : 'bg-surface text-text-secondary border border-border hover:bg-surface-alt'
          }`}
        >
          Create New
        </button>
        <button
          onClick={() => onChange({ action: 'link' })}
          disabled={availableAccounts.length === 0}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            mapping.action === 'link'
              ? 'bg-brand-600 text-white'
              : 'bg-surface text-text-secondary border border-border hover:bg-surface-alt disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          Link Existing
        </button>
        <button
          onClick={() => onChange({ action: 'skip' })}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            mapping.action === 'skip'
              ? 'bg-text-secondary text-white'
              : 'bg-surface text-text-secondary border border-border hover:bg-surface-alt'
          }`}
        >
          Skip
        </button>
      </div>

      {mapping.action === 'link' && (
        <select
          value={mapping.accountId ?? ''}
          onChange={(e) => onChange({ accountId: e.target.value })}
          className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
        >
          <option value="">Select an account...</option>
          {availableAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({formatCurrency(a.balance)})
            </option>
          ))}
        </select>
      )}

      {mapping.action === 'create' && (
        <input
          type="text"
          value={mapping.accountName}
          onChange={(e) => onChange({ accountName: e.target.value })}
          placeholder="Account name"
          className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
        />
      )}
    </div>
  );
}
