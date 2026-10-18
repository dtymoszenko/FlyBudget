import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildRateBook } from './exchangeRates.js';
import {
  effectiveMainAmount,
  mainAmountFor,
  transferMainAmounts,
  type MainAmount,
} from './mainAmounts.js';

const BUDGET = 'EUR';
const rates = buildRateBook([
  { date: '2024-01-01', base: 'EUR', quote: 'USD', rate: '1.0812', source: 'ecb' },
  { date: '2024-01-01', base: 'EUR', quote: 'JPY', rate: '161.37', source: 'ecb' },
]);
const noRates = buildRateBook([]);

const arbCurrency = fc.constantFrom(null, 'EUR', 'USD', 'JPY', 'PLN');
const arbAmount = fc.integer({ min: -10_000_000_00, max: 10_000_000_00 });
const value = (row: { amount: number }, m: MainAmount) =>
  effectiveMainAmount({ amount: row.amount, ...m });

describe('mainAmountFor', () => {
  it('leaves rows in the budget currency alone', () => {
    fc.assert(
      fc.property(arbAmount, fc.constantFrom(null, 'EUR'), (amount, currency) => {
        expect(mainAmountFor({ amount, date: '2024-01-05', currency }, BUDGET, rates)).toEqual({
          mainAmount: null,
          mainAmountSource: null,
        });
      }),
    );
  });

  it('converts at the day rate, or says the rate is missing (never 1)', () => {
    const at = (amount: number, currency: string) =>
      mainAmountFor({ amount, date: '2024-01-05', currency }, BUDGET, rates);
    expect(at(-10_812, 'USD')).toEqual({ mainAmount: -10_000, mainAmountSource: 'rate' });
    expect(at(-16_137, 'JPY')).toEqual({ mainAmount: -10_000, mainAmountSource: 'rate' });
    expect(at(-500, 'PLN')).toEqual({ mainAmount: null, mainAmountSource: 'missing' });
  });
});

describe('transferMainAmounts', () => {
  it('always adds up to zero in the budget currency, or is missing on both sides', () => {
    fc.assert(
      fc.property(
        arbAmount,
        arbAmount,
        arbCurrency,
        arbCurrency,
        fc.boolean(),
        fc.boolean(),
        (out, inflow, outCurrency, inCurrency, withRates, swap) => {
          const sameCurrency = (outCurrency ?? BUDGET) === (inCurrency ?? BUDGET);
          const a = { amount: -Math.abs(out), date: '2024-01-05', currency: outCurrency };
          // Within one currency the two sides are the same amount
          const b = {
            amount: sameCurrency ? Math.abs(out) : Math.abs(inflow),
            date: '2024-01-06',
            currency: inCurrency,
          };
          const book = withRates ? rates : noRates;
          const [ma, mb] = swap
            ? transferMainAmounts(b, a, BUDGET, book).reverse()
            : transferMainAmounts(a, b, BUDGET, book);
          if (ma.mainAmountSource === 'missing' || mb.mainAmountSource === 'missing') {
            expect(ma.mainAmountSource).toBe('missing');
            expect(mb.mainAmountSource).toBe('missing');
            return;
          }
          expect(value(a, ma) + value(b, mb)).toBe(0);
        },
      ),
    );
  });

  it('takes the value of the side in the budget currency', () => {
    const [eur, usd] = transferMainAmounts(
      { amount: -10_000, date: '2024-01-05', currency: null },
      { amount: 10_900, date: '2024-01-05', currency: 'USD' },
      BUDGET,
      noRates,
    );
    expect(eur).toEqual({ mainAmount: null, mainAmountSource: null });
    expect(usd).toEqual({ mainAmount: 10_000, mainAmountSource: 'transfer' });
  });
});
