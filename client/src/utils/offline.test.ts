import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  OFFLINE_QUERY_KEYS,
  SNAPSHOT_MAX_AGE_MS,
  SNAPSHOT_VERSION,
  clientIdFrom,
  isOfflineQuery,
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
