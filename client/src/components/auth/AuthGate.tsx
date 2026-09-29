import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock } from 'lucide-react';
import { AUTH_REQUIRED_EVENT } from '../../api/client';
import * as authApi from '../../api/auth';
import { Button } from '../ui/Button';
import { MIN_PASSWORD_LENGTH } from './passwordRules';

/**
 * Shows the login (or first-run setup) screen when FlyBudget runs as a server and
 * this browser isn't signed in. In the desktop app and dev mode login is disabled,
 * so this renders the app straight away.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const {
    data: status,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['auth-status'],
    queryFn: authApi.getAuthStatus,
    staleTime: Infinity,
    retry: 1,
  });

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
    return (
      <AuthScreen title="Can't reach FlyBudget">
        <p className="text-sm text-text-secondary text-center">
          The server isn't responding. Check that it's running, then reload this page.
        </p>
      </AuthScreen>
    );
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

function AuthScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-alt px-4">
      <div className="w-full max-w-sm bg-surface rounded-xl border border-border-light shadow-card p-8">
        <div className="flex flex-col items-center mb-6">
          <img src="/logo.png" alt="" className="w-12 h-12 mb-3" />
          <h1 className="text-lg font-semibold text-text">{title}</h1>
          {subtitle && (
            <p className="text-sm text-text-secondary text-center mt-1 leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
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

  return (
    <AuthScreen
      title={isSetup ? 'Set up your FlyBudget server' : 'Sign in to FlyBudget'}
      subtitle={
        isSetup
          ? 'Create the password that protects this server. Anyone who can reach it will need this password.'
          : undefined
      }
    >
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
