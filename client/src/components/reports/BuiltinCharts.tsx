import { useState, useMemo, useRef } from 'react';
import {
  AreaChart,
  Area,
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
} from 'recharts';
import {
  useNetWorth,
  useIncomeVsExpenses,
  useSpendingByCategory,
  useSpendingTrends,
} from '../../hooks/useReports';
import { useCategories } from '../../hooks/useCategories';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCurrency, formatCentsAxis } from '../../utils/currency';
import { chartColors, CATEGORY_COLORS } from '../../utils/chartColors';
import {
  computeChartTicks,
  parseDates,
  formatDateLabel,
  useChartWidth,
} from '../../utils/chartTicks';
import {
  CurrencyTooltip,
  ChartSkeleton,
  EmptyState,
  EXPENSE_COLORS,
  monthLabel,
} from './ChartHelpers';

// The built-in reports. Each takes a month range (yyyy-MM) and fills its container.

export function NetWorthChart({ from, to }: { from: string; to: string }) {
  const { data = [], isLoading } = useNetWorth(from, to);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartWidth = useChartWidth(chartRef);

  const rawMonths = useMemo(() => data.map((d) => d.month), [data]);
  const dates = useMemo(() => parseDates(rawMonths), [rawMonths]);
  const tickResult = useMemo(
    () =>
      computeChartTicks({
        dates,
        rawStrings: rawMonths,
        chartWidth,
        labelSpacingPx: 140,
        minTicks: 4,
        maxTicks: 12,
      }),
    [dates, rawMonths, chartWidth],
  );

  const yDomain = useMemo(() => {
    if (data.length === 0) return [0, 'auto'] as [number, string];
    const allValues = data.flatMap((d) => [d.assets, d.liabilities, d.netWorth]);
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const range = max - min || Math.abs(max) || 10000;
    const pad = range * 0.05;
    return [Math.floor((min - pad) / 100) * 100, Math.ceil((max + pad) / 100) * 100] as [
      number,
      number,
    ];
  }, [data]);

  if (isLoading) return <ChartSkeleton />;
  const hasData =
    data.length > 0 && data.some((d) => d.assets !== 0 || d.liabilities !== 0 || d.netWorth !== 0);
  if (!hasData) return <EmptyState />;

  return (
    <div ref={chartRef} className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 24, left: 16, bottom: 4 }}>
          <defs>
            <linearGradient id="gAssets" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColors.positive} stopOpacity={0.15} />
              <stop offset="95%" stopColor={chartColors.positive} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gLiab" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColors.negative} stopOpacity={0.15} />
              <stop offset="95%" stopColor={chartColors.negative} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gNet" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColors.brand} stopOpacity={0.2} />
              <stop offset="95%" stopColor={chartColors.brand} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
          <XAxis
            dataKey="month"
            ticks={tickResult.ticks}
            tickFormatter={tickResult.formatTick}
            tick={{ fontSize: 11, fill: chartColors.axis }}
            axisLine={false}
            tickLine={false}
            padding={{ left: 8, right: 8 }}
          />
          <YAxis
            tickFormatter={formatCentsAxis}
            tick={{ fontSize: 11, fill: chartColors.axis }}
            axisLine={false}
            tickLine={false}
            width={60}
            domain={yDomain}
          />
          <Tooltip content={<CurrencyTooltip />} labelFormatter={formatDateLabel} />
          <Area
            type="monotone"
            dataKey="assets"
            name="Assets"
            stroke={chartColors.positiveLight}
            strokeWidth={2}
            fill="url(#gAssets)"
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="liabilities"
            name="Liabilities"
            stroke={chartColors.negativeLight}
            strokeWidth={2}
            fill="url(#gLiab)"
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="netWorth"
            name="Net Worth"
            stroke={chartColors.brand}
            strokeWidth={2}
            fill="url(#gNet)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function IncomeExpensesChart({ from, to }: { from: string; to: string }) {
  const { data = [], isLoading } = useIncomeVsExpenses(from, to);
  const chartData = useMemo(() => data.map((d) => ({ ...d, month: monthLabel(d.month) })), [data]);

  if (isLoading) return <ChartSkeleton />;
  const hasData = chartData.length > 0 && data.some((d) => d.income !== 0 || d.expenses !== 0);
  if (!hasData) return <EmptyState />;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 4, right: 16, left: 16, bottom: 0 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: chartColors.axis }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={formatCentsAxis}
          tick={{ fontSize: 11, fill: chartColors.axis }}
          axisLine={false}
          tickLine={false}
          width={60}
        />
        <Tooltip content={<CurrencyTooltip />} />
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
        .map((d) => {
          const full = `${showCategoryIcons && d.categoryIcon ? d.categoryIcon + ' ' : ''}${d.categoryName ?? 'Uncategorized'}`;
          return { name: full.length > 22 ? full.slice(0, 21) + '…' : full, value: d.totalSpent };
        }),
    [data, showCategoryIcons],
  );

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
        <Tooltip
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <div className="bg-surface border border-border rounded-md shadow-hover px-3 py-2">
                <p className="text-xs text-text-tertiary mb-0.5">{label}</p>
                <p className="text-xs font-medium text-brand-600">
                  {formatCurrency(payload[0].value as number)}
                </p>
              </div>
            ) : null
          }
        />
        <Bar dataKey="value" name="Spent" radius={[0, 3, 3, 0]} maxBarSize={20}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SpendingTrendsChart({
  from,
  to,
  compact,
  topCategoryIds,
}: {
  from: string;
  to: string;
  compact?: boolean;
  topCategoryIds?: string[];
}) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const activeIds = compact && topCategoryIds?.length ? topCategoryIds : selectedIds;
  const { data: groups = [] } = useCategories();
  const { data: trendData = [], isLoading } = useSpendingTrends(activeIds, from, to);

  const expenseCategories = useMemo(
    () => (groups as any[]).filter((g: any) => g.isIncome === 0).flatMap((g: any) => g.categories),
    [groups],
  );

  const chartData = useMemo(() => {
    if (!trendData.length) return [];
    const monthSet = new Set(trendData.map((r) => r.month));
    const months = [...monthSet].sort();
    return months.map((month) => {
      const row: Record<string, string | number> = { month: monthLabel(month) };
      for (const point of trendData) {
        if (point.month === month) {
          const key = point.categoryName
            ? `${showCategoryIcons && point.categoryIcon ? point.categoryIcon + ' ' : ''}${point.categoryName}`
            : point.categoryId;
          row[key] = point.total;
        }
      }
      return row;
    });
  }, [trendData, showCategoryIcons]);

  const selectedNames = useMemo(() => {
    return activeIds.map((id) => {
      const cat = expenseCategories.find((c: any) => c.id === id);
      return cat ? `${showCategoryIcons && cat.icon ? cat.icon + ' ' : ''}${cat.name}` : id;
    });
  }, [activeIds, expenseCategories, showCategoryIcons]);

  function toggleCategory(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 5 ? [...prev, id] : prev,
    );
  }

  return (
    <div className="h-full flex flex-col gap-3">
      {!compact && (
        <div className="flex flex-wrap gap-1.5 shrink-0">
          {expenseCategories.map((cat: any) => {
            const checked = selectedIds.includes(cat.id);
            const disabled = !checked && selectedIds.length >= 5;
            return (
              <button
                key={cat.id}
                onClick={() => !disabled && toggleCategory(cat.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                  checked
                    ? 'bg-brand-50 border-brand-500 text-brand-700'
                    : disabled
                      ? 'bg-surface-alt border-border-light text-text-disabled cursor-not-allowed'
                      : 'bg-surface border-border text-text-secondary hover:border-text-tertiary'
                }`}
              >
                {showCategoryIcons && cat.icon ? `${cat.icon} ` : ''}
                {cat.name}
              </button>
            );
          })}
          {expenseCategories.length === 0 && (
            <span className="text-xs text-text-tertiary">No expense categories found.</span>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0">
        {activeIds.length === 0 ? (
          <EmptyState message="Select categories above to compare trends." />
        ) : isLoading ? (
          <ChartSkeleton />
        ) : !chartData.length ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: chartColors.axis }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatCentsAxis}
                tick={{ fontSize: 11, fill: chartColors.axis }}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip content={<CurrencyTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {selectedNames.map((name, i) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={EXPENSE_COLORS[i % EXPENSE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
