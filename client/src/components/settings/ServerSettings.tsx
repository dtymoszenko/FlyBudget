import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
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
  const { data: info } = useServerInfo();
  return (
    <div className="max-w-xl space-y-8">
      <section>
        <SectionTitle>Where your data lives</SectionTitle>
        <div className="mt-3 flex items-start gap-3 p-4 rounded-lg border border-border-light bg-surface-alt">
          <HardDrive size={20} className="text-brand-600 shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm">
            {IS_DEMO ? (
              <>
                <p className="font-medium text-text">In this browser (demo)</p>
                <p className="text-text-secondary mt-1 leading-relaxed">
                  This demo runs entirely in your browser: nothing you change is sent anywhere or
                  saved. In the app, your budget is a file on your computer or on a server you run.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-text">On this computer</p>
                <p className="text-text-secondary mt-1 leading-relaxed">
                  Your budget is a file on this computer, and FlyBudget only talks to it through its
                  own local server. Nothing is sent to FlyBudget or anyone else; bank sync contacts
                  Plaid or SimpleFIN only when you connect a bank.
                </p>
              </>
            )}
            {info && <p className="text-xs text-text-tertiary mt-2">Version {info.version}</p>}
          </div>
        </div>
      </section>

      {!IS_DEMO && <OfflineCopySettings />}

      <section className="p-4 rounded-lg border border-border">
        <div className="flex items-start gap-3">
          <Smartphone size={20} className="text-brand-600 shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm">
            <h2 className="font-semibold text-text">
              Use FlyBudget on your phone and other devices
            </h2>
            <p className="text-text-secondary mt-1 leading-relaxed">
              Run FlyBudget on a server you control, such as a home server or a small cloud machine,
              and sign in from any browser. Your data moves to that server; nobody else hosts it.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <a
                href={SELF_HOSTING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors"
              >
                Read the self-hosting guide <ExternalLink size={12} aria-hidden />
              </a>
              <Button variant="secondary" size="sm" onClick={() => onOpenTab('data')}>
                <Download size={13} /> Make a backup first
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
  const keep = usePreferencesStore((s) => s.keepOfflineCopy);
  const setKeep = usePreferencesStore((s) => s.setKeepOfflineCopy);
  const waiting = useOutbox((s) => s.items.length);
  if (!offlineCopySupported()) return null;
  return (
    <section className="pt-6 border-t border-border-light">
      <SectionTitle>Offline copy</SectionTitle>
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
            Keep a copy of my budget on this device
          </span>
          <span className="block text-xs text-text-tertiary mt-1 leading-relaxed">
            When FlyBudget can't reach its server, it opens with what this browser last loaded. You
            can look through everything and add new transactions; they're sent when it reconnects.
            The copy is deleted when you sign out. Turn this off on a shared computer.
          </span>
        </span>
      </label>
      {waiting > 0 && (
        <p className="text-xs text-caution mt-3">
          {waiting} transaction{waiting === 1 ? '' : 's'} saved on this device{' '}
          {waiting === 1 ? 'is' : 'are'} waiting to be sent.
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

const Env = ({ children }: { children: string }) => (
  <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-surface-alt text-text">
    {children}
  </code>
);

function describeCheck(check: SecurityCheck): CheckText {
  switch (check.id) {
    case 'https':
      if (check.reason === 'secure') return { label: 'Connection is encrypted (HTTPS)' };
      if (check.ok) return { label: 'Connected on the same computer as the server' };
      return {
        label: 'Not using HTTPS: passwords and data travel unencrypted',
        fix: (
          <>
            Put FlyBudget behind a reverse proxy with HTTPS (Caddy, Nginx, Traefik) or a VPN, and
            set <Env>FLYBUDGET_TRUST_PROXY</Env>.
          </>
        ),
      };
    case 'trustProxy':
      if (check.ok) return { label: 'Reverse proxy settings match how you connect' };
      if (check.reason === 'untrusted-proxy')
        return {
          label: 'A reverse proxy is in front of FlyBudget, but not trusted',
          fix: (
            <>
              Set <Env>FLYBUDGET_TRUST_PROXY=1</Env> (the number of proxies in front of FlyBudget)
              so HTTPS and client addresses are detected.
            </>
          ),
        };
      return {
        label: 'FLYBUDGET_TRUST_PROXY is set, but this request came without a proxy',
        fix: (
          <>
            If you connect directly, remove <Env>FLYBUDGET_TRUST_PROXY</Env>: otherwise clients can
            fake their address and get around the login attempt limit.
          </>
        ),
      };
    case 'allowedHosts':
      return check.ok
        ? { label: 'Only answers to the addresses you allowed' }
        : {
            label: 'Answers to any host name',
            fix: (
              <>
                Set <Env>FLYBUDGET_ALLOWED_HOSTS</Env> to the address you use, e.g.{' '}
                <Env>FLYBUDGET_ALLOWED_HOSTS=budget.example.com</Env>.
              </>
            ),
          };
    case 'encryptionKey':
      return check.ok
        ? { label: 'Bank credentials are encrypted at rest' }
        : {
            label: 'Bank credentials are not encrypted',
            fix: (
              <>
                Set <Env>FLYBUDGET_DATA_KEY_FILE</Env> to a file with a random key (see the
                self-hosting guide).
              </>
            ),
          };
    case 'password':
      return check.ok
        ? { label: 'A password protects this server' }
        : { label: 'No password is set yet' };
  }
}

function SecurityChecks() {
  const { data: info, isLoading } = useServerInfo();
  const checks = info?.checks ?? [];
  const warnings = checks.filter((c) => !c.ok).length;
  return (
    <section>
      <SectionTitle>Security check</SectionTitle>
      <p className="text-xs text-text-tertiary mt-1">
        {isLoading
          ? 'Checking your server…'
          : warnings === 0
            ? 'Everything looks good for how you connected just now.'
            : `${warnings} thing${warnings === 1 ? '' : 's'} to look at. Each is fixed with a setting in your docker-compose.yml.`}
        {info && <> Version {info.version}.</>}
      </p>
      <ul aria-label="Security check" className="mt-3 space-y-2">
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
                  aria-label="Passed"
                />
              ) : (
                <AlertTriangle
                  size={16}
                  className="text-caution shrink-0 mt-0.5"
                  aria-label="Warning"
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
    ? `Active ${ago(d.lastUsedAt)} · signed in ${ago(d.createdAt)}`
    : `Signed in ${ago(d.createdAt)}`;
}

function SignedInDevices() {
  const { data: devices = [], isLoading, isError } = useSessions(true);
  const signOutOne = useSignOutSession();
  const signOutOthers = useSignOutOtherSessions();
  const canSave = useCanSave();
  const others = devices.filter((d) => !d.current).length;

  return (
    <section className="pt-6 border-t border-border-light">
      <SectionTitle>Signed-in devices</SectionTitle>
      <p className="text-xs text-text-tertiary mt-1">
        Browsers signed in to this server. Sign out any you don't recognize, then change the
        password.
      </p>
      {isLoading && <Loader2 size={16} className="animate-spin text-text-tertiary mt-3" />}
      {isError && <p className="text-xs text-negative mt-3">Couldn't load the devices.</p>}
      <ul aria-label="Signed-in devices" className="mt-3 divide-y divide-border-light">
        {devices.map((d) => {
          const name = describeUserAgent(d.userAgent);
          return (
            <li key={d.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text flex items-center gap-2">
                  {name}
                  {d.current && (
                    <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-xs text-text-tertiary truncate">{deviceTimes(d)}</p>
              </div>
              {!d.current && (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Sign out ${name}`}
                  disabled={!canSave || signOutOne.isPending}
                  onClick={() => signOutOne.mutate(d.id)}
                >
                  Sign out
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
        <LogOut size={14} /> Sign out all other devices
      </Button>
    </section>
  );
}

function SelfHostedSettings() {
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
      return setMessage({ ok: false, text: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
    }
    if (next !== confirm) return setMessage({ ok: false, text: "The new passwords don't match." });
    setBusy(true);
    try {
      await authApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ ok: true, text: 'Password changed. Other devices have been signed out.' });
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
        <SectionTitle>Change password</SectionTitle>
        <p className="text-xs text-text-tertiary mt-1">
          This password protects your FlyBudget server. Changing it signs out every other device.
        </p>
        <form onSubmit={changePassword} className="space-y-3 mt-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Current password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              aria-label="Current password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              New password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              aria-label="New password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Confirm new password
            </label>
            <input
              type="password"
              autoComplete="new-password"
              aria-label="Confirm new password"
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
            <KeyRound size={14} /> Change password
          </Button>
        </form>
      </section>

      <section className="pt-6 border-t border-border-light">
        <SectionTitle>Sign out</SectionTitle>
        <p className="text-xs text-text-tertiary mt-1">Sign out of FlyBudget on this browser.</p>
        <Button variant="secondary" className="mt-4" onClick={signOut}>
          <LogOut size={14} /> Sign out
        </Button>
      </section>
    </div>
  );
}
