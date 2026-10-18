import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Landmark,
  Loader2,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useCanSave } from '../../hooks/useConnection';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import { useAccounts } from '../../hooks/useAccounts';
import { useFormReset } from '../../hooks/useFormReset';
import {
  useEnableBankingBanks,
  useEnableBankingLogin,
  useEnableBankingStatus,
  useMapEnableBankingAccounts,
  useSyncEnableBankingConnection,
} from '../../hooks/useEnableBanking';
import { ACCOUNT_TYPES } from '../../types';
import type {
  Account,
  AccountType,
  EnableBankingConnectionResult,
  EnableBankingDiscoveredAccount,
  EnableBankingSyncResult,
} from '../../types';
import type { EnableBankingMappingAction } from '../../api/enableBanking';
import { IS_DEMO } from '../../demo/demoApi';
import { NotInDemoModal } from '../demo/NotInDemo';
import { ENABLE_BANKING_GUIDE_URL, EnableBankingSetupForm } from './EnableBankingSetupForm';

/** Countries Enable Banking connects banks in (the EEA) */
const COUNTRIES = [
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IS',
  'IT',
  'LI',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
];

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The country of the device's language (de-AT → AT), if Enable Banking covers it */
function defaultCountry(): string {
  for (const lang of navigator.languages ?? [navigator.language]) {
    const region = lang.split('-')[1]?.toUpperCase();
    if (region && COUNTRIES.includes(region)) return region;
  }
  return '';
}

const maskIban = (iban: string) => `${iban.slice(0, 4)} •••• ${iban.slice(-4)}`;

type Step = 'setup' | 'bank' | 'reconnect' | 'browser' | 'mapping' | 'syncing' | 'done';

interface MappingChoice {
  mappingId: string;
  action: 'create' | 'link' | 'skip';
  accountId?: string;
  accountName: string;
  accountType: AccountType;
  /** Linked to an account with history: bring in everything the bank has, not just recent */
  fullHistory: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Log in again for this connection (its access ended) instead of adding a bank */
  reconnect?: { connectionId: string; bankName: string };
}

// The demo has no server to talk to the bank, so it explains that instead
export function ConnectEnableBankingModal(props: Props) {
  return IS_DEMO ? (
    <NotInDemoModal isOpen={props.isOpen} onClose={props.onClose} />
  ) : (
    <ConnectEnableBankingDialog {...props} />
  );
}

function choicesFor(result: EnableBankingConnectionResult): MappingChoice[] {
  return result.accounts.map((a) => {
    const linkTo = a.accountId ?? a.suggestedAccountId;
    return {
      mappingId: a.mappingId,
      action: a.accountId || a.isEnabled ? (linkTo ? 'link' : 'create') : 'skip',
      accountId: linkTo ?? undefined,
      accountName: a.name,
      accountType: a.suggestedType,
      fullHistory: false,
    };
  });
}

function ConnectEnableBankingDialog({ isOpen, onClose, reconnect }: Props) {
  const { data: status, isLoading: statusLoading } = useEnableBankingStatus();
  const [step, setStep] = useState<Step>('bank');
  const [country, setCountry] = useState('');
  const [search, setSearch] = useState('');
  const [bankName, setBankName] = useState<string | null>(null);
  const [result, setResult] = useState<EnableBankingConnectionResult | null>(null);
  const [mappings, setMappings] = useState<MappingChoice[]>([]);
  const [syncResult, setSyncResult] = useState<EnableBankingSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const mapAccounts = useMapEnableBankingAccounts();
  const syncConnection = useSyncEnableBankingConnection();
  const canSave = useCanSave();

  async function saveAndSync(connection: EnableBankingConnectionResult, choices: MappingChoice[]) {
    setStep('syncing');
    setSyncError(null);
    try {
      const actions: EnableBankingMappingAction[] = choices.map((m) => ({
        mappingId: m.mappingId,
        action: m.action,
        accountId: m.action === 'link' ? m.accountId : undefined,
        accountName: m.action === 'create' ? m.accountName.trim() || undefined : undefined,
        accountType: m.action === 'create' ? m.accountType : undefined,
      }));
      await mapAccounts.mutateAsync({ connectionId: connection.connectionId, mappings: actions });
      const fullHistory = choices
        .filter((m) => m.action === 'link' && m.fullHistory)
        .map((m) => m.mappingId);
      setSyncResult(
        await syncConnection.mutateAsync({
          connectionId: connection.connectionId,
          fullHistory: fullHistory.length ? fullHistory : undefined,
        }),
      );
    } catch (err) {
      setSyncError((err as Error).message);
    }
    setStep('done');
  }

  const login = useEnableBankingLogin((connection) => {
    setResult(connection);
    const choices = choicesFor(connection);
    setMappings(choices);
    // A reconnect where every account is already set up goes straight to syncing
    const allMapped = connection.accounts.every((a) => a.accountId || !a.isEnabled);
    if (reconnect && allMapped) void saveAndSync(connection, choices);
    else setStep('mapping');
  });

  useFormReset(isOpen ? (reconnect?.connectionId ?? 'new') : null, () => {
    setCountry(defaultCountry());
    setSearch('');
    setBankName(null);
    setResult(null);
    setMappings([]);
    setSyncResult(null);
    setSyncError(null);
    // A reconnect starts from a button too: the bank's tab has to open from a click
    if (reconnect) {
      setStep('reconnect');
    } else {
      setStep('bank');
    }
  });

  function handleClose() {
    login.cancel();
    onClose();
  }

  const configured = status?.configured ?? false;
  const effectiveStep: Step = !reconnect && !configured && !statusLoading ? 'setup' : step;
  const title = reconnect ? `Reconnect ${reconnect.bankName}` : 'Connect a European bank';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="lg">
      {statusLoading && !reconnect ? (
        <div className="flex justify-center py-10">
          <Loader2 size={24} className="animate-spin text-text-tertiary" />
        </div>
      ) : effectiveStep === 'setup' ? (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            FlyBudget connects to European banks through your own free Enable Banking application.
            Set it up once:
          </p>
          <EnableBankingSetupForm onConfigured={() => setStep('bank')} />
        </div>
      ) : effectiveStep === 'bank' ? (
        <BankPicker
          country={country}
          onCountryChange={(c) => {
            setCountry(c);
            setBankName(null);
          }}
          search={search}
          onSearchChange={setSearch}
          selected={bankName}
          onSelect={setBankName}
          starting={login.state.phase === 'starting'}
          error={login.state.phase === 'error' ? login.state.message : null}
          onContinue={() => {
            if (!bankName) return;
            setStep('browser');
            void login.start({ aspspName: bankName, country });
          }}
          onCancel={handleClose}
        />
      ) : effectiveStep === 'reconnect' && reconnect ? (
        <div className="space-y-4 text-center py-4">
          <p className="text-sm text-text-secondary max-w-sm mx-auto leading-relaxed">
            Log in at {reconnect.bankName} again to give FlyBudget access for the next few months.
            Your accounts and their history stay as they are.
          </p>
          <SavingPausedHint />
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              disabled={!canSave}
              onClick={() => {
                setStep('browser');
                void login.start({ connectionId: reconnect.connectionId });
              }}
            >
              Log in at your bank
            </Button>
          </div>
        </div>
      ) : effectiveStep === 'browser' ? (
        login.state.phase === 'error' ? (
          <div className="space-y-4 text-center py-4">
            <AlertTriangle size={28} className="text-negative mx-auto" />
            <p className="text-sm text-negative" role="alert">
              {login.state.message}
            </p>
            <div className="flex justify-center gap-2">
              <Button variant="secondary" onClick={handleClose}>
                Close
              </Button>
              <Button
                onClick={() =>
                  reconnect
                    ? login.start({ connectionId: reconnect.connectionId })
                    : setStep('bank')
                }
              >
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <BankLoginWaiting
            starting={login.state.phase !== 'waiting'}
            onReopen={login.reopen}
            onPaste={login.paste}
            onCancel={() => {
              login.cancel();
              if (reconnect) onClose();
              else setStep('bank');
            }}
          />
        )
      ) : effectiveStep === 'mapping' && result ? (
        <MappingStep
          result={result}
          mappings={mappings}
          onChange={(mappingId, updates) =>
            setMappings((prev) =>
              prev.map((m) => (m.mappingId === mappingId ? { ...m, ...updates } : m)),
            )
          }
          onSave={() => saveAndSync(result, mappings)}
          onCancel={handleClose}
        />
      ) : effectiveStep === 'syncing' ? (
        <div className="text-center py-10">
          <Loader2 size={40} className="animate-spin text-brand-500 mx-auto mb-4" />
          <h3 className="text-sm font-semibold text-text">Bringing in your transactions</h3>
          <p className="text-xs text-text-secondary mt-1">
            The first sync asks your bank for its whole history, which can take a minute.
          </p>
        </div>
      ) : (
        <SyncDone result={syncResult} error={syncError} onClose={handleClose} />
      )}
    </Modal>
  );
}

function BankPicker(props: {
  country: string;
  onCountryChange: (c: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  selected: string | null;
  onSelect: (name: string) => void;
  starting: boolean;
  error: string | null;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const banks = useEnableBankingBanks(props.country || null);
  const canSave = useCanSave();
  const countries = useMemo(
    () =>
      COUNTRIES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [],
  );
  const query = props.search.trim().toLowerCase();
  const list = (banks.data ?? []).filter((b) => !query || b.name.toLowerCase().includes(query));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
        <div>
          <label htmlFor="eb-country" className="block text-xs font-medium text-text-tertiary mb-1">
            Country
          </label>
          <select
            id="eb-country"
            value={props.country}
            onChange={(e) => props.onCountryChange(e.target.value)}
            className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600"
          >
            <option value="">Choose…</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="eb-search" className="block text-xs font-medium text-text-tertiary mb-1">
            Bank
          </label>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
              aria-hidden
            />
            <input
              id="eb-search"
              type="search"
              value={props.search}
              onChange={(e) => props.onSearchChange(e.target.value)}
              placeholder="Search banks"
              disabled={!props.country}
              className="w-full text-sm border border-border rounded-md pl-8 pr-3 py-2 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      <div
        role="listbox"
        aria-label="Banks"
        className="max-h-64 overflow-y-auto rounded-lg border border-border-light divide-y divide-border-light"
      >
        {!props.country ? (
          <p className="px-4 py-6 text-xs text-text-tertiary text-center">
            Choose your bank&apos;s country.
          </p>
        ) : banks.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 size={18} className="animate-spin text-text-tertiary" />
          </div>
        ) : banks.isError ? (
          <p className="px-4 py-6 text-xs text-negative text-center" role="alert">
            {(banks.error as Error).message}
          </p>
        ) : (banks.data ?? []).length === 0 ? (
          <div className="px-4 py-6 text-xs text-text-secondary text-center space-y-1">
            <p className="font-medium text-text">No banks to choose from</p>
            <p>
              Free Enable Banking applications only list the banks of accounts you linked. Open your
              application in the Enable Banking Control Panel and link your accounts first.
            </p>
          </div>
        ) : list.length === 0 ? (
          <p className="px-4 py-6 text-xs text-text-tertiary text-center">
            No bank matches “{props.search}”.
          </p>
        ) : (
          list.map((bank) => (
            <button
              key={bank.name}
              type="button"
              role="option"
              aria-selected={props.selected === bank.name}
              onClick={() => props.onSelect(bank.name)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 max-md:min-h-11 text-left text-sm transition-colors ${
                props.selected === bank.name
                  ? 'bg-brand-50 text-text'
                  : 'text-text-secondary hover:bg-surface-alt'
              }`}
            >
              <Landmark size={16} className="shrink-0 text-text-tertiary" aria-hidden />
              <span className="flex-1 min-w-0 truncate">{bank.name}</span>
              {bank.beta && (
                <span className="text-[10px] font-medium text-caution bg-caution-subtle px-1.5 py-0.5 rounded">
                  beta
                </span>
              )}
            </button>
          ))
        )}
      </div>

      {props.error && (
        <p className="text-xs text-negative" role="alert">
          {props.error}
        </p>
      )}
      <SavingPausedHint className="text-right" />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button onClick={props.onContinue} disabled={!props.selected || props.starting || !canSave}>
          {props.starting ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Opening your bank…
            </>
          ) : (
            'Log in at your bank'
          )}
        </Button>
      </div>
    </div>
  );
}

/** While the user logs in at their bank in their browser. */
function BankLoginWaiting({
  starting,
  onReopen,
  onPaste,
  onCancel,
}: {
  starting: boolean;
  onReopen: () => void;
  onPaste: (url: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [showPaste, setShowPaste] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);

  async function submitPaste(e: React.FormEvent) {
    e.preventDefault();
    setPasteError(null);
    setPasting(true);
    try {
      await onPaste(pasted);
    } catch (err) {
      setPasteError((err as Error).message);
    }
    setPasting(false);
  }

  return (
    <div className="space-y-5 py-2">
      <div className="text-center space-y-3">
        <Loader2 size={28} className="animate-spin text-brand-600 mx-auto" />
        <div>
          <h3 className="text-sm font-semibold text-text">
            {starting ? 'Opening your bank…' : 'Log in at your bank in your browser'}
          </h3>
          <p className="text-xs text-text-secondary mt-1 max-w-sm mx-auto leading-relaxed">
            Your bank&apos;s page opened in your web browser. When you&apos;re done there, it sends
            you back and FlyBudget carries on by itself.
          </p>
        </div>
        <p className="inline-flex items-center gap-1.5 text-[11px] text-text-tertiary">
          <ShieldCheck size={12} /> You log in on your bank&apos;s own site, never in FlyBudget.
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" onClick={onReopen} disabled={starting}>
            <ExternalLink size={14} /> Open the bank again
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      <div className="border-t border-border-light pt-4">
        {showPaste ? (
          <form onSubmit={submitPaste} className="space-y-2">
            <label htmlFor="eb-paste" className="block text-xs text-text-secondary">
              After logging in, copy the whole address from your browser&apos;s address bar and
              paste it here:
            </label>
            <div className="flex gap-2">
              <input
                id="eb-paste"
                type="text"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="https://…?code=…&state=…"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 min-w-0 text-sm border border-border rounded-md px-3 py-2 bg-surface text-text font-mono focus:outline-none focus:ring-1 focus:ring-brand-600"
              />
              <Button type="submit" disabled={!pasted.trim() || pasting}>
                {pasting ? <Loader2 size={14} className="animate-spin" /> : 'Continue'}
              </Button>
            </div>
            {pasteError && (
              <p className="text-xs text-negative" role="alert">
                {pasteError}
              </p>
            )}
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowPaste(true)}
            className="text-xs text-brand-600 hover:text-brand-700 font-medium max-md:min-h-11"
          >
            Logged in, but FlyBudget didn&apos;t continue?
          </button>
        )}
      </div>
    </div>
  );
}

function MappingStep({
  result,
  mappings,
  onChange,
  onSave,
  onCancel,
}: {
  result: EnableBankingConnectionResult;
  mappings: MappingChoice[];
  onChange: (mappingId: string, updates: Partial<MappingChoice>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { data: existingAccounts = [] } = useAccounts();
  const canSave = useCanSave();
  const linked = new Set(mappings.filter((m) => m.action === 'link').map((m) => m.accountId));
  const incomplete = mappings.some((m) => m.action === 'link' && !m.accountId);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-text">{result.bankName}</h3>
        <p className="text-xs text-text-secondary mt-0.5">
          Choose where each account&apos;s transactions go. Accounts you already import statements
          into are picked for you.
        </p>
      </div>
      {result.accounts.length === 0 ? (
        <p className="text-xs text-text-secondary bg-surface-alt rounded-lg px-4 py-3">
          Your bank didn&apos;t share any accounts. If you use a free Enable Banking application,
          link the accounts in its Control Panel, then connect again.
        </p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {result.accounts.map((account) => (
            <MappingCard
              key={account.mappingId}
              account={account}
              mapping={mappings.find((m) => m.mappingId === account.mappingId)!}
              existingAccounts={existingAccounts}
              linked={linked}
              onChange={(updates) => onChange(account.mappingId, updates)}
            />
          ))}
        </div>
      )}
      <SavingPausedHint className="text-right" />
      <div className="flex justify-end gap-3 pt-1">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={onSave}
          disabled={!canSave || incomplete || mappings.every((m) => m.action === 'skip')}
        >
          Save and sync
        </Button>
      </div>
    </div>
  );
}

function MappingCard({
  account,
  mapping,
  existingAccounts,
  linked,
  onChange,
}: {
  account: EnableBankingDiscoveredAccount;
  mapping: MappingChoice;
  existingAccounts: Account[];
  linked: Set<string | undefined>;
  onChange: (updates: Partial<MappingChoice>) => void;
}) {
  const available = existingAccounts.filter(
    (a) => !a.closedAt && (!linked.has(a.id) || mapping.accountId === a.id),
  );
  const toggle = (active: boolean) =>
    `px-3 py-1 max-md:min-h-11 text-xs font-medium rounded-md transition-colors ${
      active
        ? 'bg-brand-600 text-white'
        : 'bg-surface text-text-secondary border border-border hover:bg-surface-alt disabled:opacity-40 disabled:cursor-not-allowed'
    }`;
  const fieldClass =
    'w-full text-sm border border-border rounded-md px-3 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600';

  return (
    <div className="bg-brand-50 border border-brand-100 rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-medium text-text">{account.name}</span>
        <span className="text-xs text-text-tertiary">
          {[account.iban && maskIban(account.iban), account.currency].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Where ${account.name} goes`}>
        <button
          type="button"
          aria-pressed={mapping.action === 'create'}
          onClick={() => onChange({ action: 'create' })}
          className={toggle(mapping.action === 'create')}
        >
          New account
        </button>
        <button
          type="button"
          aria-pressed={mapping.action === 'link'}
          onClick={() => onChange({ action: 'link' })}
          disabled={available.length === 0}
          className={toggle(mapping.action === 'link')}
        >
          Existing account
        </button>
        <button
          type="button"
          aria-pressed={mapping.action === 'skip'}
          onClick={() => onChange({ action: 'skip' })}
          className={toggle(mapping.action === 'skip')}
        >
          Don&apos;t sync
        </button>
      </div>

      {mapping.action === 'create' && (
        <div className="grid gap-2 sm:grid-cols-[1fr_11rem]">
          <input
            type="text"
            value={mapping.accountName}
            onChange={(e) => onChange({ accountName: e.target.value })}
            aria-label={`Name for ${account.name}`}
            placeholder="Account name"
            className={fieldClass}
          />
          <select
            value={mapping.accountType}
            onChange={(e) => onChange({ accountType: e.target.value as AccountType })}
            aria-label={`Type of ${account.name}`}
            className={fieldClass}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {mapping.action === 'link' && (
        <>
          <select
            value={mapping.accountId ?? ''}
            onChange={(e) => onChange({ accountId: e.target.value || undefined })}
            aria-label={`Account for ${account.name}`}
            className={fieldClass}
          >
            <option value="">Choose an account…</option>
            {available.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {account.suggestedAccountId && mapping.accountId === account.suggestedAccountId && (
            <p className="text-[11px] text-text-tertiary">
              Your last bank statement for this account went here.
            </p>
          )}
          {!account.accountId && (
            <label className="flex items-start gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={mapping.fullHistory}
                onChange={(e) => onChange({ fullHistory: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                Also bring in older transactions the bank has. Without this, syncing starts a week
                before this account&apos;s latest transaction. Transactions you already imported
                from files are recognised either way.
              </span>
            </label>
          )}
        </>
      )}
    </div>
  );
}

function SyncDone({
  result,
  error,
  onClose,
}: {
  result: EnableBankingSyncResult | null;
  error: string | null;
  onClose: () => void;
}) {
  const skipped = result
    ? result.skipped.noDate + result.skipped.badAmount + result.skipped.otherCurrency
    : 0;
  const failed = !!error || (result?.errors.length ?? 0) > 0;
  return (
    <div className="text-center py-8 space-y-3">
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${
          failed ? 'bg-caution-subtle' : 'bg-positive-subtle'
        }`}
      >
        {failed ? (
          <AlertTriangle size={30} className="text-caution" />
        ) : (
          <CheckCircle2 size={32} className="text-positive" />
        )}
      </div>
      <h3 className="text-sm font-semibold text-text">
        {failed ? 'Connected, with problems' : 'Bank connected'}
      </h3>
      {result && (
        <div className="text-xs text-text-secondary space-y-1">
          <p>
            Brought in {result.added} transaction{result.added === 1 ? '' : 's'}.
            {result.adopted > 0 &&
              ` ${result.adopted} you already had (from files or typed in) are now kept up to date by the bank.`}
          </p>
          {skipped > 0 && (
            <p>
              Left out {skipped} the bank sent without a date or a readable amount
              {result.skipped.otherCurrency > 0 ? ', or in another currency' : ''}.
            </p>
          )}
        </div>
      )}
      {failed && (
        <ul className="text-xs text-negative space-y-0.5" role="alert">
          {error && <li>{error}</li>}
          {result?.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-text-tertiary max-w-sm mx-auto">
        FlyBudget syncs when it starts and when you click Sync now. Banks allow only a few automatic
        updates a day.{' '}
        <a
          href={ENABLE_BANKING_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-600"
        >
          How syncing works
        </a>
      </p>
      <Button onClick={onClose} className="mt-2">
        Done
      </Button>
    </div>
  );
}
