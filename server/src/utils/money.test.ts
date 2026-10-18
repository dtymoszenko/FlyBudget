import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  allocate,
  chainRates,
  convertMinor,
  decimalToMinor,
  formatRate,
  impliedRate,
  invertRate,
  minorToDecimal,
  parseRate,
  type Rate,
} from './money.js';

const arbAmount = fc.integer({ min: -1_000_000_000_00, max: 1_000_000_000_00 });
const arbMinor = fc.constantFrom(0, 2, 3);
// Rates as banks and the ECB write them: up to 6 decimals, from 0.0001 to 20,000
const arbRateText = fc.integer({ min: 1, max: 20_000_000_000 }).map((n) => {
  const s = n.toString().padStart(7, '0');
  return `${s.slice(0, -6)}.${s.slice(-6)}`;
});
const arbRate = arbRateText.map((t) => parseRate(t)!);

/** The exact value as a fraction, for comparing against rounding by hand */
const exact = (amount: number, fromMinor: number, toMinor: number, rate: Rate) => ({
  n: BigInt(amount) * rate.num * 10n ** BigInt(toMinor),
  d: rate.den * 10n ** BigInt(fromMinor),
});

/** Whether the converted amount fits in a safe integer (convertMinor throws otherwise) */
const fits = (amount: number, fromMinor: number, toMinor: number, rate: Rate) => {
  const { n, d } = exact(amount, fromMinor, toMinor, rate);
  const q = n / d;
  return (q < 0n ? -q : q) < BigInt(Number.MAX_SAFE_INTEGER);
};

describe('parseRate', () => {
  it('reads positive decimals exactly and nothing else', () => {
    expect(parseRate('1.0812')).toEqual({ num: 2703n, den: 2500n });
    expect(parseRate('4')).toEqual({ num: 4n, den: 1n });
    for (const bad of ['0', '0.000', '-1.2', '1e3', '', 'abc', '1,2', '1.']) {
      expect(parseRate(bad)).toBeNull();
    }
  });

  it('formats back to the same number', () => {
    fc.assert(
      fc.property(arbRateText, (text) => {
        expect(parseRate(formatRate(parseRate(text)!))).toEqual(parseRate(text));
      }),
    );
  });
});

describe('convertMinor', () => {
  it('is the exact value rounded once, halves away from zero', () => {
    fc.assert(
      fc.property(arbAmount, arbMinor, arbMinor, arbRate, (amount, from, to, rate) => {
        fc.pre(fits(amount, from, to, rate));
        const result = BigInt(convertMinor(amount, from, to, rate));
        const { n, d } = exact(amount, from, to, rate);
        // |result - n/d| <= 1/2, and exactly 1/2 only rounding away from zero
        const diff = result * d - n;
        const twice = 2n * (diff < 0n ? -diff : diff);
        expect(twice <= d).toBe(true);
        if (twice === d) expect(result < 0n === n < 0n || result === 0n).toBe(true);
      }),
    );
  });

  it('converts minus an amount to exactly minus its conversion', () => {
    fc.assert(
      fc.property(arbAmount, arbMinor, arbMinor, arbRate, (amount, from, to, rate) => {
        fc.pre(fits(amount, from, to, rate));
        expect(convertMinor(-amount, from, to, rate)).toBe(
          -convertMinor(amount, from, to, rate) || 0,
        );
      }),
    );
  });

  it('scales between currencies with different decimals', () => {
    // 1,000 JPY at 0.0062 EUR per yen is 6.20 EUR; 12.345 KWD at 3 EUR is 37.04 EUR (37.035)
    expect(convertMinor(1000, 0, 2, parseRate('0.0062')!)).toBe(620);
    expect(convertMinor(12_345, 3, 2, parseRate('3')!)).toBe(3704);
    expect(convertMinor(-12_345, 3, 2, parseRate('3')!)).toBe(-3704);
  });

  it('refuses a result too big to count exactly', () => {
    expect(() => convertMinor(Number.MAX_SAFE_INTEGER, 2, 2, parseRate('2')!)).toThrow(RangeError);
  });

  it('comes back within a unit through a rate and its inverse, when the target is no coarser', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc
          .integer({ min: 5_000, max: 2_000_000 })
          .map((n) =>
            parseRate(`${Math.floor(n / 1_000_000)}.${String(n % 1_000_000).padStart(6, '0')}`)!,
          ),
        (amount, rate) => {
          // To a currency with more units per unit of the original (rate >= 1 is no coarser)
          if (rate.num < rate.den) return;
          const there = convertMinor(amount, 2, 2, rate);
          const back = convertMinor(there, 2, 2, invertRate(rate));
          expect(Math.abs(back - amount)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe('chainRates and impliedRate', () => {
  it('chains like multiplying', () => {
    fc.assert(
      fc.property(arbRate, arbRate, (a, b) => {
        const c = chainRates(a, b);
        expect(c.num * a.den * b.den).toBe(a.num * b.num * c.den);
      }),
    );
  });

  it('gives back the rate two amounts were converted at', () => {
    // 100.00 EUR sent, 108.12 USD arrived
    expect(formatRate(impliedRate(-10_000, 2, 10_812, 2)!)).toBe('1.0812');
    // 10,000 JPY sent, 62.00 EUR arrived
    expect(formatRate(impliedRate(-10_000, 0, 6200, 2)!)).toBe('0.0062');
    expect(impliedRate(0, 2, 5, 2)).toBeNull();
  });
});

describe('decimalToMinor and minorToDecimal', () => {
  it('round-trip every amount in every decimals', () => {
    fc.assert(
      fc.property(arbAmount, arbMinor, (amount, minor) => {
        expect(decimalToMinor(minorToDecimal(amount, minor), minor)).toBe(amount);
      }),
    );
  });

  it('reads bank amounts exactly, rounding extra digits halves away from zero', () => {
    expect(decimalToMinor('12.34', 2)).toBe(1234);
    expect(decimalToMinor('-12.345', 2)).toBe(-1235);
    expect(decimalToMinor('1500', 0)).toBe(1500);
    expect(decimalToMinor('1500.00', 0)).toBe(1500);
    expect(decimalToMinor('0.125', 3)).toBe(125);
    expect(decimalToMinor('7', 3)).toBe(7000);
    expect(decimalToMinor('-0.001', 2)).toBe(0);
    expect(decimalToMinor('1e5', 2)).toBeNull();
    expect(decimalToMinor('99999999999999999999', 2)).toBeNull();
  });
});

describe('allocate', () => {
  it('always adds up to the total, each part within a unit of its share', () => {
    fc.assert(
      fc.property(
        arbAmount,
        fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { minLength: 1, maxLength: 8 }),
        (total, weights) => {
          const parts = allocate(total, weights);
          expect(parts).toHaveLength(weights.length);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          const sum = weights.reduce((a, b) => a + b, 0);
          if (sum === 0) return;
          parts.forEach((p, i) => {
            expect(Math.abs(p - (total * weights[i]) / sum)).toBeLessThan(
              1 + 1e-6 * Math.abs(total),
            );
          });
        },
      ),
    );
  });

  it('splits in proportion', () => {
    expect(allocate(-1000, [-600, -400])).toEqual([-600, -400]);
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(-1084, [-7000, -3000])).toEqual([-759, -325]);
  });
});
