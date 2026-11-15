import { useState } from 'react';
import { Loader2, CheckCircle2, Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { HostedLinkWaiting } from './HostedLinkWaiting';
import { useMapAccounts, useSyncItem } from '../../hooks/usePlaid';
import { usePlaidHostedLink } from '../../hooks/usePlaidHostedLink';
import { useAccounts } from '../../hooks/useAccounts';
import { formatCurrency, formatMoney } from '../../utils/currency';
import type {
  PlaidDiscoveredAccount,
  PlaidExchangeResult,
  AccountType,
  Account,
} from '../../types';
import type { AccountMappingAction } from '../../api/plaid';
import { IS_DEMO } from '../../demo/demoApi';
import { NotInDemoModal } from '../demo/NotInDemo';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'link' | 'mapping' | 'syncing' | 'done';

interface MappingChoice {
  plaidAccountId: string;
  action: 'create' | 'link' | 'skip';
  accountId?: string;
  accountName: string;
  accountType: AccountType;
}

// The demo has no server to talk to the bank, so it explains that instead
export function ConnectBankModal(props: Props) {
  return IS_DEMO ? (
    <NotInDemoModal isOpen={props.isOpen} onClose={props.onClose} />
  ) : (
    <ConnectBankModalDialog {...props} />
  );
}

function ConnectBankModalDialog({ isOpen, onClose }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('link');
  const [exchangeResult, setExchangeResult] = useState<PlaidExchangeResult | null>(null);
  const [mappings, setMappings] = useState<MappingChoice[]>([]);
  const [syncSummary, setSyncSummary] = useState<{ added: number; accounts: number } | null>(null);

  const mapAccounts = useMapAccounts();
  const syncItem = useSyncItem();
  const { data: existingAccounts = [] } = useAccounts();

  const linkedAccountIds = new Set(
    mappings.filter((m) => m.action === 'link').map((m) => m.accountId),
  );

  // The server exchanges the token itself; we only receive the discovered accounts
  const hostedLink = usePlaidHostedLink((result) => {
    if (!result) return;
    setExchangeResult(result);
    setMappings(
      result.accounts.map((a: PlaidDiscoveredAccount) => ({
        plaidAccountId: a.plaidAccountId,
        action: 'create' as const,
        accountName: a.name,
        accountType: a.suggestedType,
      })),
    );
    setStep('mapping');
  });
  const linkState = hostedLink.state;

  function updateMapping(plaidAccountId: string, updates: Partial<MappingChoice>) {
    setMappings((prev) =>
      prev.map((m) => (m.plaidAccountId === plaidAccountId ? { ...m, ...updates } : m)),
    );
  }

  async function handleSaveAndSync() {
    if (!exchangeResult) return;

    const actions: AccountMappingAction[] = mappings.map((m) => ({
      plaidAccountId: m.plaidAccountId,
      action: m.action,
      accountId: m.action === 'link' ? m.accountId : undefined,
      accountName: m.action === 'create' ? m.accountName : undefined,
      accountType: m.action === 'create' ? m.accountType : undefined,
    }));

    setStep('syncing');

    try {
      await mapAccounts.mutateAsync({ itemId: exchangeResult.itemId, mappings: actions });
      const syncResult = await syncItem.mutateAsync(exchangeResult.itemId);
      const activeCount = mappings.filter((m) => m.action !== 'skip').length;
      setSyncSummary({ added: syncResult.added, accounts: activeCount });
      setStep('done');
    } catch {
      setStep('done');
      setSyncSummary({ added: 0, accounts: 0 });
    }
  }

  function handleClose() {
    hostedLink.cancel();
    setStep('link');
    setExchangeResult(null);
    setMappings([]);
    setSyncSummary(null);
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('banks.plaid.connect.title')} size="lg">
      {step === 'link' && (
        <div className="space-y-5">
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-lg bg-brand-50 flex items-center justify-center mx-auto mb-4">
              <Building2 size={32} className="text-brand-600" />
            </div>
            <h3 className="text-sm font-semibold text-text">{t('banks.plaid.connect.heading')}</h3>
            <p className="text-xs text-text-secondary mt-2 max-w-sm mx-auto leading-relaxed">
              {t('banks.plaid.connect.hint')}
            </p>
          </div>

          {linkState.phase === 'waiting' ? (
            <HostedLinkWaiting onReopen={hostedLink.reopen} onCancel={hostedLink.cancel} />
          ) : (
            <div className="flex justify-center">
              <Button onClick={() => hostedLink.start()} disabled={linkState.phase === 'starting'}>
                {linkState.phase === 'starting' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />{' '}
                    {t('banks.plaid.connect.preparing')}
                  </>
                ) : (
                  <>
                    <Building2 size={16} /> {t('banks.plaid.connect.button')}
                  </>
                )}
              </Button>
            </div>
          )}

          {linkState.phase === 'error' && (
            <p className="text-xs text-negative text-center">{linkState.message}</p>
          )}
          {linkState.phase === 'idle' && linkState.message && (
            <p className="text-xs text-text-secondary text-center">{linkState.message}</p>
          )}
        </div>
      )}

      {step === 'mapping' && exchangeResult && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-text">{exchangeResult.institutionName}</h3>
            <p className="text-xs text-text-secondary mt-0.5">{t('banks.mapping.hint')}</p>
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto">
            {exchangeResult.accounts.map((account) => {
              const mapping = mappings.find((m) => m.plaidAccountId === account.plaidAccountId)!;
              return (
                <AccountMappingCard
                  key={account.plaidAccountId}
                  account={account}
                  mapping={mapping}
                  existingAccounts={existingAccounts}
                  linkedAccountIds={linkedAccountIds}
                  onChange={(updates) => updateMapping(account.plaidAccountId, updates)}
                />
              );
            })}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={handleClose}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              onClick={handleSaveAndSync}
              disabled={mappings.every((m) => m.action === 'skip')}
            >
              {t('banks.mapping.saveAndSync')}
            </Button>
          </div>
        </div>
      )}

      {step === 'syncing' && (
        <div className="text-center py-10">
          <Loader2 size={40} className="animate-spin text-brand-500 mx-auto mb-4" />
          <h3 className="text-sm font-semibold text-text">{t('banks.syncing.title')}</h3>
          <p className="text-xs text-text-secondary mt-1">{t('banks.syncing.hint')}</p>
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-10">
          <div className="w-16 h-16 rounded-full bg-positive-subtle flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-positive" />
          </div>
          <h3 className="text-sm font-semibold text-text">{t('banks.done.title')}</h3>
          {syncSummary && (
            <p className="text-xs text-text-secondary mt-1">
              {t('banks.done.imported', {
                transactions: t('banks.done.transactions', { count: syncSummary.added }),
                accounts: t('banks.done.accounts', { count: syncSummary.accounts }),
              })}
            </p>
          )}
          <Button onClick={handleClose} className="mt-6">
            {t('common.actions.done')}
          </Button>
        </div>
      )}
    </Modal>
  );
}

interface AccountMappingCardProps {
  account: PlaidDiscoveredAccount;
  mapping: MappingChoice;
  existingAccounts: Account[];
  linkedAccountIds: Set<string | undefined>;
  onChange: (updates: Partial<MappingChoice>) => void;
}

function AccountMappingCard({
  account,
  mapping,
  existingAccounts,
  linkedAccountIds,
  onChange,
}: AccountMappingCardProps) {
  const { t } = useTranslation();
  const availableAccounts = existingAccounts.filter(
    (a) => !a.closedAt && (!linkedAccountIds.has(a.id) || mapping.accountId === a.id),
  );

  return (
    <div className="bg-brand-50 border border-brand-100 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-text">{account.name}</span>
          {account.mask && (
            <span className="text-xs text-text-tertiary ml-2">****{account.mask}</span>
          )}
        </div>
        <span className="text-sm font-medium text-text-secondary">
          {formatCurrency(account.currentBalance)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-text-tertiary capitalize">
          {account.type}
          {account.subtype ? ` · ${account.subtype}` : ''}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() =>
            onChange({
              action: 'create',
              accountName: account.name,
              accountType: account.suggestedType,
            })
          }
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            mapping.action === 'create'
              ? 'bg-brand-600 text-white'
              : 'bg-surface text-text-secondary border border-border hover:bg-surface-alt'
          }`}
        >
          {t('banks.mapping.createNew')}
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
          {t('banks.mapping.linkExisting')}
        </button>
        <button
          onClick={() => onChange({ action: 'skip' })}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            mapping.action === 'skip'
              ? 'bg-text-secondary text-white'
              : 'bg-surface text-text-secondary border border-border hover:bg-surface-alt'
          }`}
        >
          {t('banks.mapping.skip')}
        </button>
      </div>

      {mapping.action === 'link' && (
        <select
          value={mapping.accountId ?? ''}
          onChange={(e) => onChange({ accountId: e.target.value })}
          className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
        >
          <option value="">{t('banks.mapping.selectAccount')}</option>
          {availableAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({formatMoney(a.balance, a.currency)})
            </option>
          ))}
        </select>
      )}

      {mapping.action === 'create' && (
        <input
          type="text"
          value={mapping.accountName}
          onChange={(e) => onChange({ accountName: e.target.value })}
          placeholder={t('banks.mapping.accountName')}
          className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
        />
      )}
    </div>
  );
}
