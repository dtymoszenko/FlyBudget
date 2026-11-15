import { useTranslation } from 'react-i18next';
import type { Connection } from '../../hooks/useConnection';
import { t } from '../../i18n';

/**
 * "Trying again in 4s" (or what's happening instead), for the reconnect screen; the banner
 * says "Retrying in 4s".
 */
export function retryLabel(
  c: Connection,
  kind: 'tryingAgain' | 'retrying' = 'tryingAgain',
): string {
  if (c.checking) return t('connection.retry.checking');
  if (c.paused) return t('connection.retry.paused');
  if (c.secondsLeft !== null) return t(`connection.retry.${kind}In`, { seconds: c.secondsLeft });
  return t(`connection.retry.${kind}`);
}

/** Thin bar that fills up until the next automatic check. */
export function RetryProgress({ connection }: { connection: Connection }) {
  const { t } = useTranslation();
  const pct = connection.checking ? 100 : Math.round(connection.progress * 100);
  return (
    <div
      role="progressbar"
      aria-label={t('connection.retry.progress')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1 w-full rounded-full bg-surface-alt overflow-hidden"
    >
      <div
        className={`h-full rounded-full bg-brand-500 transition-[width] duration-200 ease-linear ${
          connection.checking ? 'animate-pulse' : ''
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
