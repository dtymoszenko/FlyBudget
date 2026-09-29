import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  OFFLINE_QUERY_KEYS,
  SNAPSHOT_MAX_AGE_MS,
  SNAPSHOT_VERSION,
  MAX_SAVED_QUERIES,
  clientIdFrom,
  isOfflineQuery,
  mergeSavedQueries,
  outboxEntryFor,
  sendable,
  snapshotUsable,
  type OutboxItem,
} from './offline';

const SERVER_ID = /^[A-Za-z0-9_-]{16,64}$/;

describe('offline copy (property-based)', () => {
  it('never keeps sign-in, device, server or bank connection data', () => {
    for (const key of [
      'auth-status',
      'auth-sessions',
      'server-info',
      'plaid-items',
      'plaid-status',
      'simplefin-connections',
      'simplefin-status',
    ]) {
      expect(isOfflineQuery([key])).toBe(false);
    }
    fc.assert(
      fc.property(fc.constantFrom(...OFFLINE_QUERY_KEYS), fc.array(fc.anything()), (k, rest) => {
        expect(isOfflineQuery([k, ...rest])).toBe(true);
      }),
    );
    fc.assert(
      fc.property(
        fc.anything().filter((v) => typeof v !== 'string' || !OFFLINE_QUERY_KEYS.has(v)),
        (k) => {
          expect(isOfflineQuery([k])).toBe(false);
        },
      ),
    );
  });

  it('shows a copy only within 30 days and in the current format', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4e12 }),
        fc.integer({ min: -2 * SNAPSHOT_MAX_AGE_MS, max: 2 * SNAPSHOT_MAX_AGE_MS }),
        fc.anything(),
        (now, age, version) => {
          const savedAt = now - age;
          expect(snapshotUsable({ version: SNAPSHOT_VERSION, savedAt }, now)).toBe(
            Math.abs(age) <= SNAPSHOT_MAX_AGE_MS,
          );
          if (version !== SNAPSHOT_VERSION) {
            expect(snapshotUsable({ version, savedAt }, now)).toBe(false);
          }
        },
      ),
    );
    for (const bad of [null, undefined, { version: SNAPSHOT_VERSION, savedAt: NaN }]) {
      expect(snapshotUsable(bad as never, Date.now())).toBe(false);
    }
  });

  it('makes ids the server accepts from any random bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 16, maxLength: 64 }), (bytes) => {
        const id = clientIdFrom(bytes);
        expect(id).toMatch(SERVER_ID);
        expect(id).toHaveLength(bytes.length);
      }),
    );
  });
});

const txItem = fc.record({
  id: fc.string(),
  savedAt: fc.integer({ min: 0, max: 4e12 }),
  kind: fc.constant('transaction' as const),
  data: fc.record({
    accountId: fc.constantFrom('a', 'b', 'c'),
    date: fc.constant('2026-09-29'),
    amount: fc.integer({ min: -1e9, max: 1e9 }),
  }),
});
const transferItem = fc.record({
  id: fc.string(),
  savedAt: fc.integer({ min: 0, max: 4e12 }),
  kind: fc.constant('transfer' as const),
  data: fc
    .record({
      fromAccountId: fc.constantFrom('a', 'b', 'c'),
      toAccountId: fc.constantFrom('a', 'b', 'c'),
      date: fc.constant('2026-09-29'),
      amount: fc.integer({ min: 1, max: 1e9 }),
    })
    .filter((d) => d.fromAccountId !== d.toAccountId),
});
const item: fc.Arbitrary<OutboxItem> = fc.oneof(txItem, transferItem);

describe('waiting transactions (property-based)', () => {
  it('shows a transfer as money out of one account and into the other, summing to zero', () => {
    fc.assert(
      fc.property(transferItem, (t) => {
        const out = outboxEntryFor(t, t.data.fromAccountId)!;
        const into = outboxEntryFor(t, t.data.toAccountId)!;
        expect(out.amount).toBe(-t.data.amount);
        expect(out.amount + into.amount).toBe(0);
      }),
    );
  });

  it('lists an item only in the accounts it touches, and always in "all accounts"', () => {
    fc.assert(
      fc.property(item, fc.constantFrom('a', 'b', 'c'), (i, account) => {
        const touches =
          i.kind === 'transaction'
            ? [i.data.accountId]
            : [i.data.fromAccountId, i.data.toAccountId];
        expect(outboxEntryFor(i, account) !== null).toBe(touches.includes(account));
        expect(outboxEntryFor(i, undefined)).not.toBeNull();
      }),
    );
  });

  it('sends oldest first and holds back refused items', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(item, fc.option(fc.string()))), (pairs) => {
        const items = pairs.map(([i, error]) => (error === null ? i : { ...i, error }));
        const out = sendable(items);
        expect(out.every((i) => !i.error)).toBe(true);
        expect(out).toHaveLength(items.filter((i) => !i.error).length);
        for (let k = 1; k < out.length; k++) {
          expect(out[k - 1].savedAt).toBeLessThanOrEqual(out[k].savedAt);
        }
      }),
    );
  });
});

describe('saving the offline copy (property-based)', () => {
  const NOW = 2_000_000_000_000;
  const saved = (keys: readonly string[]) =>
    fc.record({
      queryHash: fc.string({ maxLength: 3 }),
      queryKey: fc.constantFrom(...keys).map((k) => [k]),
      state: fc.record({
        dataUpdatedAt: fc.integer({ min: NOW - 2 * SNAPSHOT_MAX_AGE_MS, max: NOW }),
      }),
    });
  const allowed = [...OFFLINE_QUERY_KEYS];

  it('keeps what is loaded now, adds older pages, and stays within the limits', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(saved(allowed), { selector: (q) => q.queryHash, maxLength: 30 }),
        fc.array(saved([...allowed, 'auth-status', 'server-info']), { maxLength: 30 }),
        fc.integer({ min: 1, max: 40 }),
        (current, previous, max) => {
          const out = mergeSavedQueries(current, previous, NOW, max);
          const hashes = out.map((q) => q.queryHash);
          expect(new Set(hashes).size).toBe(hashes.length);
          expect(out.length).toBeLessThanOrEqual(max);
          for (const q of out) {
            // Never login or server details, and nothing older than the limit from earlier saves
            expect(isOfflineQuery(q.queryKey)).toBe(true);
            if (!current.includes(q)) {
              expect(NOW - q.state.dataUpdatedAt).toBeLessThanOrEqual(SNAPSHOT_MAX_AGE_MS);
            }
          }
          // Everything loaded now is kept first (as loaded, not an older save of it)
          const loadedKept = Math.min(current.length, max);
          expect(out.slice(0, loadedKept).every((q) => current.includes(q))).toBe(true);
          // Earlier saves only fill the room that's left, newest first
          const older = out.slice(loadedKept);
          for (let i = 1; i < older.length; i++) {
            expect(older[i - 1].state.dataUpdatedAt).toBeGreaterThanOrEqual(
              older[i].state.dataUpdatedAt,
            );
          }
        },
      ),
    );
  });

  it('never keeps more than the default limit', () => {
    const many = Array.from({ length: MAX_SAVED_QUERIES + 50 }, (_, i) => ({
      queryHash: String(i),
      queryKey: ['transactions', i],
      state: { dataUpdatedAt: NOW - i },
    }));
    const loaded = many.slice(-10); // the oldest ten are what's on screen now
    const out = mergeSavedQueries(loaded, many, NOW);
    expect(out).toHaveLength(MAX_SAVED_QUERIES);
    expect(out.slice(0, 10).map((q) => q.queryHash)).toEqual(loaded.map((q) => q.queryHash));
  });
});
