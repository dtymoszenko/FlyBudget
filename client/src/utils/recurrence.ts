import {
  addWeeks,
  addDays,
  parseISO,
  format,
  isBefore,
  isAfter,
  min as minDate,
  lastDayOfMonth,
  getDay,
} from 'date-fns';

export type RecurrenceType =
  | 'once'
  | 'weekly'
  | 'biweekly'
  | 'semimonthly'
  | 'monthly'
  | 'quarterly'
  | 'semiannually'
  | 'yearly';
export type WeekendAdjust = 'none' | 'before' | 'after' | 'closest';
export type AmountType = 'exact' | 'approximate' | 'variable';

export type RecurrenceRule =
  | { type: 'once' }
  | { type: 'weekly'; interval: number; anchorDay: number }
  | { type: 'biweekly'; anchorDay: number }
  | { type: 'semimonthly'; day1: number; day2: number }
  | { type: 'monthly'; interval: number; anchorDay: number }
  | { type: 'quarterly'; anchorDay: number }
  | { type: 'semiannually'; anchorDay: number }
  | { type: 'yearly'; anchorMonth: number; anchorDay: number };

export interface RecurrenceDefinition {
  startDate: string;
  endDate: string | null;
  recurrenceType: RecurrenceType;
  recurrenceRule: RecurrenceRule;
  weekendAdjust: WeekendAdjust;
}

export interface OccurrenceDatePair {
  scheduledDate: string;
  expectedDate: string;
}

export function buildRecurrenceRule(
  recurrenceType: RecurrenceType,
  startDate: string,
): RecurrenceRule {
  const d = parseISO(startDate);
  const dayOfMonth = d.getDate();
  const dayOfWeek = getDay(d);
  const month = d.getMonth();

  switch (recurrenceType) {
    case 'once':
      return { type: 'once' };
    case 'weekly':
      return { type: 'weekly', interval: 1, anchorDay: dayOfWeek };
    case 'biweekly':
      return { type: 'biweekly', anchorDay: dayOfWeek };
    case 'semimonthly':
      return { type: 'semimonthly', day1: dayOfMonth, day2: semimonthlyPairDay(dayOfMonth) };
    case 'monthly':
      return { type: 'monthly', interval: 1, anchorDay: dayOfMonth };
    case 'quarterly':
      return { type: 'quarterly', anchorDay: dayOfMonth };
    case 'semiannually':
      return { type: 'semiannually', anchorDay: dayOfMonth };
    case 'yearly':
      return { type: 'yearly', anchorMonth: month, anchorDay: dayOfMonth };
  }
}

// The second day of a semi-monthly schedule. Must differ from the start day, or
// the schedule collapses to monthly: the 15th pairs with month-end (31, clamped),
// the 28th with the 13th.
function semimonthlyPairDay(dayOfMonth: number): number {
  if (dayOfMonth < 15) return 15;
  if (dayOfMonth === 15) return 31;
  if (dayOfMonth === 28) return 13;
  return 28;
}

function clampDay(year: number, month: number, day: number): Date {
  const last = lastDayOfMonth(new Date(year, month, 1));
  const clamped = Math.min(day, last.getDate());
  return new Date(year, month, clamped);
}

function adjustForWeekend(date: Date, adjust: WeekendAdjust): Date {
  if (adjust === 'none') return date;
  const dow = getDay(date);
  if (dow !== 0 && dow !== 6) return date;

  switch (adjust) {
    case 'before':
      return dow === 6 ? addDays(date, -1) : addDays(date, -2);
    case 'after':
      return dow === 6 ? addDays(date, 2) : addDays(date, 1);
    case 'closest':
      return dow === 6 ? addDays(date, -1) : addDays(date, 1);
    default:
      return date;
  }
}

function formatDate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function stepMonthlyAnchored(
  startDate: Date,
  anchorDay: number,
  monthStep: number,
  rangeStart: Date,
  rangeEnd: Date,
  endDate: Date | null,
  weekendAdjust: WeekendAdjust,
): OccurrenceDatePair[] {
  const results: OccurrenceDatePair[] = [];
  const effectiveEnd = endDate ? minDate([rangeEnd, endDate]) : rangeEnd;
  let year = startDate.getFullYear();
  let month = startDate.getMonth();

  if (isBefore(startDate, rangeStart)) {
    const monthsDiff = (rangeStart.getFullYear() - year) * 12 + (rangeStart.getMonth() - month);
    const skip = Math.floor(monthsDiff / monthStep) * monthStep;
    if (skip > 0) {
      month += skip;
      year += Math.floor(month / 12);
      month = month % 12;
    }
  }

  const MAX_ITERATIONS = 5000;
  let iterations = 0;
  while (iterations++ < MAX_ITERATIONS) {
    const nominal = clampDay(year, month, anchorDay);
    if (isAfter(nominal, effectiveEnd)) break;
    if (!isBefore(nominal, startDate) && !isBefore(nominal, rangeStart)) {
      const adjusted = adjustForWeekend(nominal, weekendAdjust);
      results.push({ scheduledDate: formatDate(nominal), expectedDate: formatDate(adjusted) });
    }
    month += monthStep;
    if (month > 11) {
      year += Math.floor(month / 12);
      month = month % 12;
    }
  }
  return results;
}

export function computeOccurrenceDates(
  def: RecurrenceDefinition,
  rangeStart: string,
  rangeEnd: string,
): OccurrenceDatePair[] {
  const start = parseISO(def.startDate);
  const rStart = parseISO(rangeStart);
  const rEnd = parseISO(rangeEnd);
  const end = def.endDate ? parseISO(def.endDate) : null;
  const effectiveEnd = end ? minDate([rEnd, end]) : rEnd;
  const rule = def.recurrenceRule;

  if (isAfter(start, effectiveEnd)) return [];

  switch (rule.type) {
    case 'once': {
      if (!isBefore(start, rStart) || formatDate(start) === formatDate(rStart)) {
        if (!isAfter(start, effectiveEnd)) {
          const adjusted = adjustForWeekend(start, def.weekendAdjust);
          return [{ scheduledDate: formatDate(start), expectedDate: formatDate(adjusted) }];
        }
      }
      if (!isBefore(start, rStart)) {
        const adjusted = adjustForWeekend(start, def.weekendAdjust);
        return [{ scheduledDate: formatDate(start), expectedDate: formatDate(adjusted) }];
      }
      return [];
    }

    case 'weekly':
    case 'biweekly': {
      const step =
        rule.type === 'weekly'
          ? (rule as { type: 'weekly'; interval: number; anchorDay: number }).interval
          : 2;
      const results: OccurrenceDatePair[] = [];
      let current = start;
      if (isBefore(current, rStart)) {
        const diffMs = rStart.getTime() - current.getTime();
        const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
        const skipWeeks = Math.floor(diffWeeks / step) * step;
        if (skipWeeks > 0) current = addWeeks(current, skipWeeks);
      }
      while (!isAfter(current, effectiveEnd)) {
        if (!isBefore(current, rStart)) {
          const adjusted = adjustForWeekend(current, def.weekendAdjust);
          results.push({ scheduledDate: formatDate(current), expectedDate: formatDate(adjusted) });
        }
        current = addWeeks(current, step);
      }
      return results;
    }

    case 'semimonthly': {
      const { day1, day2 } = rule;
      const results: OccurrenceDatePair[] = [];
      let year = start.getFullYear();
      let month = start.getMonth();

      if (isBefore(start, rStart)) {
        const monthsDiff = (rStart.getFullYear() - year) * 12 + (rStart.getMonth() - month);
        if (monthsDiff > 1) {
          month += monthsDiff - 1;
          year += Math.floor(month / 12);
          month = month % 12;
        }
      }

      const MAX_ITERATIONS = 5000;
      let iterations = 0;
      while (iterations++ < MAX_ITERATIONS) {
        const d1 = clampDay(year, month, day1);
        const d2 = clampDay(year, month, day2);
        const dates = day1 <= day2 ? [d1, d2] : [d2, d1];
        // Both days can clamp to the same date in short months (e.g. 29th & 30th in February)
        if (dates[0].getTime() === dates[1].getTime()) dates.pop();
        let allPast = true;
        for (const d of dates) {
          if (isAfter(d, effectiveEnd)) return results;
          if (isBefore(d, start)) continue;
          if (!isBefore(d, rStart)) {
            const adjusted = adjustForWeekend(d, def.weekendAdjust);
            results.push({ scheduledDate: formatDate(d), expectedDate: formatDate(adjusted) });
          }
          if (!isAfter(d, effectiveEnd)) allPast = false;
        }
        if (allPast && isAfter(d1, effectiveEnd)) break;
        month++;
        if (month > 11) {
          month = 0;
          year++;
        }
      }
      return results;
    }

    case 'monthly':
      return stepMonthlyAnchored(
        start,
        rule.anchorDay,
        rule.interval,
        rStart,
        rEnd,
        end,
        def.weekendAdjust,
      );
    case 'quarterly':
      return stepMonthlyAnchored(start, rule.anchorDay, 3, rStart, rEnd, end, def.weekendAdjust);
    case 'semiannually':
      return stepMonthlyAnchored(start, rule.anchorDay, 6, rStart, rEnd, end, def.weekendAdjust);
    case 'yearly':
      return stepMonthlyAnchored(start, rule.anchorDay, 12, rStart, rEnd, end, def.weekendAdjust);
  }
}
