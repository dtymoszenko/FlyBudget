import type { Connection } from '../../hooks/useConnection';

/** "Trying again in 4s" (or what's happening instead), for the reconnect screen and banner. */
export function retryLabel(c: Connection, verb = 'Trying again'): string {
  if (c.checking) return 'Checking…';
  if (c.paused) return 'Paused while this tab is in the background';
  if (c.secondsLeft !== null) return `${verb} in ${c.secondsLeft}s`;
  return `${verb}…`;
}

/** Thin bar that fills up until the next automatic check. */
export function RetryProgress({ connection }: { connection: Connection }) {
  const pct = connection.checking ? 100 : Math.round(connection.progress * 100);
  return (
    <div
      role="progressbar"
      aria-label="Time until the next try"
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
