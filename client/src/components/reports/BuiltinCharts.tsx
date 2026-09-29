import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  ComposedChart,
  BarChart,
  Bar,
  LineChart,
  Line,
  Legend,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import {
  useNetWorthSeries,
  useIncomeVsExpenses,
  useSpendingByCategory,
  useSpendingTrends,
} from '../../hooks/useReports';
import { useCategories } from '../../hooks/useCategories';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCentsAxis, formatCurrency } from '../../utils/currency';
import { niceStep, valueAxis } from '../../utils/valueAxis';
import { dayBounds, monthCount, monthsBetween } from '../../utils/dateRange';
import { eachDayOfInterval, format, parseISO } from 'date-fns';
import { chartColors, CATEGORY_COLORS } from '../../utils/chartColors';
import { formatDateAxisLabels, formatDateLabel } from '../../utils/chartTicks';
import {
  CurrencyTooltip,
  TOOLTIP_CLASS,
  ShareTooltip,
  sumSeries,
  ChartSkeleton,
  EmptyState,
  EXPENSE_COLORS,
  monthLabel,
} from './ChartHelpers';
import { useXAxisLayout } from '../../hooks/useXAxisLayout';
import type { NetWorthPoint } from '../../types';

// Plot insets for charts with 16px margins and a 60px y-axis
const INSET = { left: 76, right: 16 };

// The built-in reports. Each takes a month range (yyyy-MM) and fills its container.

/** Latest net worth and how much it changed since the first month (`percent` is null from $0 or less). */
export function netWorthChange(data: NetWorthPoint[]) {
  if (!data.length) return null;
  const first = data[0].netWorth;
  const latest = data[data.length - 1].netWorth;
  const change = latest - first;
  return { latest, change, percent: first > 0 ? (change / first) * 100 : null };
}

export function formatChange(change: number, percent: number | null): string {
  const sign = change > 0 ? '+' : '';
  const pct =
    percent === null ? '' : ` (${sign}${percent.toFixed(Math.abs(percent) < 10 ? 1 : 0)}%)`;
  return `${sign}${formatCurrency(change)}${pct}`;
}

function NetWorthTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d: NetWorthPoint = payload[0].payload;
  return (
    <div className={TOOLTIP_CLASS}>
      <p className="text-xs text-text-tertiary mb-1">{formatDateLabel(label)}</p>
      <p className="text-xs font-semibold" style={{ color: chartColors.brand }}>
        Net worth: {formatCurrency(d.netWorth)}
      </p>
      <p className="text-xs font-medium mt-1" style={{ color: chartColors.positive }}>
        Assets: {formatCurrency(d.assets)}
      </p>
      <p className="text-xs font-medium" style={{ color: chartColors.negative }}>
        Liabilities: {formatCurrency(d.liabilities)}
      </p>
    </div>
  );
}

function LegendKey({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={line ? 'w-3 h-0.5 rounded-full' : 'w-2.5 h-2.5 rounded-sm'}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

/**
 * Net worth and assets as lines on an axis zoomed to their range, so growth reads at a glance,
 * with liabilities in a strip below on their own $0-based scale (on the zoomed axis they would
 * pull it back down to $0). Hovering either shows all three. `headline` adds the latest value
 * and the period change on top (the full view shows those as stat cards instead).
 */
export function NetWorthChart({
  from,
  to,
  headline,
}: {
  from: string;
  to: string;
  headline?: boolean;
}) {
  const { data = [], isLoading } = useNetWorthSeries(from, to);
  const dateLabels = useMemo(() => formatDateAxisLabels(data.map((d) => d.month)), [data]);
  const xAxis = useXAxisLayout({
    labels: dateLabels,
    kind: 'point',
    ordered: true,
    inset: { left: 76, right: 24 },
  });
  const yAxis = useMemo(() => valueAxis(data.flatMap((d) => [d.assets, d.netWorth])), [data]);
  const debtMax = useMemo(() => Math.max(0, ...data.map((d) => d.liabilities)), [data]);
  const debtTop =
    debtMax > 0 ? Math.ceil(debtMax / niceStep(debtMax, 2)) * niceStep(debtMax, 2) : 0;
  const summary = useMemo(() => netWorthChange(data), [data]);

  if (isLoading) return <ChartSkeleton />;
  const hasData =
    data.length > 0 && data.some((d) => d.assets !== 0 || d.liabilities !== 0 || d.netWorth !== 0);
  if (!hasData) return <EmptyState />;

  const trend = summary && summary.change < 0 ? chartColors.negative : chartColors.positive;
  const showDebt = debtMax > 0;
  const dot = (color: string) =>
    data.length <= 24 ? { r: 3, fill: color, strokeWidth: 0 } : false;
  const yAxisProps = {
    tickFormatter: formatCentsAxis,
    tick: { fontSize: 11, fill: chartColors.axis },
    axisLine: false,
    tickLine: false,
    width: 60,
    // The ticks are already picked to fit; Recharts would otherwise drop the bottom one
    interval: 0,
  };
  const margin = { right: 24, left: 16 };

  return (
    <div className="w-full h-full flex flex-col">
      {headline && summary && (
        <div className="flex items-baseline gap-2 flex-wrap px-1 pb-1">
          <span className="text-xl font-semibold text-text tabular-nums">
            {formatCurrency(summary.latest)}
          </span>
          {data.length > 1 && (
            <span className="text-sm font-medium tabular-nums" style={{ color: trend }}>
              {summary.change >= 0 ? '▲' : '▼'} {formatChange(summary.change, summary.percent)}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap px-1 pb-1 text-[11px] text-text-secondary">
        <LegendKey color={chartColors.brand} label="Net worth" line />
        <LegendKey color={chartColors.positiveLight} label="Assets" line />
        {showDebt && <LegendKey color={chartColors.negativeLight} label="Liabilities" />}
      </div>

      <div className="flex-[3] min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} syncId="net-worth" margin={{ ...margin, top: 8, bottom: 8 }}>
            <defs>
              <linearGradient id="gNet" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={chartColors.brand} stopOpacity={0.25} />
                <stop offset="95%" stopColor={chartColors.brand} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
            <XAxis
              dataKey="month"
              hide={showDebt}
              axisLine={false}
              tickLine={false}
              {...xAxis.axisProps}
            />
            <YAxis {...yAxisProps} domain={yAxis.domain} ticks={yAxis.ticks} />
            <Tooltip content={<NetWorthTooltip />} />
            <Line
              type="monotone"
              dataKey="assets"
              name="Assets"
              stroke={chartColors.positiveLight}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Area
              type="monotone"
              dataKey="netWorth"
              name="Net Worth"
              stroke={chartColors.brand}
              strokeWidth={2.5}
              fill="url(#gNet)"
              baseValue={yAxis.domain[0]}
              dot={dot(chartColors.brand)}
              activeDot={{ r: 4.5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {showDebt && (
        <div
          ref={xAxis.ref}
          className="flex-1 min-h-[72px] max-h-[140px] mt-1 pt-1 border-t border-border-light"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} syncId="net-worth" margin={{ ...margin, top: 6, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} {...xAxis.axisProps} />
              <YAxis {...yAxisProps} domain={[0, debtTop]} ticks={[0, debtTop]} />
              <Tooltip content={() => null} />
              <Area
                type="monotone"
                dataKey="liabilities"
                name="Liabilities"
                stroke={chartColors.negativeLight}
                strokeWidth={2}
                fill={chartColors.negativeLight}
                fillOpacity={0.15}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {!showDebt && <div ref={xAxis.ref} className="h-0" />}
    </div>
  );
}

export function IncomeExpensesChart({ from, to }: { from: string; to: string }) {
  const { data = [], isLoading } = useIncomeVsExpenses(from, to);
  const chartData = useMemo(() => data.map((d) => ({ ...d, month: monthLabel(d.month) })), [data]);
  const monthLabels = useMemo(() => chartData.map((d) => d.month), [chartData]);
  const xAxis = useXAxisLayout({ labels: monthLabels, kind: 'band', ordered: true, inset: INSET });

  if (isLoading) return <ChartSkeleton />;
  const hasData = chartData.length > 0 && data.some((d) => d.income !== 0 || d.expenses !== 0);
  if (!hasData) return <EmptyState />;

  return (
    <div ref={xAxis.ref} className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 4, right: 16, left: 16, bottom: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="month" axisLine={false} tickLine={false} {...xAxis.axisProps} />
          <YAxis
            tickFormatter={formatCentsAxis}
            tick={{ fontSize: 11, fill: chartColors.axis }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip
            content={
              <CurrencyTooltip
                summary={(payload: any[]) => ({ label: 'Net', value: payload[0].payload.net })}
              />
            }
          />
          <Bar
            dataKey="income"
            name="Income"
            fill={chartColors.positive}
            radius={[3, 3, 0, 0]}
            maxBarSize={32}
          />
          <Bar
            dataKey="expenses"
            name="Expenses"
            fill={chartColors.negativeLight}
            radius={[3, 3, 0, 0]}
            maxBarSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SpendingChart({ from, to }: { from: string; to: string }) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { data = [], isLoading } = useSpendingByCategory(from, to);
  const chartData = useMemo(
    () =>
      [...data]
        .sort((a, b) => b.totalSpent - a.totalSpent)
        .slice(0, 10)
        .map((d, i) => {
          const full = `${showCategoryIcons && d.categoryIcon ? d.categoryIcon + ' ' : ''}${d.categoryName ?? 'Uncategorized'}`;
          return {
            name: full.length > 22 ? full.slice(0, 21) + '…' : full,
            fullName: full,
            value: d.totalSpent,
            color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
          };
        }),
    [data, showCategoryIcons],
  );
  // Shares are of all spending, not just the ten categories drawn
  const total = useMemo(() => data.reduce((s, d) => s + d.totalSpent, 0), [data]);

  if (isLoading) return <ChartSkeleton />;
  if (!chartData.length) return <EmptyState />;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={formatCentsAxis}
          tick={{ fontSize: 11, fill: chartColors.axis }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11, fill: chartColors.axis }}
          axisLine={false}
          tickLine={false}
          width={160}
          interval={0}
        />
        <Tooltip content={<ShareTooltip total={total} />} />
        <Bar dataKey="value" name="Spent" radius={[0, 3, 3, 0]} maxBarSize={20}>
          {chartData.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Summary's full view: expenses (net of refunds) per month against the monthly average. */
export function MonthlySpendingChart({ from, to }: { from: string; to: string }) {
  const { data = [], isLoading } = useIncomeVsExpenses(from, to);
  const chartData = useMemo(
    () => data.map((d) => ({ month: monthLabel(d.month), spending: -d.expenseNet })),
    [data],
  );
  const monthLabels = useMemo(() => chartData.map((d) => d.month), [chartData]);
  const xAxis = useXAxisLayout({ labels: monthLabels, kind: 'band', ordered: true, inset: INSET });
  const average = chartData.length
    ? chartData.reduce((s, d) => s + d.spending, 0) / chartData.length
    : 0;

  if (isLoading) return <ChartSkeleton />;
  if (!chartData.some((d) => d.spending !== 0)) return <EmptyState />;

  return (
    <div ref={xAxis.ref} className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="month" axisLine={false} tickLine={false} {...xAxis.axisProps} />
          <YAxis
            tickFormatter={formatCentsAxis}
            tick={{ fontSize: 11, fill: chartColors.axis }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip
            content={
              <CurrencyTooltip summary={() => ({ label: 'Monthly average', value: average })} />
            }
          />
          <Bar
            dataKey="spending"
            name="Expenses"
            fill={chartColors.negativeLight}
            radius={[3, 3, 0, 0]}
            maxBarSize={40}
          />
          {chartData.length > 1 && (
            <ReferenceLine
              y={average}
              stroke={chartColors.label}
              strokeDasharray="4 4"
              label={{
                value: `Avg ${formatCurrency(Math.round(average))}`,
                position: 'insideTopRight',
                fontSize: 11,
                fill: chartColors.label,
              }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** How a category is named in charts and tables: its icon (when shown) and name. */
export function categoryLabel(
  c: { name?: string | null; icon?: string | null } | undefined,
  showIcons: boolean,
  fallback = 'Uncategorized',
) {
  if (!c?.name) return fallback;
  return `${showIcons && c.icon ? c.icon + ' ' : ''}${c.name}`;
}

/**
 * Spending in each of `categoryIds` over the range, one line per category in EXPENSE_COLORS
 * order. A single month shows each category's running total by day; longer ranges, totals by
 * month.
 */
export function SpendingTrendsChart({
  from,
  to,
  categoryIds,
  caption,
}: {
  from: string;
  to: string;
  categoryIds: string[];
  /** A short note above the chart (e.g. which categories these are) */
  caption?: string;
}) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { data: groups = [] } = useCategories();
  const daily = monthCount(from, to) === 1;
  const { data: trendData = [], isLoading } = useSpendingTrends(
    categoryIds,
    from,
    to,
    daily ? 'daily' : undefined,
  );

  // Series are keyed by id, so two categories with the same name stay apart
  const names = useMemo(() => {
    const byId = new Map(groups.flatMap((g) => g.categories).map((c) => [c.id, c]));
    return categoryIds.map((id) =>
      categoryLabel(byId.get(id), showCategoryIcons, 'Deleted category'),
    );
  }, [groups, categoryIds, showCategoryIcons]);

  const chartData = useMemo(() => {
    if (!trendData.length) return [];
    const byPeriod = new Map<string, Record<string, number>>();
    for (const p of trendData) {
      const row = byPeriod.get(p.month) ?? {};
      row[p.categoryId] = (row[p.categoryId] ?? 0) + p.total;
      byPeriod.set(p.month, row);
    }
    const zero = () => Object.fromEntries(categoryIds.map((id) => [id, 0]));

    if (daily) {
      const { from: first, to: last } = dayBounds(from, to);
      if (last < first) return [];
      const running: Record<string, number> = zero();
      return eachDayOfInterval({ start: parseISO(first), end: parseISO(last) }).map((d) => {
        const day = format(d, 'yyyy-MM-dd');
        for (const [k, v] of Object.entries(byPeriod.get(day) ?? {})) running[k] += v;
        return { month: day, ...running };
      });
    }
    // Every month from the first with spending, so a month with none shows as $0, not a gap
    const firstMonth = [...byPeriod.keys()].sort()[0];
    return monthsBetween(firstMonth > from ? firstMonth : from, to).map((month) => ({
      month: monthLabel(month),
      ...zero(),
      ...byPeriod.get(month),
    }));
  }, [trendData, categoryIds, daily, from, to]);

  const single = chartData.length === 1;
  const monthLabels = useMemo(
    () =>
      daily
        ? formatDateAxisLabels(chartData.map((d) => String(d.month)))
        : chartData.map((d) => String(d.month)),
    [chartData, daily],
  );
  const xAxis = useXAxisLayout({
    labels: monthLabels,
    // One point can't make a line, so it shows as bars
    kind: single ? 'band' : 'point',
    ordered: true,
    inset: INSET,
  });

  const TrendChart = single ? BarChart : LineChart;

  return (
    <div ref={xAxis.ref} className="w-full h-full">
      {isLoading ? (
        <ChartSkeleton />
      ) : !categoryIds.length || !chartData.length ? (
        <EmptyState />
      ) : (
        <div className="h-full flex flex-col">
          {(caption || daily) && (
            <p className="text-[11px] text-text-tertiary px-1 pb-1 shrink-0">
              {caption
                ? `${caption}${daily ? ' · running total' : ''}`
                : 'Running total this month'}
            </p>
          )}
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <TrendChart data={chartData} margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} {...xAxis.axisProps} />
                <YAxis
                  tickFormatter={formatCentsAxis}
                  tick={{ fontSize: 11, fill: chartColors.axis }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip
                  content={<CurrencyTooltip summary={sumSeries} />}
                  labelFormatter={daily ? formatDateLabel : undefined}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
                {categoryIds.map((id, i) => {
                  const color = EXPENSE_COLORS[i % EXPENSE_COLORS.length];
                  return single ? (
                    <Bar
                      key={id}
                      dataKey={id}
                      name={names[i]}
                      fill={color}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={48}
                    />
                  ) : (
                    <Line
                      key={id}
                      type={daily ? 'stepAfter' : 'monotone'}
                      dataKey={id}
                      name={names[i]}
                      stroke={color}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  );
                })}
              </TrendChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
