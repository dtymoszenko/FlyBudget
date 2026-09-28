import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { formatCentsAxis } from '../../utils/currency';
import { chartColors } from '../../utils/chartColors';
import {
  CurrencyTooltip,
  ChartSkeleton,
  EmptyState,
  EXPENSE_COLORS,
  monthLabel,
} from './ChartHelpers';
import ReportTable from './ReportTable';
import { useXAxisLayout } from '../../hooks/useXAxisLayout';

// Plot insets for the charts below: left margin (16) + default y-axis width (60), right margin (16)
const INSET = { left: 76, right: 16 };
import type { CustomReportConfig, CustomReportData } from '../../types';

interface Props {
  config: CustomReportConfig;
  data: CustomReportData | undefined;
  isLoading: boolean;
}

export default function ReportChartArea({ config, data, isLoading }: Props) {
  if (isLoading)
    return (
      <div className="h-full">
        <ChartSkeleton />
      </div>
    );
  if (!data)
    return (
      <div className="h-full">
        <EmptyState />
      </div>
    );

  if (config.chartType === 'table') return <ReportTable data={data} />;
  if (config.chartType === 'donut' && data.mode === 'total') return <DonutView data={data} />;
  if (data.mode === 'total') return <TotalChartView config={config} data={data} />;
  return <TimeChartView config={config} data={data} />;
}

function DonutView({ data }: { data: Extract<CustomReportData, { mode: 'total' }> }) {
  const chartData = data.data.map((d) => ({ ...d, value: Math.abs(d.value) }));
  if (!chartData.length) return <EmptyState />;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius="40%"
          outerRadius="75%"
          paddingAngle={2}
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<CurrencyTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function TotalChartView({
  config,
  data,
}: {
  config: CustomReportConfig;
  data: Extract<CustomReportData, { mode: 'total' }>;
}) {
  const chartData = useMemo(
    () => data.data.map((d) => ({ ...d, value: Math.abs(d.value) })),
    [data],
  );
  // Month groups arrive as "2025-06"; show them like the other charts ("Jun 25"). Checking the
  // format, not just groupBy, because data from the previous grouping can still be showing
  const labels = useMemo(
    () => chartData.map((d) => (/^\d{4}-\d{2}$/.test(d.name) ? monthLabel(d.name) : d.name)),
    [chartData],
  );
  const xAxis = useXAxisLayout({
    labels,
    kind: config.chartType === 'line' || config.chartType === 'area' ? 'point' : 'band',
    // Totals are sorted by amount, even when grouped by month, so every bar keeps its label
    ordered: false,
    inset: INSET,
  });
  if (!chartData.length) return <EmptyState />;

  const ChartComponent =
    config.chartType === 'line' ? LineChart : config.chartType === 'area' ? AreaChart : BarChart;

  return (
    <div ref={xAxis.ref} className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ChartComponent data={chartData} margin={{ top: 8, right: 16, left: 16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
          <XAxis dataKey="name" axisLine={false} tickLine={false} {...xAxis.axisProps} />
          <YAxis
            tick={{ fontSize: 11, fill: chartColors.axis }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatCentsAxis}
          />
          <Tooltip content={<CurrencyTooltip />} />
          {config.chartType === 'area' ? (
            <Area
              type="monotone"
              dataKey="value"
              name="Amount"
              stroke={chartColors.brand}
              fill={chartColors.brand}
              fillOpacity={0.15}
            />
          ) : config.chartType === 'line' ? (
            <Line
              type="monotone"
              dataKey="value"
              name="Amount"
              stroke={chartColors.brand}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ) : (
            <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]} maxBarSize={48}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
              ))}
            </Bar>
          )}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
}

function TimeChartView({
  config,
  data,
}: {
  config: CustomReportConfig;
  data: Extract<CustomReportData, { mode: 'time' }>;
}) {
  const chartData = useMemo(
    () => data.data.map((d) => ({ ...d, month: monthLabel(d.month as string) })),
    [data],
  );
  const labels = useMemo(() => chartData.map((d) => String(d.month)), [chartData]);
  const xAxis = useXAxisLayout({
    labels,
    kind: config.chartType === 'line' || config.chartType === 'area' ? 'point' : 'band',
    ordered: true,
    inset: INSET,
  });
  if (!chartData.length) return <EmptyState />;

  const groups = data.groups;

  if (config.chartType === 'stacked-bar') {
    return (
      <div ref={xAxis.ref} className="w-full h-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 16, left: 16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
            <XAxis dataKey="month" axisLine={false} tickLine={false} {...xAxis.axisProps} />
            <YAxis
              tick={{ fontSize: 11, fill: chartColors.axis }}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatCentsAxis}
            />
            <Tooltip content={<CurrencyTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {groups.map((g, i) => (
              <Bar
                key={g}
                dataKey={g}
                stackId="a"
                fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const ChartComp =
    config.chartType === 'area' ? AreaChart : config.chartType === 'line' ? LineChart : BarChart;

  return (
    <div ref={xAxis.ref} className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <ChartComp data={chartData} margin={{ top: 8, right: 16, left: 16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
          <XAxis dataKey="month" axisLine={false} tickLine={false} {...xAxis.axisProps} />
          <YAxis
            tick={{ fontSize: 11, fill: chartColors.axis }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatCentsAxis}
          />
          <Tooltip content={<CurrencyTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {groups.map((g, i) => {
            const color = EXPENSE_COLORS[i % EXPENSE_COLORS.length];
            if (config.chartType === 'area')
              return (
                <Area
                  key={g}
                  type="monotone"
                  dataKey={g}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.1}
                />
              );
            if (config.chartType === 'line')
              return (
                <Line
                  key={g}
                  type="monotone"
                  dataKey={g}
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              );
            return <Bar key={g} dataKey={g} fill={color} radius={[2, 2, 0, 0]} maxBarSize={32} />;
          })}
        </ChartComp>
      </ResponsiveContainer>
    </div>
  );
}
