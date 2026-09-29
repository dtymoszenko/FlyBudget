import type { CreateTransactionData, CreateTransferData } from '../api/transactions';

// Offline copy: FlyBudget keeps what it last loaded on this device, so the app still opens
// (read-only) when its server can't be reached, and new transactions typed while offline
// wait here until they can be sent. These are the pure parts; the storage lives in
// src/offline/.

/**
 * Cached answers worth keeping on the device: the budget data itself. Never sign-in state,
 * signed-in devices, server details or bank connections.
 */
export const OFFLINE_QUERY_KEYS: ReadonlySet<string> = new Set([
  'accounts',
  'budget',
  'budget-summary',
  'categories',
  'category-history',
  'custom-reports',
  'dashboards',
  'goals',
  'payees',
  'reports',
  'rules',
  'schedule-occurrences',
  'schedule-summary',
  'schedules',
  'transactions',
]);

export function isOfflineQuery(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === 'string' && OFFLINE_QUERY_KEYS.has(queryKey[0]);
}

/** Bump when the saved format changes, so an old copy is ignored instead of misread */
export const SNAPSHOT_VERSION = 1;

/** A copy older than this isn't shown (sessions last 30 days too) */
export const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function snapshotUsable(
  snapshot: { version: unknown; savedAt: unknown } | null | undefined,
  now: number,
): boolean {
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION) return false;
  const { savedAt } = snapshot;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return false;
  // A copy "from the future" means the clock moved; still fine to show within the window
  return Math.abs(now - savedAt) <= SNAPSHOT_MAX_AGE_MS;
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * An id for a transaction saved offline (the server accepts 16-64 of [A-Za-z0-9_-]).
 * Pass 16+ random bytes: crypto.getRandomValues works on plain-HTTP self-hosted setups,
 * where crypto.randomUUID doesn't exist.
 */
export function clientIdFrom(bytes: Uint8Array): string {
  let id = '';
  for (const b of bytes) id += ID_ALPHABET[b & 63];
  return id;
}

export function newClientId(): string {
  return clientIdFrom(crypto.getRandomValues(new Uint8Array(22)));
}

/** A new transaction or transfer saved on this device, waiting to be sent */
export type OutboxItem = {
  id: string;
  /** When it was saved on the device (ms) */
  savedAt: number;
  /** Why the server refused it (it stays until tried again or discarded) */
  error?: string;
} & (
  | { kind: 'transaction'; data: CreateTransactionData }
  | { kind: 'transfer'; data: CreateTransferData }
);

/** How a waiting item shows in an account's register (null if it isn't in that account) */
export function outboxEntryFor(
  item: OutboxItem,
  accountId: string | undefined,
): { accountId: string; amount: number } | null {
  if (item.kind === 'transaction') {
    if (accountId && item.data.accountId !== accountId) return null;
    return { accountId: item.data.accountId, amount: item.data.amount };
  }
  const { fromAccountId, toAccountId, amount } = item.data;
  // All accounts: the transfer shows once, as money leaving the first account
  if (!accountId || accountId === fromAccountId)
    return { accountId: fromAccountId, amount: -amount };
  if (accountId === toAccountId) return { accountId: toAccountId, amount };
  return null;
}

/** Items to send, oldest first (refused ones wait for the user) */
export function sendable(items: readonly OutboxItem[]): OutboxItem[] {
  return items.filter((i) => !i.error).sort((a, b) => a.savedAt - b.savedAt);
}
