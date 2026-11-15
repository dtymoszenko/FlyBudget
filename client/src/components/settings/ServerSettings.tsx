import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Trans, useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  HardDrive,
  KeyRound,
  Loader2,
  LogOut,
  Smartphone,
  WifiOff,
} from 'lucide-react';
import * as authApi from '../../api/auth';
import type { SecurityCheck, SignedInDevice } from '../../api/server';
import { useCanSave } from '../../hooks/useConnection';
import {
  useAppMode,
  useServerInfo,
  useSessions,
  useSignOut,
  useSignOutOtherSessions,
  useSignOutSession,
} from '../../hooks/useServer';
import { useOutbox } from '../../offline/outbox';
import { clearOfflineCopy, offlineCopySupported } from '../../offline/snapshot';
import { usePreferencesStore } from '../../store/preferencesStore';
import { describeUserAgent } from '../../utils/connection';
import { SELF_HOSTING_URL } from '../../utils/project';
import { Button } from '../ui/Button';
import { MIN_PASSWORD_LENGTH } from '../auth/passwordRules';
import { IS_DEMO } from '../../demo/demoApi';
import { t } from '../../i18n';

const inputClass =
  'w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600';

/**
 * Settings → Server. Desktop app (and dev): where the data lives, and how to use
 * FlyBudget on other devices. Self-hosted server: a security check of the setup,
 * signed-in devices, change password and sign out.
 */
export function ServerSettings({ onOpenTab }: { onOpenTab: (tab: 'data') => void }) {
  const mode = useAppMode();
  return mode === 'server' ? <SelfHostedSettings /> : <LocalSettings onOpenTab={onOpenTab} />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-text">{children}</h2>;
}

// --- Desktop app / dev ---

function LocalSettings({ onOpenTab }: { onOpenTab: (tab: 'data') => void }) {
  const { t } = useTranslation();
  const { data: info } = useServerInfo();
  return (
    <div className="max-w-xl space-y-8">
      <section>
        <SectionTitle>{t('settings.server.local.title')}</SectionTitle>
        <div className="mt-3 flex items-start gap-3 p-4 rounded-lg border border-border-light bg-surface-alt">
          <HardDrive size={20} className="text-brand-600 shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm">
            {IS_DEMO ? (
              <>
                <p className="font-medium text-text">{t('settings.server.local.demo')}</p>
                <p className="text-text-secondary mt-1 leading-relaxed">
                  {t('settings.server.local.demoHint')}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-text">{t('settings.server.local.computer')}</p>
                <p className="text-text-secondary mt-1 leading-relaxed">
                  {t('settings.server.local.computerHint')}
                </p>
              </>
            )}
            {info && (
              <p className="text-xs text-text-tertiary mt-2">
                {t('settings.server.version', { version: info.version })}
              </p>
            )}
          </div>
        </div>
      </section>

      {!IS_DEMO && <OfflineCopySettings />}

      <section className="p-4 rounded-lg border border-border">
        <div className="flex items-start gap-3">
          <Smartphone size={20} className="text-brand-600 shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm">
            <h2 className="font-semibold text-text">{t('settings.server.selfHost.title')}</h2>
            <p className="text-text-secondary mt-1 leading-relaxed">
              {t('settings.server.selfHost.hint')}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <a
                href={SELF_HOSTING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors"
              >
                {t('settings.server.selfHost.guide')} <ExternalLink size={12} aria-hidden />
              </a>
              <Button variant="secondary" size="sm" onClick={() => onOpenTab('data')}>
                <Download size={13} /> {t('settings.server.selfHost.backup')}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// --- Offline copy (dev and self-hosted; the desktop app's server is always there) ---

function OfflineCopySettings() {
  const { t } = useTranslation();
  const keep = usePreferencesStore((s) => s.keepOfflineCopy);
  const setKeep = usePreferencesStore((s) => s.setKeepOfflineCopy);
  const waiting = useOutbox((s) => s.items.length);
  if (!offlineCopySupported()) return null;
  return (
    <section className="pt-6 border-t border-border-light">
      <SectionTitle>{t('settings.server.offline.title')}</SectionTitle>
      <label className="mt-3 flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={keep}
          onChange={(e) => {
            setKeep(e.target.checked);
            if (!e.target.checked) void clearOfflineCopy();
          }}
          className="mt-0.5 h-4 w-4 max-md:h-5 max-md:w-5 accent-brand-600 shrink-0"
        />
        <span className="text-sm">
          <span className="font-medium text-text flex items-center gap-1.5">
            <WifiOff size={14} className="text-text-tertiary" aria-hidden />
            {t('settings.server.offline.keep')}
          </span>
          <span className="block text-xs text-text-tertiary mt-1 leading-relaxed">
            {t('settings.server.offline.hint')}
          </span>
        </span>
      </label>
      {waiting > 0 && (
        <p className="text-xs text-caution mt-3">
          {t('settings.server.offline.waiting', { count: waiting })}
        </p>
      )}
    </section>
  );
}

// --- Self-hosted server ---

interface CheckText {
  label: string;
  /** How to fix a warning: names the setting, never a secret value */
  fix?: React.ReactNode;
}

const Env = ({ children }: { children?: React.ReactNode }) => (
  <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-surface-alt text-text">
    {children}
  </code>
);

/** How to fix a warning, with the settings it names set in code */
const fix = (
  i18nKey:
    | 'settings.server.checks.httpsMissingFix'
    | 'settings.server.checks.trustProxyUntrustedFix'
    | 'settings.server.checks.trustProxyUnneededFix'
    | 'settings.server.checks.allowedHostsMissingFix'
    | 'settings.server.checks.encryptionKeyMissingFix',
) => <Trans i18nKey={i18nKey} components={{ env: <Env /> }} />;

function describeCheck(check: SecurityCheck): CheckText {
  switch (check.id) {
    case 'https':
      if (check.reason === 'secure') return { label: t('settings.server.checks.httpsSecure') };
      if (check.ok) return { label: t('settings.server.checks.httpsLocal') };
      return {
        label: t('settings.server.checks.httpsMissing'),
        fix: fix('settings.server.checks.httpsMissingFix'),
      };
    case 'trustProxy':
      if (check.ok) return { label: t('settings.server.checks.trustProxyOk') };
      if (check.reason === 'untrusted-proxy')
        return {
          label: t('settings.server.checks.trustProxyUntrusted'),
          fix: fix('settings.server.checks.trustProxyUntrustedFix'),
        };
      return {
        label: t('settings.server.checks.trustProxyUnneeded'),
        fix: fix('settings.server.checks.trustProxyUnneededFix'),
      };
    case 'allowedHosts':
      return check.ok
        ? { label: t('settings.server.checks.allowedHostsOk') }
        : {
            label: t('settings.server.checks.allowedHostsMissing'),
            fix: fix('settings.server.checks.allowedHostsMissingFix'),
          };
    case 'encryptionKey':
      return check.ok
        ? { label: t('settings.server.checks.encryptionKeyOk') }
        : {
            label: t('settings.server.checks.encryptionKeyMissing'),
            fix: fix('settings.server.checks.encryptionKeyMissingFix'),
          };
    case 'password':
      return check.ok
        ? { label: t('settings.server.checks.passwordOk') }
        : { label: t('settings.server.checks.passwordMissing') };
  }
}

function SecurityChecks() {
  const { t } = useTranslation();
  const { data: info, isLoading } = useServerInfo();
  const checks = info?.checks ?? [];
  const warnings = checks.filter((c) => !c.ok).length;
  return (
    <section>
      <SectionTitle>{t('settings.server.security.title')}</SectionTitle>
      <p className="text-xs text-text-tertiary mt-1">
        {isLoading
          ? t('settings.server.security.checking')
          : warnings === 0
            ? t('settings.server.security.allGood')
            : t('settings.server.security.warnings', { count: warnings })}
        {info && <> {t('settings.server.security.version', { version: info.version })}</>}
      </p>
      <ul aria-label={t('settings.server.security.title')} className="mt-3 space-y-2">
        {checks.map((check) => {
          const text = describeCheck(check);
          return (
            <li
              key={check.id}
              className="flex items-start gap-2.5 p-3 rounded-md border border-border-light text-sm"
            >
              {check.ok ? (
                <CheckCircle2
                  size={16}
                  className="text-positive shrink-0 mt-0.5"
                  aria-label={t('settings.server.security.passed')}
                />
              ) : (
                <AlertTriangle
                  size={16}
                  className="text-caution shrink-0 mt-0.5"
                  aria-label={t('settings.server.security.warning')}
                />
              )}
              <div>
                <p className="text-text">{text.label}</p>
                {!check.ok && text.fix && (
                  <p className="text-xs text-text-secondary mt-1 leading-relaxed">{text.fix}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function deviceTimes(d: SignedInDevice) {
  const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true });
  return d.lastUsedAt
    ? t('settings.server.devices.active', { active: ago(d.lastUsedAt), signedIn: ago(d.createdAt) })
    : t('settings.server.devices.signedIn', { signedIn: ago(d.createdAt) });
}

function SignedInDevices() {
  const { t } = useTranslation();
  const { data: devices = [], isLoading, isError } = useSessions(true);
  const signOutOne = useSignOutSession();
  const signOutOthers = useSignOutOtherSessions();
  const canSave = useCanSave();
  const others = devices.filter((d) => !d.current).length;

  return (
    <section className="pt-6 border-t border-border-light">
      <SectionTitle>{t('settings.server.devices.title')}</SectionTitle>
      <p className="text-xs text-text-tertiary mt-1">{t('settings.server.devices.hint')}</p>
      {isLoading && <Loader2 size={16} className="animate-spin text-text-tertiary mt-3" />}
      {isError && (
        <p className="text-xs text-negative mt-3">{t('settings.server.devices.loadFailed')}</p>
      )}
      <ul
        aria-label={t('settings.server.devices.title')}
        className="mt-3 divide-y divide-border-light"
      >
        {devices.map((d) => {
          const name = describeUserAgent(d.userAgent);
          return (
            <li key={d.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text flex items-center gap-2">
                  {name}
                  {d.current && (
                    <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">
                      {t('settings.server.devices.thisDevice')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-text-tertiary truncate">{deviceTimes(d)}</p>
              </div>
              {!d.current && (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t('settings.server.devices.signOutDevice', { name })}
                  disabled={!canSave || signOutOne.isPending}
                  onClick={() => signOutOne.mutate(d.id)}
                >
                  {t('settings.server.devices.signOut')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <Button
        variant="secondary"
        className="mt-3"
        disabled={others === 0 || !canSave || signOutOthers.isPending}
        onClick={() => signOutOthers.mutate()}
      >
        <LogOut size={14} /> {t('settings.server.devices.signOutOthers')}
      </Button>
    </section>
  );
}

function SelfHostedSettings() {
  const { t } = useTranslation();
  const signOut = useSignOut();
  const canSave = useCanSave();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (next.length < MIN_PASSWORD_LENGTH) {
      return setMessage({
        ok: false,
        text: t('settings.server.password.tooShort', { count: MIN_PASSWORD_LENGTH }),
      });
    }
    if (next !== confirm) {
      return setMessage({ ok: false, text: t('settings.server.password.mismatch') });
    }
    setBusy(true);
    try {
      await authApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ ok: true, text: t('settings.server.password.changed') });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-8">
      <SecurityChecks />
      <SignedInDevices />
      <OfflineCopySettings />

      <section className="pt-6 border-t border-border-light max-w-md">
        <SectionTitle>{t('settings.server.password.title')}</SectionTitle>
        <p className="text-xs text-text-tertiary mt-1">{t('settings.server.password.hint')}</p>
        <form onSubmit={changePassword} className="space-y-3 mt-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {t('settings.server.password.current')}
            </label>
            <input
              type="password"
              autoComplete="current-password"
              aria-label={t('settings.server.password.current')}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {t('settings.server.password.new')}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              aria-label={t('settings.server.password.new')}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {t('settings.server.password.confirm')}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              aria-label={t('settings.server.password.confirm')}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </div>
          {message && (
            <p className={`text-xs ${message.ok ? 'text-positive' : 'text-negative'}`}>
              {message.text}
            </p>
          )}
          <Button type="submit" disabled={busy || !current || !next || !canSave}>
            <KeyRound size={14} /> {t('settings.server.password.submit')}
          </Button>
        </form>
      </section>

      <section className="pt-6 border-t border-border-light">
        <SectionTitle>{t('settings.server.signOut.title')}</SectionTitle>
        <p className="text-xs text-text-tertiary mt-1">{t('settings.server.signOut.hint')}</p>
        <Button variant="secondary" className="mt-4" onClick={signOut}>
          <LogOut size={14} /> {t('settings.server.signOut.button')}
        </Button>
      </section>
    </div>
  );
}
