import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { ApiError, NetworkError } from '../api/client';
import * as txApi from '../api/transactions';
import { sendable, type OutboxItem } from '../utils/offline';
import { deleteValue, readValue, storageWorks, updateValue } from './storage';

// New transactions saved while FlyBudget can't reach its server wait here, on this device,
// and are sent in order once it's back. Each carries the id it will have on the server, so
// sending one twice (the answer got lost, or two tabs sent it) never creates a duplicate.
//
// Only new transactions and transfers wait: they add something and can't clash with
// anything. Edits, deletes and budget changes still need the connection, so a change made
// elsewhere is never silently overwritten.

const KEY = 'outbox';

interface OutboxState {
  items: OutboxItem[];
  /** This browser can store waiting transactions (not in some private windows) */
  available: boolean;
  sending: boolean;
}

export const useOutbox = create<OutboxState>(() => ({
  items: [],
  available: false,
  sending: false,
}));

// Other tabs of FlyBudget share the list: reload it when one of them changes it
const channel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('flybudget-outbox') : null;
if (channel) channel.onmessage = () => void loadOutbox();

const asList = (v: unknown): OutboxItem[] => (Array.isArray(v) ? v : []);

async function stored(): Promise<OutboxItem[]> {
  const items = await readValue<OutboxItem[]>(KEY);
  return Array.isArray(items) ? items : useOutbox.getState().items;
}

/** Changes the stored list in one step, so a change from another tab is never lost. */
async function change(fn: (items: OutboxItem[]) => OutboxItem[]) {
  const items = await updateValue<OutboxItem[]>(KEY, (current) => fn(asList(current)));
  useOutbox.setState({ items: items ?? fn(useOutbox.getState().items) });
  channel?.postMessage('changed');
}

/** Loads the waiting list. Call before the first render. */
export async function loadOutbox() {
  const available = await storageWorks();
  const items = available ? await readValue<OutboxItem[]>(KEY) : undefined;
  useOutbox.setState({ available, items: asList(items) });
}

type NewItem =
  | { kind: 'transaction'; data: txApi.CreateTransactionData }
  | { kind: 'transfer'; data: txApi.CreateTransferData };

/** Saves a new transaction or transfer on this device, to send when the server is back. */
export function queueOnDevice(id: string, item: NewItem) {
  const { id: _id, ...data } = item.data;
  return change((items) =>
    items.some((i) => i.id === id)
      ? items
      : [...items, { ...item, data, id, savedAt: Date.now() } as OutboxItem],
  );
}

export const discardWaiting = (id: string) => change((items) => items.filter((i) => i.id !== id));

/** Clears a refused item's error so the next send tries it again. */
export const retryWaiting = (id: string) =>
  change((items) => items.map((i) => (i.id === id ? { ...i, error: undefined } : i)));

/** Deletes every waiting transaction (sign-out). */
export async function clearOutbox() {
  useOutbox.setState({ items: [] });
  await deleteValue(KEY);
  channel?.postMessage('changed');
}

/** Worth trying again later: offline, the server is struggling, or a login is needed first */
function temporary(err: unknown) {
  if (err instanceof NetworkError) return true;
  return err instanceof ApiError && (err.status === 401 || err.status === 429 || err.status >= 500);
}

async function sendAll(qc: QueryClient) {
  let sent = 0;
  useOutbox.setState({ sending: true });
  try {
    for (const item of sendable(await stored())) {
      try {
        if (item.kind === 'transaction')
          await txApi.createTransaction({ ...item.data, id: item.id });
        else await txApi.createTransfer({ ...item.data, id: item.id });
        await change((items) => items.filter((i) => i.id !== item.id));
        sent++;
      } catch (err) {
        if (temporary(err)) break;
        // Refused (say its account was deleted meanwhile): keep it for the user to fix or discard
        const error = err instanceof Error ? err.message : "Couldn't be saved";
        await change((items) => items.map((i) => (i.id === item.id ? { ...i, error } : i)));
      }
    }
  } finally {
    useOutbox.setState({ sending: false });
    if (sent) void qc.invalidateQueries();
  }
}

let running: Promise<void> | null = null;
let again = false;

/**
 * Sends every waiting transaction, oldest first. One run at a time, across tabs too; a
 * call during a run makes it go once more at the end, for anything saved meanwhile.
 */
export function sendWaiting(qc: QueryClient): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        if (typeof navigator !== 'undefined' && navigator.locks) {
          await navigator.locks.request('flybudget-outbox', () => sendAll(qc));
        } else {
          await sendAll(qc);
        }
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}
