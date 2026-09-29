import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Lock } from 'lucide-react';
import { AUTH_REQUIRED_EVENT, NetworkError } from '../../api/client';
import * as authApi from '../../api/auth';
import { appModeFrom } from '../../hooks/useServer';
import { useConnectionStore } from '../../store/connectionStore';
import { connectionSecurity } from '../../utils/connection';
import { ReconnectScreen } from '../connection/ReconnectScreen';
import { Button } from '../ui/Button';
import { AuthScreen } from './AuthScreen';
import { MIN_PASSWORD_LENGTH } from './passwordRules';

/**
 * Shows the login (or first-run setup) screen when FlyBudget runs as a server and
 * this browser isn't signed in. In the desktop app and dev mode login is disabled,
 * so this renders the app straight away. If the server can't be reached on startup it
 * shows a reconnect screen that keeps retrying, and the app loads once it answers.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['auth-status'],
    queryFn: authApi.getAuthStatus,
    staleTime: Infinity,
    // Can't reach the server: show the reconnect screen straight away (it retries itself)
    retry: (failures, err) => !(err instanceof NetworkError) && failures < 1,
  });

  // Back online (after a failed start or mid-session): refresh everything on screen
  const reconnectedAt = useConnectionStore((s) => s.reconnectedAt);
  useEffect(() => {
    if (reconnectedAt !== null) void qc.invalidateQueries();
  }, [reconnectedAt, qc]);

  // A request came back "login required" (session expired or signed out elsewhere)
  useEffect(() => {
    const onAuthRequired = () => qc.invalidateQueries({ queryKey: ['auth-status'] });
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, [qc]);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-alt">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }
  if (isError || !status) {
    return <ReconnectScreen mode={appModeFrom(status)} onRetry={() => void refetch()} />;
  }
  if (!status.enabled || status.authenticated) return <>{children}</>;

  const onSignedIn = () => {
    // Everything cached before signing in is stale. Not qc.clear(): that would also detach
    // the auth-status query this component is subscribed to, and the update below would
    // never reach it (the sign-in screen stayed up until a reload).
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth-status' });
    qc.setQueryData(['auth-status'], { ...status, needsSetup: false, authenticated: true });
  };
  return status.needsSetup ? (
    <PasswordForm mode="setup" onDone={onSignedIn} />
  ) : (
    <PasswordForm mode="login" onDone={onSignedIn} />
  );
}

function PasswordForm({ mode, onDone }: { mode: 'setup' | 'login'; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSetup = mode === 'setup';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isSetup && password.length < MIN_PASSWORD_LENGTH) {
      return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (isSetup && password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    try {
      await (isSetup ? authApi.setupPassword(password, code) : authApi.login(password));
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const inputClass =
    'w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600';
  const { host, hostname, protocol } = window.location;
  const unencrypted = connectionSecurity(protocol, hostname) === 'unencrypted';

  return (
    <AuthScreen
      title={isSetup ? 'Set up your FlyBudget server' : 'Sign in to FlyBudget'}
      subtitle={
        <>
          <span className="block font-mono text-xs break-all" aria-label="Server address">
            {host}
          </span>
          {isSetup && (
            <span className="block mt-2">
              Create the password that protects this server. Anyone who can reach it will need this
              password.
            </span>
          )}
        </>
      }
    >
      {unencrypted && (
        <div
          role="note"
          className="flex gap-2 mb-4 p-3 rounded-md bg-caution-subtle border border-caution/30 text-xs text-text leading-relaxed"
        >
          <AlertTriangle size={14} className="text-caution shrink-0 mt-0.5" aria-hidden />
          <p>
            <span className="font-semibold">Not a secure connection.</span> Your password would
            travel unencrypted. Only continue on a network you trust.
          </p>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        {isSetup && (
          <div>
            <label
              htmlFor="setup-code"
              className="block text-sm font-medium text-text-secondary mb-1"
            >
              Setup code
            </label>
            <input
              id="setup-code"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${inputClass} font-mono uppercase`}
            />
            <p className="text-xs text-text-tertiary mt-1">
              Printed in the server log. With Docker, run{' '}
              <code className="font-mono">docker logs flybudget</code>.
            </p>
          </div>
        )}
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-1">
            {isSetup ? 'New password' : 'Password'}
          </label>
          <input
            id="password"
            type="password"
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            autoFocus={!isSetup}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        {isSetup && (
          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-text-secondary mb-1">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </div>
        )}
        {error && <p className="text-xs text-negative">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !password || (isSetup && !code)}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
          {isSetup ? 'Create password' : 'Sign in'}
        </Button>
      </form>
    </AuthScreen>
  );
}
