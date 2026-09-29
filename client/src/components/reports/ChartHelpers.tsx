import { format, parseISO } from 'date-fns';
import { ChartNoAxesColumn } from 'lucide-react';
import { formatCurrency } from '../../utils/currency';
import { CATEGORY_COLORS } from '../../utils/chartColors';

export const EXPENSE_COLORS = CATEGORY_COLORS;

export const monthLabel = (month: string) => format(parseISO(`${month}-01`), 'MMM yy');

export interface TooltipSummary {
  label: string;
  value: number;
}

/** `summary` for CurrencyTooltip: the sum of every series at the hovered point. */
export const sumSeries = (payload: any[]): TooltipSummary | null =>
  payload.length > 1
    ? { label: 'Total', value: payload.reduce((s, p) => s + (Number(p.value) || 0), 0) }
    : null;

export const TOOLTIP_CLASS = 'bg-surface border border-border rounded-md shadow-hover px-3 py-2';

/**
 * One line per series at the hovered point. `summary` adds a bold line below them (e.g. a total
 * or net); `hideZero` drops series with no value, for charts with many stacked groups.
 */
export function CurrencyTooltip({
  active,
  payload,
  label,
  labelFormatter,
  summary,
  hideZero,
}: any) {
  if (!active || !payload?.length) return null;
  const rows = hideZero ? payload.filter((p: any) => Number(p.value) !== 0) : payload;
  const extra: TooltipSummary | null = summary ? summary(payload) : null;
  return (
    <div className={TOOLTIP_CLASS}>
      <p className="text-xs text-text-tertiary mb-1">
        {labelFormatter ? labelFormatter(label, payload) : label}
      </p>
      {rows.map((p: any) => (
        <p key={p.name} className="text-xs font-medium" style={{ color: p.color }}>
          {p.name}: {formatCurrency(p.value)}
        </p>
      ))}
      {extra && (
        <p className="text-xs font-semibold text-text mt-1 pt-1 border-t border-border-light">
          {extra.label}: {formatCurrency(extra.value)}
        </p>
      )}
    </div>
  );
}

/**
 * For part-of-whole charts (donut, totals by group): the hovered item's name, amount and share
 * of `total`. Items can carry `fullName` (untruncated label) and `color` (hidden by `noSwatch`,
 * for single-color line and area charts).
 */
export function ShareTooltip({ active, payload, label, total, noSwatch }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const item = p.payload ?? {};
  const value = Number(p.value) || 0;
  const name = String(item.fullName ?? item.name ?? label ?? p.name);
  const color = noSwatch ? undefined : (item.color ?? p.color);
  return (
    <div className={TOOLTIP_CLASS}>
      <p className="flex items-center gap-1.5 text-xs text-text-secondary mb-0.5">
        {color && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />}
        {/^\d{4}-\d{2}$/.test(name) ? monthLabel(name) : name}
      </p>
      <p className="text-sm font-semibold text-text tabular-nums">{formatCurrency(value)}</p>
      {total > 0 && (
        <p className="text-xs text-text-tertiary tabular-nums">
          {((value / total) * 100).toFixed(1)}% of {formatCurrency(total)}
        </p>
      )}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="h-full flex items-end gap-2 px-4 pb-4 pt-8 animate-pulse">
      {[55, 72, 40, 85, 60, 78, 45, 90, 50, 65].map((h, i) => (
        <div key={i} className="flex-1 bg-surface-alt rounded-t" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

/** A chart with nothing to draw: says so, and what would fill it */
export function EmptyState({
  message = 'No data for this period',
  hint = 'Add transactions, or pick a longer date range.',
}: {
  message?: string;
  hint?: string;
}) {
  return (
    <div className="h-full min-h-24 flex flex-col items-center justify-center text-center gap-1 px-4">
      <ChartNoAxesColumn size={20} className="text-text-disabled mb-1" aria-hidden />
      <p className="text-sm font-medium text-text-secondary">{message}</p>
      {hint && <p className="text-xs text-text-tertiary">{hint}</p>}
    </div>
  );
}

export interface StatCard {
  label: string;
  value: string;
  sub?: string;
  tone?: 'positive' | 'negative' | 'neutral';
}

const TONE_CLASS = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-text-tertiary',
} as const;

export function StatCardRow({
  cards,
  variant = 'default',
}: {
  cards: StatCard[];
  /** 'hero': white raised cards with a centered large value above the label, always full width */
  variant?: 'default' | 'hero';
}) {
  if (!cards.length) return null;
  if (variant === 'hero') {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl bg-surface border border-border-light shadow-card px-4 py-6 text-center"
          >
            <p
              className={`text-xl font-semibold tabular-nums ${c.tone ? TONE_CLASS[c.tone] : 'text-text'}`}
            >
              {c.value}
            </p>
            <p className="text-sm text-text-secondary mt-1.5">{c.label}</p>
            {c.sub && <p className="text-xs text-text-tertiary mt-0.5">{c.sub}</p>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex gap-3 mb-5 flex-wrap">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg bg-surface-alt border border-border-light px-4 py-3 min-w-[110px]"
        >
          <p className="text-xs text-text-tertiary">{c.label}</p>
          {c.sub && <p className="text-[11px] text-text-tertiary/80">{c.sub}</p>}
          <p
            className={`text-lg font-semibold mt-0.5 tabular-nums ${c.tone ? TONE_CLASS[c.tone] : 'text-text'}`}
          >
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}
