import { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useSpendingComparison } from '../../hooks/useReports';
import { formatCurrency } from '../../utils/currency';
import { Card } from '../ui/Card';
import { chartColors } from '../../utils/chartColors';
import { useXAxisLayout } from '../../hooks/useXAxisLayout';

type Mode =
  | 'week_vs_last_week'
  | 'month_vs_last_month'
  | 'month_vs_last_year'
  | 'month_vs_average'
  | 'year_vs_last_year';

const MODES: { value: Mode; label: string }[] = [
  { value: 'week_vs_last_week', label: 'This week vs. last week' },
  { value: 'month_vs_last_month', label: 'This month vs. last month' },
  { value: 'month_vs_last_year', label: 'This month vs. last year' },
  { value: 'month_vs_average', label: 'This month vs. average month' },
  { value: 'year_vs_last_year', label: 'This year vs. last year' },
];

function formatYAxis(value: number): string {
  const dollars = Math.abs(value) / 100;
  if (dollars >= 1000) {
    const k = dollars / 1000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return `$${dollars.toFixed(0)}`;
}

function ComparisonTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-border rounded-lg shadow-hover px-3 py-2">
      <p className="text-xs text-text-tertiary mb-1">{label}</p>
      {payload.map(
        (p: any) =>
          p.value != null && (
            <p
              key={p.dataKey}
              className="text-xs font-medium"
              style={{ color: p.stroke || p.color }}
            >
              {p.name}: {formatCurrency(p.value)}
            </p>
          ),
      )}
    </div>
  );
}

export default function SpendingComparison() {
  const [mode, setMode] = useState<Mode>('month_vs_last_month');
  const { data, isLoading } = useSpendingComparison(mode);

  const chartData = useMemo(() => {
    if (!data) return [];
    const merged: Record<
      number,
      { day: number; label: string; current?: number; comparison?: number }
    > = {};

    for (let day = 1; day <= data.maxDays; day++) {
      merged[day] = { day, label: `Day ${day}` };
    }

    for (const pt of data.current) {
      if (merged[pt.day]) merged[pt.day].current = pt.cumulative;
    }
    for (const pt of data.comparison) {
      if (merged[pt.day]) merged[pt.day].comparison = pt.cumulative;
    }

    return Object.values(merged).sort((a, b) => a.day - b.day);
  }, [data]);

  const labels = useMemo(() => chartData.map((d) => d.label), [chartData]);
  // Inset: y-axis width (50) on the left, chart margin (8) on the right
  const xAxis = useXAxisLayout({
    labels,
    kind: 'point',
    ordered: true,
    fontSize: 10,
    inset: { left: 50, right: 8 },
  });

  if (isLoading || !data) {
    return (
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div className="h-5 w-36 bg-surface-alt rounded animate-pulse" />
          <div className="h-8 w-44 bg-surface-alt rounded animate-pulse" />
        </div>
        <div className="h-4 w-28 bg-surface-alt rounded animate-pulse mb-3" />
        <div className="h-48 bg-surface-alt rounded animate-pulse" />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold text-text">
            Spending{' '}
            <span className="text-text-secondary font-normal tabular-nums">
              {formatCurrency(data.currentTotal)} {data.periodLabel}
            </span>
          </h3>
        </div>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className="text-xs border border-border rounded-lg px-2 py-1.5 bg-surface text-text cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-600 min-w-0 max-w-[200px]"
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {chartData.length > 0 ? (
        <div className="mt-2" ref={xAxis.ref}>
          <ResponsiveContainer width="100%" height={192}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gSpendingCur" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColors.brand} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={chartColors.brand} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" axisLine={false} tickLine={false} {...xAxis.axisProps} />
              <YAxis
                tick={{ fontSize: 10, fill: chartColors.axis }}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatYAxis}
                width={50}
              />
              <Tooltip content={<ComparisonTooltip />} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: chartColors.axis }} />
              <Line
                type="monotone"
                dataKey="comparison"
                name={data.comparisonLabel}
                stroke="#9CA3AF"
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                connectNulls={false}
              />
              <Area
                type="monotone"
                dataKey="current"
                name={data.currentLabel}
                stroke={chartColors.brand}
                strokeWidth={2}
                fill="url(#gSpendingCur)"
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-text-disabled py-8 text-center">Not enough data yet.</p>
      )}
    </Card>
  );
}
