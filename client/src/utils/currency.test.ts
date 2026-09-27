import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { centsToInput, formatCurrency, parseCents } from './currency';

// Up to ±$100 billion, far beyond any real balance but still exact in a double
const arbCents = fc.integer({ min: -10_000_000_000_00, max: 10_000_000_000_00 });

// Undo formatCurrency's "-$1,234.56" formatting to get cents back
const unformat = (s: string) => {
  const negative = s.startsWith('-');
  const digits = s.replace(/^-/, '').replace('$', '').replace(/,/g, '');
  const cents = Math.round(parseFloat(digits) * 100);
  return negative ? -cents : cents;
};

describe('currency helpers (property-based)', () => {
  it('parseCents(centsToInput(c)) gives back the absolute amount', () => {
    fc.assert(
      fc.property(arbCents, (cents) => {
        expect(parseCents(centsToInput(cents))).toBe(Math.abs(cents));
      }),
    );
  });

  it('parses any "dollars.cc" string to exact integer cents', () => {
    fc.assert(
      fc.property(fc.nat({ max: 100_000_000_000 }), fc.nat({ max: 99 }), (dollars, cc) => {
        const s = `${dollars}.${String(cc).padStart(2, '0')}`;
        expect(parseCents(s)).toBe(dollars * 100 + cc);
      }),
    );
  });

  it('always returns a finite integer, never NaN or a fraction of a cent', () => {
    fc.assert(
      fc.property(
        // Arbitrary text plus number-like strings, including exponents such as "1e400"
        fc.oneof(
          fc.string(),
          fc.double().map(String),
          fc.double().map((d) => d.toExponential()),
        ),
        (s) => {
          expect(Number.isSafeInteger(parseCents(s))).toBe(true);
        },
      ),
    );
  });

  it('formatCurrency round-trips to the same cents, with 0 or 2 decimals', () => {
    fc.assert(
      fc.property(arbCents, (cents) => {
        const s = formatCurrency(cents);
        expect(unformat(s)).toBe(cents);
        expect(s).toMatch(/^-?\$\d{1,3}(,\d{3})*(\.\d{2})?$/);
        expect(s.startsWith('-')).toBe(cents < 0);
      }),
    );
  });
});
