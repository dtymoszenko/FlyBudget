import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { eachDayOfInterval, endOfMonth, format, getDay, parseISO } from 'date-fns';
import { barShare, heatmapRows, monthWeeks, quantileLevels } from './calendarLayout';
import { monthsBetween } from './dateRange';

const arbMonth = fc
  .record({ y: fc.integer({ min: 1990, max: 2080 }), m: fc.integer({ min: 1, max: 12 }) })
  .map(({ y, m }) => `${y}-${String(m).padStart(2, '0')}`);

const daysOf = (from: string, to: string) =>
  eachDayOfInterval({
    start: parseISO(`${from}-01`),
    end: endOfMonth(parseISO(`${to}-01`)),
  }).map((d) => format(d, 'yyyy-MM-dd'));

const weekday = (day: string) => getDay(parseISO(day));

describe('monthWeeks (property-based)', () => {
  it('lists every day of the month once, in order, under its weekday', () => {
    fc.assert(
      fc.property(arbMonth, (month) => {
        const weeks = monthWeeks(month);
        expect(weeks.every((w) => w.length === 7)).toBe(true);
        expect(weeks.length).toBeGreaterThanOrEqual(4);
        expect(weeks.length).toBeLessThanOrEqual(6);
        const flat = weeks.flat();
        expect(flat.filter(Boolean)).toEqual(daysOf(month, month));
        flat.forEach((d, i) => d && expect(weekday(d)).toBe(i % 7));
        // No empty first or last week
        expect(weeks[0].some(Boolean) && weeks[weeks.length - 1].some(Boolean)).toBe(true);
      }),
    );
  });
});

describe('heatmapRows (property-based)', () => {
  const arbRange = fc.tuple(arbMonth, fc.integer({ min: 0, max: 40 })).map(([from, extra]) => {
    const months = monthsBetween(from, '2099-12').slice(0, extra + 1);
    return { from, to: months[months.length - 1] };
  });

  it('covers every day in the range once, in order, each under its weekday', () => {
    fc.assert(
      fc.property(arbRange, fc.integer({ min: 1, max: 12 }), ({ from, to }, perRow) => {
        const rows = heatmapRows(from, to, perRow);
        const flat = rows.flatMap((r) => r.weeks.flat());
        expect(flat.filter(Boolean)).toEqual(daysOf(from, to));
        for (const r of rows) {
          expect(r.weeks.every((w) => w.length === 7)).toBe(true);
          r.weeks.forEach((w) => w.forEach((d, i) => d && expect(weekday(d)).toBe(i)));
          expect(r.months.length).toBeLessThanOrEqual(perRow);
          // Each month label sits over the column holding that month's first day
          for (const { month, column } of r.months)
            expect(r.weeks[column]).toContain(`${month}-01`);
        }
      }),
    );
  });
});

describe('quantileLevels (property-based)', () => {
  const values = fc.array(fc.integer({ min: -1000, max: 100_000 }), { maxLength: 60 });

  it('gives positive values a level from 1 to `levels`, and never a lower level to a bigger value', () => {
    fc.assert(
      fc.property(values, fc.integer({ min: 1, max: 6 }), (vs, levels) => {
        const level = quantileLevels(vs, levels);
        const sorted = [...vs].sort((a, b) => a - b);
        for (const v of sorted) {
          const l = level(v);
          if (v <= 0) expect(l).toBe(0);
          else expect(l >= 1 && l <= levels).toBe(true);
        }
        for (let i = 1; i < sorted.length; i++) {
          expect(level(sorted[i])).toBeGreaterThanOrEqual(level(sorted[i - 1]));
        }
      }),
    );
  });
});

describe('barShare (property-based)', () => {
  it('stays within 0-1, is 1 at the max, and grows with the value', () => {
    fc.assert(
      fc.property(fc.nat(1_000_000), fc.nat(1_000_000), fc.nat(1_000_000), (a, b, max) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(barShare(lo, max)).toBeGreaterThanOrEqual(0);
        expect(barShare(hi, max)).toBeLessThanOrEqual(1);
        expect(barShare(hi, max)).toBeGreaterThanOrEqual(barShare(lo, max));
        if (max > 0) expect(barShare(max, max)).toBe(1);
      }),
    );
  });
});
