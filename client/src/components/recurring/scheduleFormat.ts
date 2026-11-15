import { formatMoney } from '../../utils/currency';
import { t } from '../../i18n';
import {
  addMonths,
  addYears,
  differenceInCalendarDays,
  endOfMonth,
  parseISO,
  startOfMonth,
} from 'date-fns';
import type { AmountType, RecurrenceType, ScheduleOccurrence } from '../../types';
import type { RecurringBadgeStatus } from './StatusBadge';

export const freqLabel = (type: RecurrenceType) => t(`recurring.freq.${type}`);

/**
 * Actual-style amount: `~` prefix when not exact, `+` prefix for income. In the currency of
 * the schedule's account (null = the budget's).
 */
export function formatScheduleAmount(
  amount: number,
  amountType: AmountType,
  currency: string | null,
): string {
  const approx = amountType !== 'exact' ? '~' : '';
  const sign = amount > 0 ? '+' : '';
  return `${approx}${sign}${formatMoney(Math.abs(amount), currency)}`;
}

// ─── Upcoming length (port of Actual Budget's getUpcomingDays) ───────────────

export const DEFAULT_UPCOMING_LENGTH = '7';

export const UPCOMING_PRESETS = ['1', '7', '14', 'oneMonth', 'currentMonth'] as const;

export const upcomingPresetLabel = (id: (typeof UPCOMING_PRESETS)[number]) =>
  t(`recurring.upcoming.presets.${id}`);

export const isCustomUpcomingLength = (v: string) =>
  !(UPCOMING_PRESETS as readonly string[]).includes(v);

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

const UNITS = ['day', 'week', 'month', 'year'] as const;

export function describeUpcomingLength(length: string): string {
  const preset = UPCOMING_PRESETS.find((p) => p === length);
  if (preset) return upcomingPresetLabel(preset);
  const [num, unit] = length.split('-');
  const count = Math.max(1, parseInt(num, 10) || 1);
  // A unit this version doesn't know reads as days
  const known = UNITS.find((u) => u === unit) ?? 'day';
  return t(`recurring.upcoming.length.${known}`, { count });
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
