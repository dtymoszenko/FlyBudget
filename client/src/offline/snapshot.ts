import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import type { AuthStatus } from '../api/auth';
import { useConnectionStore } from '../store/connectionStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { SNAPSHOT_VERSION, isOfflineQuery, snapshotUsable } from '../utils/offline';
import { deleteValue, readValue, writeValue } from './storage';

// The offline copy: what the app last loaded (accounts, budget, transactions, reports...)
// saved on this device, so FlyBudget still opens when its server can't be reached. It's
// restored before the first render (which also makes every start instant), refreshed a
// moment after new data arrives while connected, and deleted on sign-out, when the server
// asks for a login again, or when turned off in Settings → Server.
//
// Not used in the desktop app: its server runs inside the app, so there is never a
// window without it, and the budget file is already on the same disk.

const KEY = 'snapshot';
const SAVE_DELAY_MS = 1_500;
const RESTORE_TIMEOUT_MS = 1_500;

interface Snapshot {
  version: number;
  savedAt: number;
  state: DehydratedState;
}

interface OfflineCopyState {
  /** A copy was restored at startup (the app can open without the server) */
  restored: boolean;
  /** When the data on screen was last current: the copy's time, or the last load from the server */
  dataAsOf: number | null;
}

export const useOfflineCopy = create<OfflineCopyState>(() => ({ restored: false, dataAsOf: null }));

export const offlineCopySupported = () => typeof window !== 'undefined' && !window.__API_BASE__;
const enabled = () => offlineCopySupported() && usePreferencesStore.getState().keepOfflineCopy;

/** Loads the saved copy into the cache. Resolves quickly even if storage is slow or missing. */
export async function restoreOfflineCopy(qc: QueryClient): Promise<void> {
  if (!enabled()) return;
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), RESTORE_TIMEOUT_MS));
  const snapshot = await Promise.race([readValue<Snapshot>(KEY), timeout]);
  if (!snapshot || !snapshotUsable(snapshot, Date.now())) return;
  try {
    hydrate(qc, snapshot.state);
    useOfflineCopy.setState({ restored: true, dataAsOf: snapshot.savedAt });
  } catch {
    // A damaged copy: start without it
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function signedOut(qc: QueryClient) {
  const auth = qc.getQueryData<AuthStatus>(['auth-status']);
  return !!auth && auth.enabled && !auth.authenticated;
}

function save(qc: QueryClient) {
  // Only while connected and signed in: never overwrite a good copy with a half-failed cache
  if (!enabled() || signedOut(qc) || useConnectionStore.getState().status !== 'connected') return;
  const state = dehydrate(qc, {
    shouldDehydrateQuery: (q) => q.state.data !== undefined && isOfflineQuery(q.queryKey),
    shouldDehydrateMutation: () => false,
  });
  // Saved as plain finished answers (no in-flight promises or errors)
  state.queries = state.queries.map(({ promise: _promise, ...q }) => ({
    ...q,
    state: {
      ...q.state,
      status: 'success',
      fetchStatus: 'idle',
      error: null,
      fetchFailureCount: 0,
      fetchFailureReason: null,
    },
  }));
  void writeValue(KEY, {
    version: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    state,
  } satisfies Snapshot);
}

/** Keeps the copy up to date as data loads. Call once, after restoreOfflineCopy. */
export function startOfflineCopy(qc: QueryClient) {
  qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (!isOfflineQuery(event.query.queryKey)) return;
    useOfflineCopy.setState({ dataAsOf: Date.now() });
    if (!enabled()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      save(qc);
    }, SAVE_DELAY_MS);
  });
  if (typeof window !== 'undefined') {
    // Closing the tab mid-wait: save now
    window.addEventListener('pagehide', () => {
      if (saveTimer === undefined) return;
      clearTimeout(saveTimer);
      saveTimer = undefined;
      save(qc);
    });
  }
}

/** Deletes the copy from this device (sign-out, login required again, or turned off). */
export function clearOfflineCopy(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  useOfflineCopy.setState({ restored: false });
  return deleteValue(KEY);
}
