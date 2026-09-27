import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  addDays,
  differenceInCalendarDays,
  format,
  getDay,
  lastDayOfMonth,
  parseISO,
} from 'date-fns';
import {
  buildRecurrenceRule,
  computeOccurrenceDates,
  type RecurrenceDefinition,
  type RecurrenceRule,
  type RecurrenceType,
  type WeekendAdjust,
} from './recurrence.js';

const EPOCH = new Date(2000, 0, 1);
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

// Any calendar date from 2000 to ~2030, as the app stores them (yyyy-MM-dd).
const arbDate = fc.integer({ min: 0, max: 365 * 30 }).map((n) => iso(addDays(EPOCH, n)));
const arbAdjust = fc.constantFrom<WeekendAdjust>('none', 'before', 'after', 'closest');
const arbType = fc.constantFrom<RecurrenceType>(
  'once',
  'weekly',
  'biweekly',
  'semimonthly',
  'monthly',
  'quarterly',
  'semiannually',
  'yearly',
);

// Rules as the app builds them, plus the custom intervals the rule shape allows.
const arbRule = (type: RecurrenceType, startDate: string): fc.Arbitrary<RecurrenceRule> => {
  const built = buildRecurrenceRule(type, startDate);
  if (built.type === 'weekly' || built.type === 'monthly') {
    return fc.integer({ min: 1, max: 4 }).map((interval) => ({ ...built, interval }));
  }
  if (built.type === 'semimonthly') {
    return fc.oneof(
      fc.constant(built),
      fc
        .tuple(fc.integer({ min: 1, max: 31 }), fc.integer({ min: 1, max: 31 }))
        .filter(([a, b]) => a !== b)
        .map(([day1, day2]) => ({ type: 'semimonthly' as const, day1, day2 })),
    );
  }
  return fc.constant(built);
};

const arbDefinition: fc.Arbitrary<RecurrenceDefinition> = fc
  .record({
    startDate: arbDate,
    recurrenceType: arbType,
    weekendAdjust: arbAdjust,
    // Optional end date: some offset after the start
    endOffset: fc.option(fc.integer({ min: 0, max: 365 * 3 })),
  })
  .chain(({ startDate, recurrenceType, weekendAdjust, endOffset }) =>
    arbRule(recurrenceType, startDate).map((recurrenceRule) => ({
      startDate,
      endDate: endOffset === null ? null : iso(addDays(parseISO(startDate), endOffset)),
      recurrenceType,
      recurrenceRule,
      weekendAdjust,
    })),
  );

// A query window of up to ~2 years that may start before, during, or after the schedule.
const arbRange = fc
  .tuple(arbDate, fc.integer({ min: 0, max: 730 }))
  .map(([from, len]) => [from, iso(addDays(parseISO(from), len))] as const);

const isWeekend = (d: string) => [0, 6].includes(getDay(parseISO(d)));

describe('buildRecurrenceRule (property-based)', () => {
  it('gives semi-monthly schedules two different days, one of them the start day', () => {
    fc.assert(
      fc.property(arbDate, (startDate) => {
        const rule = buildRecurrenceRule('semimonthly', startDate);
        if (rule.type !== 'semimonthly') throw new Error('expected a semimonthly rule');
        expect(rule.day1).not.toBe(rule.day2);
        expect(rule.day1).toBe(parseISO(startDate).getDate());
      }),
    );
  });
});

describe('computeOccurrenceDates (property-based)', () => {
  it('returns strictly increasing, unique scheduled dates', () => {
    fc.assert(
      fc.property(arbDefinition, arbRange, (def, [from, to]) => {
        const dates = computeOccurrenceDates(def, from, to).map((o) => o.scheduledDate);
        for (let i = 1; i < dates.length; i++) {
          expect(dates[i] > dates[i - 1], `${dates[i - 1]} then ${dates[i]}`).toBe(true);
        }
      }),
    );
  });

  it('only returns dates inside the schedule and the requested range', () => {
    fc.assert(
      fc.property(arbDefinition, arbRange, (def, [from, to]) => {
        for (const { scheduledDate } of computeOccurrenceDates(def, from, to)) {
          expect(scheduledDate >= def.startDate).toBe(true);
          expect(scheduledDate >= from).toBe(true);
          expect(scheduledDate <= to).toBe(true);
          if (def.endDate) expect(scheduledDate <= def.endDate).toBe(true);
        }
      }),
    );
  });

  it('moves weekend dates to a weekday in the configured direction, by at most 2 days', () => {
    fc.assert(
      fc.property(arbDefinition, arbRange, (def, [from, to]) => {
        for (const { scheduledDate, expectedDate } of computeOccurrenceDates(def, from, to)) {
          const shift = differenceInCalendarDays(parseISO(expectedDate), parseISO(scheduledDate));
          if (def.weekendAdjust === 'none' || !isWeekend(scheduledDate)) {
            expect(expectedDate).toBe(scheduledDate);
            continue;
          }
          expect(isWeekend(expectedDate)).toBe(false);
          expect(Math.abs(shift)).toBeLessThanOrEqual(2);
          if (def.weekendAdjust === 'before') expect(shift).toBeLessThan(0);
          if (def.weekendAdjust === 'after') expect(shift).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('gives the same occurrences whether a range is queried whole or in two parts', () => {
    fc.assert(
      fc.property(
        arbDefinition,
        arbRange,
        fc.integer({ min: 0, max: 730 }),
        (def, [from, to], splitAt) => {
          const span = differenceInCalendarDays(parseISO(to), parseISO(from));
          const mid = iso(addDays(parseISO(from), Math.min(splitAt, span)));
          const afterMid = iso(addDays(parseISO(mid), 1));
          const whole = computeOccurrenceDates(def, from, to);
          const parts =
            mid >= to
              ? computeOccurrenceDates(def, from, to)
              : [
                  ...computeOccurrenceDates(def, from, mid),
                  ...computeOccurrenceDates(def, afterMid, to),
                ];
          expect(parts).toEqual(whole);
        },
      ),
    );
  });

  it('keeps month-based schedules on the anchor day, clamped to short months', () => {
    const monthSteps = { monthly: 0, quarterly: 3, semiannually: 6, yearly: 12 } as const;
    fc.assert(
      fc.property(arbDefinition, arbRange, (def, [from, to]) => {
        const rule = def.recurrenceRule;
        if (!(rule.type in monthSteps)) return;
        const anchorDay = (rule as { anchorDay: number }).anchorDay;
        const step =
          rule.type === 'monthly'
            ? rule.interval
            : monthSteps[rule.type as keyof typeof monthSteps];
        const dates = computeOccurrenceDates(def, from, to).map((o) => parseISO(o.scheduledDate));
        dates.forEach((d, i) => {
          expect(d.getDate()).toBe(Math.min(anchorDay, lastDayOfMonth(d).getDate()));
          if (i > 0) {
            const prev = dates[i - 1];
            const months =
              (d.getFullYear() - prev.getFullYear()) * 12 + d.getMonth() - prev.getMonth();
            expect(months).toBe(step);
          }
        });
      }),
    );
  });

  it('keeps weekly schedules on the start weekday, a fixed number of weeks apart', () => {
    fc.assert(
      fc.property(arbDefinition, arbRange, (def, [from, to]) => {
        const rule = def.recurrenceRule;
        if (rule.type !== 'weekly' && rule.type !== 'biweekly') return;
        const step = rule.type === 'weekly' ? rule.interval : 2;
        const dates = computeOccurrenceDates(def, from, to).map((o) => parseISO(o.scheduledDate));
        dates.forEach((d, i) => {
          expect(getDay(d)).toBe(getDay(parseISO(def.startDate)));
          if (i > 0) expect(differenceInCalendarDays(d, dates[i - 1])).toBe(7 * step);
        });
      }),
    );
  });
});
