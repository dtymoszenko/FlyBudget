import { format, parseISO, startOfYear, endOfYear, subMonths, subYears } from 'date-fns';
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

const monthSpan = (r: { from: string; to: string }) => {
  const [fy, fm] = r.from.split('-').map(Number);
  const [ty, tm] = r.to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
};

/**
 * Turns a frozen range back into a live one: the live preset covering exactly the same
 * months today if there is one (so unfreezing a fresh freeze changes nothing), otherwise
 * the rolling window closest in length.
 */
export function unfreezeDateRange(range: ReportDateRange, now: Date = new Date()): ReportDateRange {
  if (!isFrozen(range)) return range;
  const live = DATE_PRESETS.map((p) => p.id).filter((p) => p !== 'custom');
  const exact = live.find((p) => {
    const r = computeDateRange(p, now);
    return r.from === range.from && r.to === range.to;
  });
  const span = monthSpan(range);
  const rolling = [
    ['1m', 1],
    ['3m', 3],
    ['6m', 6],
    ['12m', 12],
  ] as const;
  const preset =
    exact ??
    rolling.reduce((best, cur) =>
      Math.abs(cur[1] - span) < Math.abs(best[1] - span) ? cur : best,
    )[0];
  return { preset, ...computeDateRange(preset, now) };
}

const fmtMonth = (m: string) => format(parseISO(`${m}-01`), 'MMM yyyy');

export function formatDateRange(range: ReportDateRange): string {
  if (!isFrozen(range)) return DATE_PRESETS.find((p) => p.id === range.preset)?.long ?? '';
  return range.from === range.to
    ? fmtMonth(range.from)
    : `${fmtMonth(range.from)} – ${fmtMonth(range.to)}`;
}
