import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, KeyRound } from 'lucide-react';
import * as authApi from '../../api/auth';
import { Button } from '../ui/Button';
import { MIN_PASSWORD_LENGTH } from '../auth/passwordRules';

const inputClass =
  'w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600';

/** Server mode only: change the server password and sign out. */
export function ServerSettings() {
  const qc = useQueryClient();
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

  async function signOut() {
    await authApi.logout().catch(() => {});
    qc.clear();
    qc.invalidateQueries({ queryKey: ['auth-status'] });
  }

  return (
    <div className="max-w-md space-y-8">
      <section>
        <h2 className="text-sm font-semibold text-text">Change password</h2>
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
          <Button type="submit" disabled={busy || !current || !next}>
            <KeyRound size={14} /> Change password
          </Button>
        </form>
      </section>

      <section className="pt-6 border-t border-border-light">
        <h2 className="text-sm font-semibold text-text">Sign out</h2>
        <p className="text-xs text-text-tertiary mt-1">Sign out of FlyBudget on this browser.</p>
        <Button variant="secondary" className="mt-4" onClick={signOut}>
          <LogOut size={14} /> Sign out
        </Button>
      </section>
    </div>
  );
}
