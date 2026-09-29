import {
  addMonths,
  endOfMonth,
  format,
  parseISO,
  startOfYear,
  endOfYear,
  subMonths,
  subYears,
} from 'date-fns';
import type { DatePresetCustom, ReportDateRange } from '../types';

/** Live presets roll forward with today; 'custom' is a frozen range with fixed dates. */
export const DATE_PRESETS: { id: DatePresetCustom; label: string; long: string }[] = [
  { id: '1m', label: '1M', long: 'This month' },
  { id: '3m', label: '3M', long: 'Last 3 months' },
  { id: '6m', label: '6M', long: 'Last 6 months' },
  { id: '12m', label: '12M', long: 'Last 12 months' },
  { id: 'ytd', label: 'YTD', long: 'Year to date' },
  { id: 'last-year', label: 'Last Year', long: 'Last year' },
  { id: 'all', label: 'All', long: 'All time' },
  { id: 'custom', label: 'Custom', long: 'Custom' },
];

export function computeDateRange(
  preset: DatePresetCustom,
  now: Date = new Date(),
): { from: string; to: string } {
  const to = format(now, 'yyyy-MM');
  switch (preset) {
    case '1m':
      return { from: to, to };
    case '3m':
      return { from: format(subMonths(now, 2), 'yyyy-MM'), to };
    case '12m':
      return { from: format(subMonths(now, 11), 'yyyy-MM'), to };
    case 'ytd':
      return { from: format(startOfYear(now), 'yyyy-MM'), to };
    case 'last-year':
      return {
        from: format(startOfYear(subYears(now, 1)), 'yyyy-MM'),
        to: format(endOfYear(subYears(now, 1)), 'yyyy-MM'),
      };
    case 'all':
      return { from: '2020-01', to };
    default:
      return { from: format(subMonths(now, 5), 'yyyy-MM'), to };
  }
}

export const isFrozen = (range: ReportDateRange) => range.preset === 'custom';

/** The months a saved range covers today: live presets are recomputed, frozen ones kept. */
export function resolveDateRange(range: ReportDateRange, now: Date = new Date()): ReportDateRange {
  if (isFrozen(range)) return range;
  return { preset: range.preset, ...computeDateRange(range.preset, now) };
}

/** Pins a range to the months it currently covers. */
export const freezeDateRange = (
  range: ReportDateRange,
  now: Date = new Date(),
): ReportDateRange => ({
  ...resolveDateRange(range, now),
  preset: 'custom',
});

/** What a dashboard shows when its range was never changed. */
const DEFAULT_DASHBOARD_RANGE: ReportDateRange = { preset: '6m', ...computeDateRange('6m') };

export const dashboardDateRange = (page: { dateRange: ReportDateRange | null } | undefined) =>
  resolveDateRange(page?.dateRange ?? DEFAULT_DASHBOARD_RANGE);

/**
 * Where a widget's months come from: its dashboard (no range of its own), its own live
 * range, or its own frozen months.
 */
export type RangeSource = 'dashboard' | 'own' | 'frozen';

export function widgetDateRange(
  own: ReportDateRange | undefined,
  dashboard: ReportDateRange,
): { range: ReportDateRange; source: RangeSource } {
  if (!own) return { range: resolveDateRange(dashboard), source: 'dashboard' };
  return { range: resolveDateRange(own), source: isFrozen(own) ? 'frozen' : 'own' };
}

// A range as a URL parameter, e.g. "6m" (live) or "2025-01..2025-12" (frozen), so a
// dashboard can open the report builder showing the same months as its widget.
export function encodeRangeParam(range: ReportDateRange): string {
  return isFrozen(range) ? `${range.from}..${range.to}` : range.preset;
}

export function decodeRangeParam(param: string | null): ReportDateRange | undefined {
  if (!param) return undefined;
  const fixed = /^(\d{4}-(?:0[1-9]|1[0-2]))\.\.(\d{4}-(?:0[1-9]|1[0-2]))$/.exec(param);
  if (fixed) {
    const [, from, to] = fixed;
    return from <= to ? { preset: 'custom', from, to } : undefined;
  }
  const preset = DATE_PRESETS.find((p) => p.id === param && p.id !== 'custom');
  return preset && { preset: preset.id, ...computeDateRange(preset.id) };
}

const fmtMonth = (m: string) => format(parseISO(`${m}-01`), 'MMM yyyy');

export function formatDateRange(range: ReportDateRange): string {
  if (!isFrozen(range)) return DATE_PRESETS.find((p) => p.id === range.preset)?.long ?? '';
  return range.from === range.to
    ? fmtMonth(range.from)
    : `${fmtMonth(range.from)} – ${fmtMonth(range.to)}`;
}

/** Month ranges up to this long plot a point per day instead of per month. */
export const DAILY_MAX_MONTHS = 3;

/** How many months a yyyy-MM range covers (0 when `to` is before `from`). */
export function monthCount(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return Math.max(0, ty * 12 + tm - (fy * 12 + fm) + 1);
}

/** Every month (yyyy-MM) from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const start = parseISO(`${from}-01`);
  return Array.from({ length: monthCount(from, to) }, (_, i) =>
    format(addMonths(start, i), 'yyyy-MM'),
  );
}

/**
 * The days (yyyy-MM-dd) a yyyy-MM range covers so far: its first day to its last, or to today
 * if that's earlier. `to` is before `from` when the range hasn't started yet.
 */
export function dayBounds(
  from: string,
  to: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const last = format(endOfMonth(parseISO(`${to}-01`)), 'yyyy-MM-dd');
  const today = format(now, 'yyyy-MM-dd');
  return { from: `${from}-01`, to: today < last ? today : last };
}
