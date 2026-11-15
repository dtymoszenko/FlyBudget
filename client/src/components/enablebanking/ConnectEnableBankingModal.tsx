import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { accountTypeLabel } from '../../utils/accountTypes';
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

/** In the app's language, or English where the browser doesn't have it */
function countryName(code: string, language: string): string {
  try {
    return new Intl.DisplayNames([language, 'en'], { type: 'region' }).of(code) ?? code;
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
  const { t } = useTranslation();
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
  const title = reconnect
    ? t('banks.enableBanking.connect.reconnectTitle', { bank: reconnect.bankName })
    : t('banks.enableBanking.connect.title');

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="lg">
      {statusLoading && !reconnect ? (
        <div className="flex justify-center py-10">
          <Loader2 size={24} className="animate-spin text-text-tertiary" />
        </div>
      ) : effectiveStep === 'setup' ? (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            {t('banks.enableBanking.connect.setupIntro')}
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
            {t('banks.enableBanking.connect.reconnectIntro', { bank: reconnect.bankName })}
          </p>
          <SavingPausedHint />
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={handleClose}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              disabled={!canSave}
              onClick={() => {
                setStep('browser');
                void login.start({ connectionId: reconnect.connectionId });
              }}
            >
              {t('banks.enableBanking.connect.logIn')}
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
                {t('common.actions.close')}
              </Button>
              <Button
                onClick={() =>
                  reconnect
                    ? login.start({ connectionId: reconnect.connectionId })
                    : setStep('bank')
                }
              >
                {t('banks.enableBanking.connect.tryAgain')}
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
          <h3 className="text-sm font-semibold text-text">
            {t('banks.enableBanking.connect.syncing')}
          </h3>
          <p className="text-xs text-text-secondary mt-1">
            {t('banks.enableBanking.connect.syncingHint')}
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
  const { t, i18n } = useTranslation();
  const banks = useEnableBankingBanks(props.country || null);
  const canSave = useCanSave();
  const countries = useMemo(
    () =>
      COUNTRIES.map((code) => ({ code, name: countryName(code, i18n.language) })).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [i18n.language],
  );
  const query = props.search.trim().toLowerCase();
  const list = (banks.data ?? []).filter((b) => !query || b.name.toLowerCase().includes(query));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
        <div>
          <label htmlFor="eb-country" className="block text-xs font-medium text-text-tertiary mb-1">
            {t('banks.enableBanking.bankPicker.country')}
          </label>
          <select
            id="eb-country"
            value={props.country}
            onChange={(e) => props.onCountryChange(e.target.value)}
            className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600"
          >
            <option value="">{t('banks.enableBanking.bankPicker.chooseCountry')}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="eb-search" className="block text-xs font-medium text-text-tertiary mb-1">
            {t('banks.enableBanking.bankPicker.bank')}
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
              placeholder={t('banks.enableBanking.bankPicker.search')}
              disabled={!props.country}
              className="w-full text-sm border border-border rounded-md pl-8 pr-3 py-2 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      <div
        role="listbox"
        aria-label={t('banks.enableBanking.bankPicker.banks')}
        className="max-h-64 overflow-y-auto rounded-lg border border-border-light divide-y divide-border-light"
      >
        {!props.country ? (
          <p className="px-4 py-6 text-xs text-text-tertiary text-center">
            {t('banks.enableBanking.bankPicker.countryFirst')}
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
            <p className="font-medium text-text">{t('banks.enableBanking.bankPicker.noBanks')}</p>
            <p>{t('banks.enableBanking.bankPicker.noBanksHint')}</p>
          </div>
        ) : list.length === 0 ? (
          <p className="px-4 py-6 text-xs text-text-tertiary text-center">
            {t('banks.enableBanking.bankPicker.noMatch', { search: props.search })}
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
                  {t('banks.enableBanking.bankPicker.beta')}
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
          {t('common.actions.cancel')}
        </Button>
        <Button onClick={props.onContinue} disabled={!props.selected || props.starting || !canSave}>
          {props.starting ? (
            <>
              <Loader2 size={14} className="animate-spin" />{' '}
              {t('banks.enableBanking.connect.opening')}
            </>
          ) : (
            t('banks.enableBanking.connect.logIn')
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
  const { t } = useTranslation();
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
            {starting
              ? t('banks.enableBanking.connect.opening')
              : t('banks.enableBanking.waiting.title')}
          </h3>
          <p className="text-xs text-text-secondary mt-1 max-w-sm mx-auto leading-relaxed">
            {t('banks.enableBanking.waiting.hint')}
          </p>
        </div>
        <p className="inline-flex items-center gap-1.5 text-[11px] text-text-tertiary">
          <ShieldCheck size={12} /> {t('banks.enableBanking.waiting.ownSite')}
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" onClick={onReopen} disabled={starting}>
            <ExternalLink size={14} /> {t('banks.enableBanking.waiting.reopen')}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            {t('common.actions.cancel')}
          </Button>
        </div>
      </div>

      <div className="border-t border-border-light pt-4">
        {showPaste ? (
          <form onSubmit={submitPaste} className="space-y-2">
            <label htmlFor="eb-paste" className="block text-xs text-text-secondary">
              {t('banks.enableBanking.waiting.pasteLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id="eb-paste"
                type="text"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                // i18n-ignore
                placeholder="https://…?code=…&state=…"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 min-w-0 text-sm border border-border rounded-md px-3 py-2 bg-surface text-text font-mono focus:outline-none focus:ring-1 focus:ring-brand-600"
              />
              <Button type="submit" disabled={!pasted.trim() || pasting}>
                {pasting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  t('banks.enableBanking.waiting.continue')
                )}
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
            {t('banks.enableBanking.waiting.notContinued')}
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
  const { t } = useTranslation();
  const { data: existingAccounts = [] } = useAccounts();
  const canSave = useCanSave();
  const linked = new Set(mappings.filter((m) => m.action === 'link').map((m) => m.accountId));
  // A link still to choose, or to an account in another currency than the bank account's
  // (its amounts would be read in the wrong currency)
  const incomplete = mappings.some((m) => {
    if (m.action !== 'link') return false;
    if (!m.accountId) return true;
    const bank = result.accounts.find((a) => a.mappingId === m.mappingId)?.currency;
    const target = existingAccounts.find((a) => a.id === m.accountId)?.currency;
    return !!bank && !!target && target !== bank.toUpperCase();
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-text">{result.bankName}</h3>
        <p className="text-xs text-text-secondary mt-0.5">
          {t('banks.enableBanking.mapping.hint')}
        </p>
      </div>
      {result.accounts.length === 0 ? (
        <p className="text-xs text-text-secondary bg-surface-alt rounded-lg px-4 py-3">
          {t('banks.enableBanking.mapping.noAccounts')}
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
          {t('common.actions.cancel')}
        </Button>
        <Button
          onClick={onSave}
          disabled={!canSave || incomplete || mappings.every((m) => m.action === 'skip')}
        >
          {t('banks.enableBanking.mapping.save')}
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
  const { t } = useTranslation();
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
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t('banks.enableBanking.mapping.target', { name: account.name })}
      >
        <button
          type="button"
          aria-pressed={mapping.action === 'create'}
          onClick={() => onChange({ action: 'create' })}
          className={toggle(mapping.action === 'create')}
        >
          {t('banks.enableBanking.mapping.create')}
        </button>
        <button
          type="button"
          aria-pressed={mapping.action === 'link'}
          onClick={() => onChange({ action: 'link' })}
          disabled={available.length === 0}
          className={toggle(mapping.action === 'link')}
        >
          {t('banks.enableBanking.mapping.link')}
        </button>
        <button
          type="button"
          aria-pressed={mapping.action === 'skip'}
          onClick={() => onChange({ action: 'skip' })}
          className={toggle(mapping.action === 'skip')}
        >
          {t('banks.enableBanking.mapping.skip')}
        </button>
      </div>

      {mapping.action === 'create' && (
        <div className="grid gap-2 sm:grid-cols-[1fr_11rem]">
          <input
            type="text"
            value={mapping.accountName}
            onChange={(e) => onChange({ accountName: e.target.value })}
            aria-label={t('banks.enableBanking.mapping.nameFor', { name: account.name })}
            placeholder={t('banks.enableBanking.mapping.accountName')}
            className={fieldClass}
          />
          <select
            value={mapping.accountType}
            onChange={(e) => onChange({ accountType: e.target.value as AccountType })}
            aria-label={t('banks.enableBanking.mapping.typeOf', { name: account.name })}
            className={fieldClass}
          >
            {ACCOUNT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {accountTypeLabel(type.value)}
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
            aria-label={t('banks.enableBanking.mapping.accountFor', { name: account.name })}
            className={fieldClass}
          >
            <option value="">{t('banks.enableBanking.mapping.chooseAccount')}</option>
            {available.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {account.suggestedAccountId && mapping.accountId === account.suggestedAccountId && (
            <p className="text-[11px] text-text-tertiary">
              {t('banks.enableBanking.mapping.suggested')}
            </p>
          )}
          {(() => {
            // The bank's amounts are in its account's currency: another one would misread them
            const target = existingAccounts.find((a) => a.id === mapping.accountId);
            const theirs = account.currency?.toUpperCase();
            return target?.currency && theirs && target.currency !== theirs ? (
              <p role="alert" className="text-[11px] text-caution">
                {t('banks.enableBanking.mapping.otherCurrency', {
                  bankCurrency: theirs,
                  account: target.name,
                  accountCurrency: target.currency,
                })}
              </p>
            ) : null;
          })()}
          {!account.accountId && (
            <label className="flex items-start gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={mapping.fullHistory}
                onChange={(e) => onChange({ fullHistory: e.target.checked })}
                className="mt-0.5"
              />
              <span>{t('banks.enableBanking.mapping.fullHistory')}</span>
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
  const { t } = useTranslation();
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
        {failed ? t('banks.enableBanking.done.problems') : t('banks.enableBanking.done.title')}
      </h3>
      {result && (
        <div className="text-xs text-text-secondary space-y-1">
          <p>
            {t('banks.enableBanking.done.added', { count: result.added })}
            {result.adopted > 0 &&
              ` ${t('banks.enableBanking.done.adopted', { count: result.adopted })}`}
          </p>
          {skipped > 0 && (
            <p>
              {result.skipped.otherCurrency > 0
                ? t('banks.enableBanking.done.skippedOrCurrency', { count: skipped })
                : t('banks.enableBanking.done.skipped', { count: skipped })}
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
        {t('banks.enableBanking.done.howItSyncs')}{' '}
        <a
          href={ENABLE_BANKING_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-600"
        >
          {t('banks.enableBanking.done.howSyncingWorks')}
        </a>
      </p>
      <Button onClick={onClose} className="mt-2">
        {t('common.actions.done')}
      </Button>
    </div>
  );
}
