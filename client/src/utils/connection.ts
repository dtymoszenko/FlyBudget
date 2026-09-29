// Pure helpers for the connection layer (store/connectionStore.ts): when to retry,
// what counts as "can't reach the server", and how to describe a connection.

/** First retry after 2s, then 4s, 8s, 16s, and every 30s after that. */
export const FIRST_RETRY_MS = 2_000;
export const MAX_RETRY_MS = 30_000;

/** How long to wait before health check number `attempt + 1` of an outage (attempt ≥ 0). */
export function retryDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  // 2^n overflows to Infinity for huge n, which the cap handles
  return Math.min(FIRST_RETRY_MS * 2 ** n, MAX_RETRY_MS);
}

/** Whole seconds left until `retryAt` (never negative), for "Retrying in 4s". */
export function secondsUntil(now: number, retryAt: number): number {
  return Math.max(0, Math.ceil((retryAt - now) / 1000));
}

/** How far through the wait we are, from 0 to 1, for the progress bar. */
export function waitProgress(now: number, startedAt: number, retryAt: number): number {
  if (retryAt <= startedAt) return 1;
  return Math.min(1, Math.max(0, (now - startedAt) / (retryAt - startedAt)));
}

/**
 * Whether a response means the FlyBudget server itself didn't answer: a gateway or
 * reverse proxy saying it's down (502-504), or the Vite dev proxy's bare 500 while
 * `tsx watch` restarts the server. FlyBudget's own errors always come back as JSON.
 */
export function isUnreachableResponse(status: number, contentType: string | null): boolean {
  if (status >= 502 && status <= 504) return true;
  return status === 500 && !(contentType ?? '').includes('application/json');
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

export const isLoopbackHost = (hostname: string) => LOOPBACK_HOSTS.includes(hostname.toLowerCase());

/** How private the connection between this browser and the server is. */
export type ConnectionSecurity = 'encrypted' | 'local' | 'unencrypted';

export function connectionSecurity(protocol: string, hostname: string): ConnectionSecurity {
  if (protocol === 'https:') return 'encrypted';
  return isLoopbackHost(hostname) ? 'local' : 'unencrypted';
}

/** A short name for the browser behind a user agent, like "Chrome on Windows". */
export function describeUserAgent(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown browser';
}
