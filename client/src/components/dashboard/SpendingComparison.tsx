import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Trans, useTranslation } from 'react-i18next';
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
import { TrendingDown } from 'lucide-react';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { chartColors } from '../../utils/chartColors';
import { useXAxisLayout } from '../../hooks/useXAxisLayout';

type Mode =
  | 'week_vs_last_week'
  | 'month_vs_last_month'
  | 'month_vs_last_year'
  | 'month_vs_average'
  | 'year_vs_last_year';

const MODES: Mode[] = [
  'week_vs_last_week',
  'month_vs_last_month',
  'month_vs_last_year',
  'month_vs_average',
  'year_vs_last_year',
];

/** The period being spent in: this week, month or year */
const periodOf = (mode: Mode) =>
  mode.startsWith('week') ? 'week' : mode.startsWith('year') ? 'year' : 'month';

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
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('month_vs_last_month');
  const { data, isLoading } = useSpendingComparison(mode);

  const chartData = useMemo(() => {
    if (!data) return [];
    const merged: Record<
      number,
      { day: number; label: string; current?: number; comparison?: number }
    > = {};

    for (let day = 1; day <= data.maxDays; day++) {
      merged[day] = { day, label: t('dashboard.comparison.day', { day }) };
    }

    for (const pt of data.current) {
      if (merged[pt.day]) merged[pt.day].current = pt.cumulative;
    }
    for (const pt of data.comparison) {
      if (merged[pt.day]) merged[pt.day].comparison = pt.cumulative;
    }

    return Object.values(merged).sort((a, b) => a.day - b.day);
  }, [data, t]);

  const hasData =
    !!data &&
    (data.current.some((p) => p.cumulative !== 0) ||
      data.comparison.some((p) => p.cumulative !== 0));

  const labels = useMemo(() => chartData.map((d) => d.label), [chartData]);
  // Inset: y-axis width (50) on the left, chart margin (8) on the right
  const xAxis = useXAxisLayout({
    labels,
    kind: 'point',
    ordered: true,
    fontSize: 11,
    inset: { left: 50, right: 8 },
  });

  // Named here rather than taken from the server, so they follow the language
  const period = periodOf(mode);
  const currentLabel = t(
    period === 'week'
      ? 'dashboard.comparison.thisWeek'
      : period === 'year'
        ? 'dashboard.comparison.thisYear'
        : 'dashboard.comparison.thisMonth',
  );
  const comparisonLabel = {
    week_vs_last_week: () => t('dashboard.comparison.lastWeek'),
    month_vs_last_month: () => t('dashboard.comparison.lastMonth'),
    month_vs_last_year: () =>
      format(new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1), 'MMM yyyy'),
    month_vs_average: () => t('dashboard.comparison.averageMonth'),
    year_vs_last_year: () => t('dashboard.comparison.lastYear'),
  }[mode]();

  const spendingKeys = {
    week: 'dashboard.comparison.spendingWeek',
    month: 'dashboard.comparison.spendingMonth',
    year: 'dashboard.comparison.spendingYear',
  } as const;

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
            <Trans
              i18nKey={spendingKeys[period]}
              values={{ amount: formatCurrency(data.currentTotal) }}
              components={{
                amount: <span className="text-text-secondary font-normal tabular-nums" />,
              }}
            />
          </h3>
        </div>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className="text-xs border border-border rounded-lg px-2 py-1.5 bg-surface text-text cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-600 min-w-0 max-w-[200px]"
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {t(`dashboard.comparison.modes.${m}`)}
            </option>
          ))}
        </select>
      </div>

      {hasData && chartData.length > 0 ? (
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
                tick={{ fontSize: 11, fill: chartColors.axis }}
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
                name={comparisonLabel}
                stroke="#9CA3AF"
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                connectNulls={false}
              />
              <Area
                type="monotone"
                dataKey="current"
                name={currentLabel}
                stroke={chartColors.brand}
                strokeWidth={2}
                fill="url(#gSpendingCur)"
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState
          compact
          icon={<TrendingDown size={20} />}
          title={t('dashboard.comparison.emptyTitle')}
          description={t('dashboard.comparison.emptyDescription')}
        />
      )}
    </Card>
  );
}
