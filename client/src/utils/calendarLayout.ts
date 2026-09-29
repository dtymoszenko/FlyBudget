import {
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  parseISO,
  startOfWeek,
} from 'date-fns';
import { monthsBetween } from './dateRange';

// Layout for the transaction calendar. Weeks start on Sunday; days are yyyy-MM-dd strings.

/** Ranges up to this many months show as month grids; longer ones as a heatmap. */
export const CALENDAR_MONTHS_MAX = 3;
/** Months per heatmap row */
export const HEATMAP_ROW_MONTHS = 12;

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

/** The weeks of `month` (yyyy-MM): 7 slots each, the date or null outside the month. */
export function monthWeeks(month: string): (string | null)[][] {
  const first = parseISO(`${month}-01`);
  const weeks: (string | null)[][] = [];
  let week: (string | null)[] = Array(getDay(first)).fill(null);
  for (const d of eachDayOfInterval({ start: first, end: endOfMonth(first) })) {
    week.push(ymd(d));
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push([...week, ...Array(7 - week.length).fill(null)]);
  return weeks;
}

export interface HeatmapRow {
  /** Columns, one per week: 7 slots (Sunday first), the date or null outside this row */
  weeks: (string | null)[][];
  /** Each month (yyyy-MM) and the column its first day falls in */
  months: { month: string; column: number }[];
}

/** The months from `from` to `to` (yyyy-MM) in rows of up to `perRow`, each a grid of weeks. */
export function heatmapRows(from: string, to: string, perRow = HEATMAP_ROW_MONTHS): HeatmapRow[] {
  const all = monthsBetween(from, to);
  const rows: HeatmapRow[] = [];
  for (let i = 0; i < all.length; i += perRow) {
    const months = all.slice(i, i + perRow);
    const start = parseISO(`${months[0]}-01`);
    const end = endOfMonth(parseISO(`${months[months.length - 1]}-01`));
    const gridStart = startOfWeek(start);
    const columns = Math.floor(differenceInCalendarDays(end, gridStart) / 7) + 1;
    const weeks: (string | null)[][] = Array.from({ length: columns }, () => Array(7).fill(null));
    const columnOf = (d: Date) => Math.floor(differenceInCalendarDays(d, gridStart) / 7);
    for (const d of eachDayOfInterval({ start, end })) weeks[columnOf(d)][getDay(d)] = ymd(d);
    rows.push({
      weeks,
      months: months.map((month) => ({ month, column: columnOf(parseISO(`${month}-01`)) })),
    });
  }
  return rows;
}

/**
 * A function giving each value a level from 1 to `levels` by where it falls among `values`
 * (quartiles for 4), so a few very large days don't wash the rest out. Zero and below are 0.
 */
export function quantileLevels(values: number[], levels = 4): (value: number) => number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  const cuts = Array.from(
    { length: levels - 1 },
    (_, i) => sorted[Math.floor(((i + 1) / levels) * sorted.length)] ?? Infinity,
  );
  return (value) => (value > 0 ? 1 + cuts.filter((c) => value > c).length : 0);
}

/**
 * How much of its half of a day cell a bar fills (0-1). Square root, so a $5 coffee still shows
 * next to a paycheck; the exact amounts are in the tooltip.
 */
export const barShare = (value: number, max: number) =>
  max > 0 && value > 0 ? Math.min(1, Math.sqrt(value / max)) : 0;
