import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { dayRange } from './reports.js';

// yyyy-MM-dd from a UTC day number, independent of the machine's time zone
const ymd = (dayNum: number) => new Date(dayNum * 86_400_000).toISOString().slice(0, 10);
// 1990-01-01 .. 2089-12-31, as days since the epoch
const arbDay = fc.integer({ min: 7305, max: 43829 });

describe('dayRange (property-based)', () => {
  it('lists every day from `from` to `to` exactly once, in order, in any time zone', () => {
    fc.assert(
      fc.property(arbDay, fc.integer({ min: 0, max: 400 }), (start, length) => {
        const days = dayRange(ymd(start), ymd(start + length));
        expect(days).toEqual(Array.from({ length: length + 1 }, (_, i) => ymd(start + i)));
      }),
      { numRuns: 200 },
    );
  });

  it('is empty when `to` is before `from`', () => {
    fc.assert(
      fc.property(arbDay, fc.integer({ min: 1, max: 100 }), (start, back) => {
        expect(dayRange(ymd(start), ymd(start - back))).toEqual([]);
      }),
    );
  });
});
