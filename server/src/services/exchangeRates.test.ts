import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { addDays, format } from 'date-fns';
import { buildRateBook, RATE_MAX_AGE_DAYS, type StoredRate } from './exchangeRates.js';
import { formatRate } from '../utils/money.js';

const EPOCH = new Date(2024, 0, 1);
const day = (n: number) => format(addDays(EPOCH, n), 'yyyy-MM-dd');
const CURRENCIES = ['EUR', 'USD', 'PLN', 'JPY'];

const arbStored = fc.record({
  date: fc.integer({ min: 0, max: 120 }).map(day),
  base: fc.constantFrom('EUR', 'USD', 'PLN'),
  quote: fc.constantFrom(...CURRENCIES),
  rate: fc
    .integer({ min: 1, max: 5_000_000 })
    .map((n) => `${Math.floor(n / 10_000)}.${String(n % 10_000).padStart(4, '0')}`),
  source: fc.constantFrom('ecb', 'manual'),
});

describe('buildRateBook', () => {
  it('never uses a rate from after the day, or older than the limit', () => {
    fc.assert(
      fc.property(
        fc.array(arbStored, { maxLength: 40 }),
        fc.constantFrom(...CURRENCIES),
        fc.constantFrom(...CURRENCIES),
        fc.integer({ min: 0, max: 160 }).map(day),
        (rows, from, to, date) => {
          const found = buildRateBook(rows).find(from, to, date);
          if (!found || found.via === 'same') return;
          expect(found.date <= date).toBe(true);
          const age = (Date.parse(date) - Date.parse(found.date)) / 86_400_000;
          expect(age).toBeLessThanOrEqual(RATE_MAX_AGE_DAYS);
        },
      ),
    );
  });

  it('finds the same day whatever order the rates were stored in', () => {
    fc.assert(
      fc.property(
        fc
          .array(arbStored, { maxLength: 30 })
          .chain((rows) =>
            fc.tuple(fc.constant(rows), fc.shuffledSubarray(rows, { minLength: rows.length })),
          ),
        fc.integer({ min: 0, max: 130 }).map(day),
        ([rows, shuffled], date) => {
          const a = buildRateBook(rows);
          const b = buildRateBook(shuffled);
          for (const from of CURRENCIES) {
            for (const to of CURRENCIES) {
              expect(a.find(from, to, date)?.date).toBe(b.find(from, to, date)?.date);
            }
          }
        },
      ),
    );
  });

  it('uses the closest earlier day, a manual rate over the ECB, the inverse, and the euro in between', () => {
    const rows: StoredRate[] = [
      { date: '2024-03-01', base: 'EUR', quote: 'USD', rate: '1.08', source: 'ecb' },
      { date: '2024-03-01', base: 'EUR', quote: 'USD', rate: '1.10', source: 'manual' },
      { date: '2024-03-04', base: 'EUR', quote: 'PLN', rate: '4.32', source: 'ecb' },
      { date: '2024-02-01', base: 'EUR', quote: 'JPY', rate: '160', source: 'ecb' },
    ];
    const book = buildRateBook(rows);
    expect(formatRate(book.find('EUR', 'USD', '2024-03-02')!.rate)).toBe('1.1');
    expect(book.find('EUR', 'USD', '2024-02-29')).toBeNull();
    expect(formatRate(book.find('USD', 'EUR', '2024-03-05')!.rate)).toBe('0.909091');
    const usdPln = book.find('USD', 'PLN', '2024-03-05')!;
    expect(usdPln.via).toBe('eur');
    expect(usdPln.date).toBe('2024-03-01');
    expect(formatRate(usdPln.rate)).toBe('3.927273');
    // A rate over a month old isn't used
    expect(book.find('EUR', 'JPY', '2024-03-05')).toBeNull();
    expect(book.find('PLN', 'PLN', '2024-03-05')!.via).toBe('same');
  });
});
