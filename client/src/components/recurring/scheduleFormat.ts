import { formatCurrency } from '../../utils/currency';
import {
  addMonths,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  parseISO,
  startOfMonth,
} from 'date-fns';
import { RECURRENCE_TYPE_LABELS, type AmountType, type ScheduleOccurrence } from '../../types';
import type { RecurringBadgeStatus } from './StatusBadge';

export const FREQ_LABEL = new Map(RECURRENCE_TYPE_LABELS.map((f) => [f.value, f.label]));

/** Actual-style amount: `~` prefix when not exact, `+` prefix for income. */
export function formatScheduleAmount(amount: number, amountType: AmountType): string {
  const approx = amountType !== 'exact' ? '~' : '';
  const sign = amount > 0 ? '+' : '';
  return `${approx}${sign}${formatCurrency(Math.abs(amount))}`;
}

// ─── Upcoming length (port of Actual Budget's getUpcomingDays) ───────────────

export const DEFAULT_UPCOMING_LENGTH = '7';

export const UPCOMING_PRESETS: { value: string; label: string }[] = [
  { value: '1', label: '1 day' },
  { value: '7', label: '1 week' },
  { value: '14', label: '2 weeks' },
  { value: 'oneMonth', label: '1 month' },
  { value: 'currentMonth', label: 'End of the current month' },
];

export const isCustomUpcomingLength = (v: string) => !UPCOMING_PRESETS.some((p) => p.value === v);

/** Number of days after today that still count as "upcoming". */
export function getUpcomingDays(
  length: string = DEFAULT_UPCOMING_LENGTH,
  today = new Date(),
): number {
  switch (length) {
    case 'currentMonth':
      return differenceInCalendarDays(endOfMonth(today), today);
    case 'oneMonth':
      return differenceInCalendarDays(addMonths(startOfMonth(today), 1), startOfMonth(today));
    default: {
      if (length.includes('-')) {
        const [num, unit] = length.split('-');
        const value = Math.max(1, parseInt(num, 10) || 1);
        switch (unit) {
          case 'day':
            return value;
          case 'week':
            return value * 7;
          case 'month':
            return differenceInCalendarDays(addMonths(today, value), today);
          case 'year':
            return differenceInCalendarDays(addYears(today, value), today);
        }
      }
      return parseInt(length, 10) || 7;
    }
  }
}

export function describeUpcomingLength(length: string): string {
  const preset = UPCOMING_PRESETS.find((p) => p.value === length);
  if (preset) return preset.label;
  const [num, unit] = length.split('-');
  const n = Math.max(1, parseInt(num, 10) || 1);
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * Badge status for an occurrence, following Actual's getStatus(): pending dates
 * beyond the upcoming window show as "Scheduled" instead of "Upcoming".
 */
export function occurrenceBadgeStatus(
  occ: ScheduleOccurrence,
  upcomingDays: number,
): RecurringBadgeStatus {
  if (
    occ.displayStatus === 'upcoming' &&
    differenceInCalendarDays(parseISO(occ.expectedDate), new Date()) > upcomingDays
  )
    return 'scheduled';
  return occ.displayStatus;
}
