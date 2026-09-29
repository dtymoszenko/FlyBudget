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
  Sector,
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
  ShareTooltip,
  sumSeries,
  ChartSkeleton,
  EmptyState,
  EXPENSE_COLORS,
  monthLabel,
} from './ChartHelpers';
import ReportTable from './ReportTable';
import { useXAxisLayout } from '../../hooks/useXAxisLayout';

// Plot insets for the charts below: left margin (16) + default y-axis width (60), right margin (16)
const INSET = { left: 76, right: 16 };
import type { PieSectorDataItem } from 'recharts';
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

/** Totals as positive amounts, each with the color its slice or bar is drawn in. */
function withColors(rows: Extract<CustomReportData, { mode: 'total' }>['data']) {
  return rows.map((d, i) => ({
    ...d,
    value: Math.abs(d.value),
    color: EXPENSE_COLORS[i % EXPENSE_COLORS.length],
  }));
}

/** The hovered slice: pushed out a little past the others. */
function ActiveSlice({
  cx,
  cy,
  innerRadius,
  outerRadius = 0,
  startAngle,
  endAngle,
  fill,
}: PieSectorDataItem) {
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius + 8}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
    />
  );
}

/** Every other slice while one is hovered: faded so the hovered one stands out. */
function InactiveSlice({
  cx,
  cy,
  innerRadius,
  outerRadius,
  startAngle,
  endAngle,
  fill,
}: PieSectorDataItem) {
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      fillOpacity={0.35}
    />
  );
}

function DonutView({ data }: { data: Extract<CustomReportData, { mode: 'total' }> }) {
  const chartData = withColors(data.data);
  if (!chartData.length) return <EmptyState />;
  const total = chartData.reduce((s, d) => s + d.value, 0);

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
          activeShape={ActiveSlice}
          inactiveShape={InactiveSlice}
        >
          {chartData.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Pie>
        <Tooltip content={<ShareTooltip total={total} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** A line or area needs two points; with only one, draw bars so the value is still readable. */
function singlePointType(type: CustomReportConfig['chartType'], points: number) {
  return points === 1 && (type === 'line' || type === 'area') ? 'bar' : type;
}

function TotalChartView({
  config,
  data,
}: {
  config: CustomReportConfig;
  data: Extract<CustomReportData, { mode: 'total' }>;
}) {
  const chartData = useMemo(() => withColors(data.data), [data]);
  const total = useMemo(() => chartData.reduce((s, d) => s + d.value, 0), [chartData]);
  const chartType = singlePointType(config.chartType, chartData.length);
  // Month groups arrive as "2025-06"; show them like the other charts ("Jun 25"). Checking the
  // format, not just groupBy, because data from the previous grouping can still be showing
  const byMonth = chartData.length > 0 && chartData.every((d) => /^\d{4}-\d{2}$/.test(d.name));
  const labels = useMemo(
    () => chartData.map((d) => (byMonth ? monthLabel(d.name) : d.name)),
    [chartData, byMonth],
  );
  const xAxis = useXAxisLayout({
    labels,
    kind: chartType === 'line' || chartType === 'area' ? 'point' : 'band',
    // Months come in date order, so labels can be skipped evenly like a time axis; other
    // totals are sorted by amount, so every bar keeps its label
    ordered: byMonth,
    inset: INSET,
  });
  if (!chartData.length) return <EmptyState />;

  const ChartComponent =
    chartType === 'line' ? LineChart : chartType === 'area' ? AreaChart : BarChart;

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
          <Tooltip content={<ShareTooltip total={total} noSwatch={chartType !== 'bar'} />} />
          {chartType === 'area' ? (
            <Area
              type="monotone"
              dataKey="value"
              name="Amount"
              stroke={chartColors.brand}
              fill={chartColors.brand}
              fillOpacity={0.15}
            />
          ) : chartType === 'line' ? (
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
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.color} />
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
  const chartType = singlePointType(config.chartType, chartData.length);
  const labels = useMemo(() => chartData.map((d) => String(d.month)), [chartData]);
  const xAxis = useXAxisLayout({
    labels,
    kind: chartType === 'line' || chartType === 'area' ? 'point' : 'band',
    ordered: true,
    inset: INSET,
  });
  if (!chartData.length) return <EmptyState />;

  const groups = data.groups;

  if (chartType === 'stacked-bar') {
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
            <Tooltip content={<CurrencyTooltip summary={sumSeries} hideZero />} />
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

  const ChartComp = chartType === 'area' ? AreaChart : chartType === 'line' ? LineChart : BarChart;

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
          <Tooltip content={<CurrencyTooltip summary={sumSeries} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {groups.map((g, i) => {
            const color = EXPENSE_COLORS[i % EXPENSE_COLORS.length];
            if (chartType === 'area')
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
            if (chartType === 'line')
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
