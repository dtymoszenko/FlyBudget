import { Loader2, RefreshCw } from 'lucide-react';
import { useConnection } from '../../hooks/useConnection';
import type { AppMode } from '../../hooks/useServer';
import { AuthScreen } from '../auth/AuthScreen';
import { Button } from '../ui/Button';
import { RetryProgress, retryLabel } from './RetryStatus';

const TITLES: Record<AppMode, string> = {
  desktop: 'FlyBudget is starting up again',
  server: 'Reconnecting to your server',
  dev: 'Reconnecting to FlyBudget',
};

/**
 * Shown instead of the app when FlyBudget's server can't be reached on startup. Keeps
 * retrying on its own (see store/connectionStore.ts); the app loads, without a page
 * reload, as soon as the server answers.
 */
export function ReconnectScreen({ mode, onRetry }: { mode: AppMode; onRetry: () => void }) {
  const connection = useConnection();
  const host = window.location.host;
  // The server answered, but with an error: retrying is up to the button
  const serverError = connection.status === 'connected';

  function tryNow() {
    void connection.retryNow();
    onRetry();
  }

  return (
    <AuthScreen
      title={TITLES[mode]}
      subtitle={
        mode === 'desktop' ? (
          'This usually takes a few seconds.'
        ) : (
          <span className="font-mono text-xs break-all">{host}</span>
        )
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            {connection.checking ? (
              <Loader2 size={14} className="animate-spin shrink-0" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-caution shrink-0" aria-hidden />
            )}
            {serverError
              ? "FlyBudget's server answered with an error."
              : mode === 'desktop'
                ? retryLabel(connection)
                : `Can't reach it right now. ${retryLabel(connection)}`}
          </p>
          {!serverError && <RetryProgress connection={connection} />}
        </div>

        <Button className="w-full" onClick={tryNow} disabled={connection.checking}>
          <RefreshCw size={14} /> Try now
        </Button>

        {mode === 'desktop' && (
          <p className="text-xs text-text-tertiary leading-relaxed">
            If this doesn't go away, quit FlyBudget and open it again. Your data is safe on this
            computer.
          </p>
        )}
        {mode === 'dev' && (
          <p className="text-xs text-text-tertiary leading-relaxed">
            The development server may be restarting. If it stopped, run{' '}
            <code className="font-mono">npm run dev</code> again.
          </p>
        )}
        {mode === 'server' && (
          <details className="text-xs text-text-secondary">
            <summary className="cursor-pointer select-none text-text-secondary hover:text-text">
              Troubleshooting
            </summary>
            <div className="mt-3 space-y-3 leading-relaxed">
              <p>Your budget is safe on the server; this page just can't reach it.</p>
              <div>
                <p>Check that the container is running:</p>
                <pre className="mt-1 px-2 py-1.5 rounded bg-surface-alt font-mono text-[11px] overflow-x-auto">
                  docker ps --filter name=flybudget
                </pre>
              </div>
              <div>
                <p>See what it logged:</p>
                <pre className="mt-1 px-2 py-1.5 rounded bg-surface-alt font-mono text-[11px] overflow-x-auto">
                  docker logs --tail 50 flybudget
                </pre>
              </div>
              <p>
                If you reach it through a reverse proxy or VPN, check that it's running too, and
                that this device is connected to the right network.
              </p>
            </div>
          </details>
        )}
      </div>
    </AuthScreen>
  );
}
