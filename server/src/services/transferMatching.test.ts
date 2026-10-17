import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { addDays, format } from 'date-fns';
import {
  TRANSFER_MATCH_DAYS,
  bestCounterpart,
  couldBeTransfer,
  dayGap,
  findTransferMatches,
  pairKey,
  type TransferCandidate,
} from './transferMatching.js';

const EPOCH = new Date(2020, 0, 1);
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

// Few accounts, amounts and days, so plenty of rows could pair up (and compete for each other)
const arbRow = fc.record({
  accountId: fc.constantFrom('checking', 'savings', 'card'),
  date: fc.integer({ min: 0, max: 40 }).map((n) => iso(addDays(EPOCH, n))),
  amount: fc.constantFrom(-5_000, -2_500, -100, 0, 100, 2_500, 5_000),
});
const arbRows = fc
  .array(arbRow, { maxLength: 40 })
  .map((rows): TransferCandidate[] => rows.map((r, i) => ({ ...r, id: `t${i}` })));

describe('findTransferMatches', () => {
  it('pairs an outflow with the same amount arriving in another account, within the window', () => {
    fc.assert(
      fc.property(arbRows, (rows) => {
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const m of findTransferMatches(rows)) {
          const out = byId.get(m.outflowId)!;
          const inflow = byId.get(m.inflowId)!;
          expect(out.amount).toBeLessThan(0);
          expect(couldBeTransfer(out, inflow)).toBe(true);
          expect(m.days).toBe(dayGap(out.date, inflow.date));
          expect(m.days).toBeLessThanOrEqual(TRANSFER_MATCH_DAYS);
        }
      }),
    );
  });

  it('uses every transaction at most once', () => {
    fc.assert(
      fc.property(arbRows, (rows) => {
        const ids = findTransferMatches(rows).flatMap((m) => [m.outflowId, m.inflowId]);
        expect(new Set(ids).size).toBe(ids.length);
      }),
    );
  });

  it('leaves no two unpaired transactions that could still be a transfer', () => {
    fc.assert(
      fc.property(arbRows, (rows) => {
        const used = new Set(findTransferMatches(rows).flatMap((m) => [m.outflowId, m.inflowId]));
        const left = rows.filter((r) => !used.has(r.id));
        for (const a of left) {
          for (const b of left) expect(a.amount < 0 && couldBeTransfer(a, b)).toBe(false);
        }
      }),
    );
  });

  it("doesn't depend on the order of the rows", () => {
    fc.assert(
      fc.property(
        arbRows.chain((rows) =>
          fc.tuple(fc.constant(rows), fc.shuffledSubarray(rows, { minLength: rows.length })),
        ),
        ([rows, shuffled]) => {
          expect(findTransferMatches(shuffled)).toEqual(findTransferMatches(rows));
        },
      ),
    );
  });

  it('never suggests a dismissed pair', () => {
    fc.assert(
      fc.property(arbRows, fc.array(fc.nat({ max: 39 }), { maxLength: 30 }), (rows, picks) => {
        const first = findTransferMatches(rows);
        const dismissed = new Set(
          picks
            .filter((i) => i < first.length)
            .map((i) => pairKey(first[i].inflowId, first[i].outflowId)),
        );
        for (const m of findTransferMatches(rows, dismissed)) {
          expect(dismissed.has(pairKey(m.outflowId, m.inflowId))).toBe(false);
        }
      }),
    );
  });

  it('prefers the closest date when two inflows could match', () => {
    const rows: TransferCandidate[] = [
      { id: 'out', accountId: 'checking', date: '2024-03-01', amount: -10_000 },
      { id: 'far', accountId: 'savings', date: '2024-03-05', amount: 10_000 },
      { id: 'near', accountId: 'card', date: '2024-03-02', amount: 10_000 },
      { id: 'same-account', accountId: 'checking', date: '2024-03-01', amount: 10_000 },
      { id: 'too-late', accountId: 'savings', date: '2024-03-08', amount: 10_000 },
    ];
    expect(findTransferMatches(rows)).toEqual([{ outflowId: 'out', inflowId: 'near', days: 1 }]);
  });
});

describe('bestCounterpart', () => {
  it('is the closest matching row, or null', () => {
    fc.assert(
      fc.property(arbRows, fc.nat({ max: 39 }), (rows, i) => {
        if (i >= rows.length) return;
        const tx = rows[i];
        const best = bestCounterpart(tx, rows);
        const options = rows.filter((r) => r.id !== tx.id && couldBeTransfer(tx, r));
        if (!options.length) {
          expect(best).toBeNull();
        } else {
          expect(best && couldBeTransfer(tx, best)).toBe(true);
          const closest = Math.min(...options.map((r) => dayGap(tx.date, r.date)));
          expect(dayGap(tx.date, best!.date)).toBe(closest);
        }
      }),
    );
  });

  it('skips a dismissed pair', () => {
    const tx = { id: 'a', accountId: 'checking', date: '2024-01-10', amount: -500 };
    const other = { id: 'b', accountId: 'savings', date: '2024-01-10', amount: 500 };
    expect(bestCounterpart(tx, [other])).toEqual(other);
    expect(bestCounterpart(tx, [other], new Set([pairKey('b', 'a')]))).toBeNull();
  });
});
