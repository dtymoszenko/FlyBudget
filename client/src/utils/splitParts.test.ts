import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  balancingPart,
  emptyPart,
  partsBalanced,
  partsToSend,
  remainingOf,
  type SplitPart,
} from './splitParts';

const part = (amount: number, categoryId: string | null = null): SplitPart => ({
  categoryId,
  amount,
  notes: '',
});

describe('split parts', () => {
  it('are balanced only with two or more amounts adding up to the whole', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000_000 }), { maxLength: 6 }), (amounts) => {
        const total = amounts.reduce((s, a) => s + a, 0);
        const parts = amounts.map((a) => part(a));
        expect(remainingOf(total, parts)).toBe(0);
        expect(partsBalanced(total, parts)).toBe(amounts.filter((a) => a > 0).length >= 2);
        expect(partsBalanced(total + 1, parts)).toBe(false);
      }),
    );
  });

  it('are sent signed like the whole, without empty parts, adding up to it', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 2, maxLength: 6 }),
        fc.boolean(),
        (amounts, outflow) => {
          const total = amounts.reduce((s, a) => s + a, 0);
          const sent = partsToSend(
            amounts.map((a) => part(a)),
            outflow,
          );
          expect(sent.every((p) => p.amount !== 0 && p.amount < 0 === outflow)).toBe(true);
          expect(sent.reduce((s, p) => s + p.amount, 0)).toBe(outflow ? -total : total);
        },
      ),
    );
  });

  it('keep their category and send empty notes as null', () => {
    expect(
      partsToSend([part(500, 'c1'), { ...emptyPart(), amount: 250, notes: 'tip' }], true),
    ).toEqual([
      { categoryId: 'c1', amount: -500, notes: null },
      { categoryId: null, amount: -250, notes: 'tip' },
    ]);
  });

  it('suggest the amount that balances them, on the first empty part or else the first', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 2, maxLength: 6 }),
        fc.integer({ min: 1, max: 5_000_000 }),
        (amounts, total) => {
          const parts = amounts.map((a) => part(a));
          const suggestion = balancingPart(total, parts);
          const index = Math.max(amounts.indexOf(0), 0);
          const remaining = remainingOf(total, parts);
          if (!suggestion) {
            expect(remaining === 0 || amounts[index] + remaining <= 0).toBe(true);
            return;
          }
          expect(suggestion.index).toBe(index);
          expect(suggestion.amount).toBeGreaterThan(0);
          const balanced = parts.map((p, i) =>
            i === suggestion.index ? { ...p, amount: suggestion.amount } : p,
          );
          expect(remainingOf(total, balanced)).toBe(0);
        },
      ),
    );
  });

  it('suggest the first part for the rest of a non-round amount', () => {
    expect(balancingPart(8743, [part(8743), part(1999)])).toEqual({ index: 0, amount: 6744 });
    expect(balancingPart(8743, [part(2000), part(0)])).toEqual({ index: 1, amount: 6743 });
    expect(balancingPart(8743, [part(6744), part(1999)])).toBeNull();
    expect(balancingPart(1000, [part(500), part(1500)])).toBeNull();
  });
});
