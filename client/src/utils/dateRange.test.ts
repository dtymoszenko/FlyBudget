import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { format } from 'date-fns';
import {
  DATE_PRESETS,
  computeDateRange,
  freezeDateRange,
  decodeRangeParam,
  encodeRangeParam,
  resolveDateRange,
  widgetDateRange,
  monthCount,
  monthsBetween,
  dayBounds,
} from './dateRange';
import type { DatePresetCustom, ReportDateRange } from '../types';

// "All" starts at 2020-01, so "today" is always after that
const arbNow = fc.date({
  min: new Date('2020-02-01'),
  max: new Date('2100-12-31'),
  noInvalidDate: true,
});
const livePresets = DATE_PRESETS.map((p) => p.id).filter((p) => p !== 'custom');
const arbLive = fc.constantFrom(...livePresets);
const arbMonth = fc
  .record({ year: fc.integer({ min: 2000, max: 2100 }), month: fc.integer({ min: 1, max: 12 }) })
  .map(({ year, month }) => `${year}-${String(month).padStart(2, '0')}`);
const arbFrozen: fc.Arbitrary<ReportDateRange> = fc
  .tuple(arbMonth, arbMonth)
  .map(([a, b]) => ({ preset: 'custom', from: a < b ? a : b, to: a < b ? b : a }));

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

describe('date range helpers (property-based)', () => {
  it('live presets give valid yyyy-MM ranges with from <= to', () => {
    fc.assert(
      fc.property(arbLive, arbNow, (preset, now) => {
        const { from, to } = computeDateRange(preset, now);
        expect(from).toMatch(MONTH);
        expect(to).toMatch(MONTH);
        expect(from <= to).toBe(true);
      }),
    );
  });

  it('live presets other than last year end in the current month', () => {
    fc.assert(
      fc.property(arbLive, arbNow, (preset, now) => {
        fc.pre(preset !== 'last-year');
        expect(computeDateRange(preset, now).to).toBe(format(now, 'yyyy-MM'));
      }),
    );
  });

  it('frozen ranges never change, whatever today is', () => {
    fc.assert(
      fc.property(arbFrozen, arbNow, (range, now) => {
        expect(resolveDateRange(range, now)).toEqual(range);
      }),
    );
  });

  it('freezing keeps the months the range covers today', () => {
    fc.assert(
      fc.property(arbLive, arbNow, (preset: DatePresetCustom, now) => {
        const live = { preset, from: '2000-01', to: '2000-01' };
        const frozen = freezeDateRange(live, now);
        expect(frozen.preset).toBe('custom');
        expect({ from: frozen.from, to: frozen.to }).toEqual(computeDateRange(preset, now));
      }),
    );
  });

  it('widgets without their own range follow the dashboard', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          arbFrozen,
          arbLive.map((preset) => ({ preset, from: '2020-01', to: '2020-01' })),
        ),
        (dashboard) => {
          expect(widgetDateRange(undefined, dashboard)).toEqual({
            range: resolveDateRange(dashboard),
            source: 'dashboard',
          });
        },
      ),
    );
  });

  it("a widget's own frozen range ignores the dashboard", () => {
    fc.assert(
      fc.property(arbFrozen, arbFrozen, (own, dashboard) => {
        expect(widgetDateRange(own, dashboard)).toEqual({ range: own, source: 'frozen' });
      }),
    );
  });

  it('ranges survive a round trip through the URL', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          arbFrozen,
          arbLive.map((preset) => ({ preset, ...computeDateRange(preset) })),
        ),
        (range) => {
          expect(decodeRangeParam(encodeRangeParam(range))).toEqual(range);
        },
      ),
    );
  });

  it('rejects malformed range parameters', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (junk) => {
        const decoded = decodeRangeParam(junk);
        if (decoded) expect(decoded.from <= decoded.to).toBe(true);
      }),
    );
    for (const bad of ['2025-13..2025-12', '2025-06..2025-01', 'custom', '6months', '']) {
      expect(decodeRangeParam(bad)).toBeUndefined();
    }
  });

  it('live ranges saved long ago are recomputed from today', () => {
    fc.assert(
      fc.property(arbLive, arbNow, (preset, now) => {
        const stale = { preset, from: '1999-01', to: '1999-06' };
        expect(resolveDateRange(stale, now)).toEqual({ preset, ...computeDateRange(preset, now) });
      }),
    );
  });
});

describe('short-range helpers (property-based)', () => {
  // Months from 2000-01 to 2099-12 as an index
  const arbMonthIndex = fc.integer({ min: 0, max: 1199 });
  const ym = (i: number) => `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

  it('monthsBetween lists each month once, in order, and monthCount matches', () => {
    fc.assert(
      fc.property(arbMonthIndex, fc.integer({ min: 0, max: 60 }), (start, length) => {
        const months = monthsBetween(ym(start), ym(start + length));
        expect(months).toEqual(Array.from({ length: length + 1 }, (_, i) => ym(start + i)));
        expect(monthCount(ym(start), ym(start + length))).toBe(length + 1);
      }),
    );
  });

  it('monthCount is 0 for a backwards range', () => {
    fc.assert(
      fc.property(arbMonthIndex, fc.integer({ min: 1, max: 60 }), (start, back) => {
        expect(monthCount(ym(start), ym(start - back))).toBe(0);
      }),
    );
  });

  it('dayBounds runs from the first day to the last day, or today if earlier', () => {
    fc.assert(
      fc.property(
        arbMonthIndex,
        fc.integer({ min: 0, max: 3 }),
        fc.date({ min: new Date(2000, 0, 1), max: new Date(2099, 11, 31), noInvalidDate: true }),
        (start, length, now) => {
          const from = ym(start);
          const to = ym(start + length);
          const b = dayBounds(from, to, now);
          expect(b.from).toBe(`${from}-01`);
          const today = format(now, 'yyyy-MM-dd');
          expect(b.to <= today).toBe(true);
          expect(b.to.slice(0, 7) <= to).toBe(true);
          // It stops early only at today; otherwise it's the last day of `to`
          if (b.to !== today)
            expect(
              format(new Date(`${b.to}T00:00:00`).getTime() + 86_400_000, 'yyyy-MM') > to,
            ).toBe(true);
        },
      ),
    );
  });
});
