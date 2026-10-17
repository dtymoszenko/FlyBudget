// Dates shown to people, in the Date Format preference. Dates stored and sent to the server
// stay `yyyy-MM-dd`; only what's displayed changes.
import { format, parseISO } from 'date-fns';
import { usePreferencesStore, type DateFormatOption } from '../store/preferencesStore';

type DateInput = string | Date;

const toDate = (date: DateInput) => (typeof date === 'string' ? parseISO(date) : date);

const preference = () => usePreferencesStore.getState().dateFormat;

/** Whether the day comes before the month (05/01/2026 is 5 January) */
const dayFirst = (pattern: DateFormatOption) => pattern.startsWith('dd');

/** A full date: "Jan 5, 2026", "05/01/2026", "05.01.2026", "2026-01-05" */
export function formatDay(date: DateInput, pattern: DateFormatOption = preference()): string {
  return format(toDate(date), pattern);
}

/** A full date with the month written out where the format has words: "January 5, 2026" */
export function formatDayLong(date: DateInput, pattern: DateFormatOption = preference()): string {
  return pattern === 'MMM d, yyyy'
    ? format(toDate(date), 'MMMM d, yyyy')
    : formatDay(date, pattern);
}

/** A full date after the weekday: "Mon, Jan 5, 2026" or "Mon, 05.01.2026" (`long`: "Monday, …") */
export function formatWeekday(
  date: DateInput,
  { long = false }: { long?: boolean } = {},
  pattern: DateFormatOption = preference(),
): string {
  const day = long ? formatDayLong(date, pattern) : formatDay(date, pattern);
  return `${format(toDate(date), long ? 'EEEE' : 'EEE')}, ${day}`;
}

/**
 * The date-fns pattern for a day and month: "Jan 5", "5 Jan" where the day comes first, and
 * "5. Jan" with dd.MM.yyyy (as German and other Central European dates write it). `year` adds
 * a short year for chart axes: "Jan 5 '26", "5. Jan '26".
 */
export function shortDayPattern(
  { long = false, year = false }: { long?: boolean; year?: boolean } = {},
  pattern: DateFormatOption = preference(),
): string {
  const month = long ? 'MMMM' : 'MMM';
  const day =
    pattern === 'dd.MM.yyyy' ? `d. ${month}` : dayFirst(pattern) ? `d ${month}` : `${month} d`;
  return year ? `${day} ''yy` : day;
}

/** A day and month without the year: "Jan 5", "5 Jan", or "5. Jan" (see shortDayPattern) */
export function formatShortDay(
  date: DateInput,
  { long = false }: { long?: boolean } = {},
  pattern: DateFormatOption = preference(),
): string {
  return format(toDate(date), shortDayPattern({ long }, pattern));
}
