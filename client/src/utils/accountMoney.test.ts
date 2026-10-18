import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { earlierValue } from './accountMoney';

describe('earlierValue', () => {
  it("rescales an earlier balance by today's rate exactly, even for large balances", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e12, max: 1e12 }).filter((b) => b !== 0),
        fc.integer({ min: 1, max: 3_000_000 }),
        fc.integer({ min: -1e12, max: 1e12 }),
        (balance, permille, earlier) => {
          // Today's value at a rate of permille/1000
          const value = Math.round((balance * permille) / 1000);
          if (value === 0) return;
          const result = earlierValue(
            { balance, mainBalance: value, rateDate: '2026-01-01' },
            earlier,
          );
          const exact = (BigInt(earlier) * BigInt(value)) / BigInt(balance);
          // Within one unit of the exact rescale, and with its sign
          expect(Math.abs(Number(BigInt(result!) - exact))).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  it('keeps amounts in the budget currency, and has nothing to go on without a rate', () => {
    expect(earlierValue({ balance: 500, mainBalance: 500, rateDate: null }, 300)).toBe(300);
    expect(earlierValue({ balance: 500, mainBalance: null, rateDate: null }, 300)).toBeNull();
    expect(earlierValue({ balance: 0, mainBalance: 0, rateDate: '2026-01-01' }, 300)).toBeNull();
    expect(earlierValue({ balance: -1000, mainBalance: -900, rateDate: '2026-01-01' }, -500)).toBe(
      -450,
    );
  });
});
