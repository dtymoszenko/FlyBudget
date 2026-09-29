import { create } from 'zustand';
import { API_BASE } from '../api/base';
import { retryDelayMs } from '../utils/connection';

// Whether FlyBudget's server is reachable. apiFetch reports every request's outcome:
// a network failure (or a gateway saying the server is down) switches to
// "reconnecting", and any answer from the server switches back. While reconnecting,
// this pings GET /api/health with backoff (2s, 4s, 8s, 16s, then every 30s), pauses
// while the tab is hidden, and checks right away when the browser comes back online.
//
// Only /api/health is ever pinged: never the login routes (they're rate limited), and
// never any other server (the desktop app's API_BASE is its own local server).

export type ConnectionStatus = 'connected' | 'reconnecting';

interface ConnectionState {
  status: ConnectionStatus;
  /** Failed health checks during this outage */
  attempt: number;
  /** When the current wait started and when the next check runs (null while checking or paused) */
  waitStartedAt: number | null;
  retryAt: number | null;
  /** A health check is in flight */
  checking: boolean;
  /** Waiting for the tab to become visible again */
  paused: boolean;
  /** When the connection last came back (null if it never dropped) */
  reconnectedAt: number | null;
}

export const useConnectionStore = create<ConnectionState>(() => ({
  status: 'connected',
  attempt: 0,
  waitStartedAt: null,
  retryAt: null,
  checking: false,
  paused: false,
  reconnectedAt: null,
}));

const HEALTH_TIMEOUT_MS = 8_000;

let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | null = null;

const get = useConnectionStore.getState;
const set = useConnectionStore.setState;

function schedule(delay: number) {
  clearTimeout(timer);
  const now = Date.now();
  set({ waitStartedAt: now, retryAt: now + delay, paused: false });
  timer = setTimeout(() => void checkNow(), delay);
}

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Runs a health check now (unless one is running or the tab is hidden). */
function checkNow(): Promise<void> {
  clearTimeout(timer);
  if (get().status === 'connected') return Promise.resolve();
  if (inFlight) return inFlight;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    set({ paused: true, retryAt: null, waitStartedAt: null });
    return Promise.resolve();
  }
  set({ checking: true, retryAt: null, waitStartedAt: null, paused: false });
  inFlight = healthy().then((ok) => {
    inFlight = null;
    if (get().status === 'connected') return; // another request got through meanwhile
    if (ok) return reportServerReachable();
    const attempt = get().attempt + 1;
    set({ attempt, checking: false });
    schedule(retryDelayMs(attempt));
  });
  return inFlight;
}

/** A request couldn't reach the server: start reconnecting (if not already). */
export function reportNetworkFailure() {
  if (get().status === 'reconnecting') return;
  set({ status: 'reconnecting', attempt: 0, checking: false });
  schedule(retryDelayMs(0));
}

/** The server answered: the connection is back (or never left). */
export function reportServerReachable() {
  if (get().status === 'connected') return;
  clearTimeout(timer);
  set({
    status: 'connected',
    attempt: 0,
    waitStartedAt: null,
    retryAt: null,
    checking: false,
    paused: false,
    reconnectedAt: Date.now(),
  });
}

/** "Try now": check immediately instead of waiting for the countdown. */
export function retryConnectionNow(): Promise<void> {
  return checkNow();
}

if (typeof window !== 'undefined') {
  // Back online (e.g. Wi-Fi reconnected) or back to this tab: check straight away
  window.addEventListener('online', () => void checkNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && get().paused) void checkNow();
  });
}
