import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { expenseFigure, incomeFigure, monthsToAverage } from './reportSummary';
import { formatCurrency } from './currency';

const cents = fc.integer({ min: -100_000_000, max: 100_000_000 });
const month = fc.record({ income: cents, expenses: fc.nat(100_000_000), expenseNet: cents });
const quietMonth = fc.constant({ income: 0, expenses: 0, expenseNet: 0 });

describe('monthsToAverage (property-based)', () => {
  it('counts from the first month with activity to the end of the range', () => {
    fc.assert(
      fc.property(
        fc.array(quietMonth, { maxLength: 12 }),
        fc.array(fc.oneof(month, quietMonth), { maxLength: 24 }),
        (before, after) => {
          const months = [...before, ...after];
          const first = months.findIndex(
            (m) => m.income !== 0 || m.expenses !== 0 || m.expenseNet !== 0,
          );
          const n = monthsToAverage(months);
          expect(n).toBe(first === -1 ? 1 : months.length - first);
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(Math.max(months.length, 1));
        },
      ),
    );
  });

  it('a budget started this month averages over one month, not six', () => {
    const quiet = { income: 0, expenses: 0, expenseNet: 0 };
    const now = { income: 200_000, expenses: 5_250, expenseNet: -5_250 };
    expect(monthsToAverage([quiet, quiet, quiet, quiet, quiet, now])).toBe(1);
  });
});

describe('expenseFigure (property-based)', () => {
  it('shows spending as a plain amount and money back with a plus sign', () => {
    fc.assert(
      fc.property(cents, (net) => {
        const { value, tone } = expenseFigure(net);
        if (net < 0) {
          expect(value).toBe(formatCurrency(-net));
          expect(tone).toBe('negative');
        } else if (net > 0) {
          expect(value).toBe(`+${formatCurrency(net)}`);
          expect(tone).toBe('positive');
        } else {
          expect(tone).toBe('neutral');
        }
        // Never a bare minus sign: spending reads as an amount spent
        expect(value.startsWith('-')).toBe(false);
      }),
    );
  });

  it('a $250 balance correction left as money back reads "+$250", not "$250" spent', () => {
    expect(expenseFigure(25_000)).toEqual({ value: '+$250', tone: 'positive' });
    expect(expenseFigure(-5_250)).toEqual({ value: '$52.50', tone: 'negative' });
  });
});

describe('incomeFigure (property-based)', () => {
  it('keeps the sign and colors it', () => {
    fc.assert(
      fc.property(cents, (c) => {
        const { value, tone } = incomeFigure(c);
        expect(value).toBe(formatCurrency(c));
        expect(tone).toBe(c > 0 ? 'positive' : c < 0 ? 'negative' : 'neutral');
      }),
    );
  });
});
