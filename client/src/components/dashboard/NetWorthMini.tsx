import { useState, useMemo } from 'react';
import { format, subMonths, subDays, startOfYear } from 'date-fns';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useNetWorth } from '../../hooks/useReports';
import { useAccounts } from '../../hooks/useAccounts';
import { ButtonLink } from '../ui/Button';
import { formatCurrency } from '../../utils/currency';
import { chartColors } from '../../utils/chartColors';
import { formatDateAxisLabels, formatDateLabel } from '../../utils/chartTicks';
import { useXAxisLayout } from '../../hooks/useXAxisLayout';

function MiniTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-border rounded-lg shadow-hover px-3 py-2">
      <p className="text-xs text-text-tertiary mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="text-xs font-medium" style={{ color: p.color }}>
          {p.name}: {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
}

type Preset = '1m' | '3m' | '6m' | 'ytd' | '1y' | 'all';

const PRESETS: { value: Preset; label: string }[] = [
  { value: '1m', label: '1 month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: 'ytd', label: 'Year to date' },
  { value: '1y', label: '1 year' },
  { value: 'all', label: 'All time' },
];

function computeRange(preset: Preset): {
  from: string;
  to: string;
  granularity: 'daily' | 'monthly';
} {
  const now = new Date();
  switch (preset) {
    case '1m':
      return {
        from: format(subDays(now, 30), 'yyyy-MM-dd'),
        to: format(now, 'yyyy-MM-dd'),
        granularity: 'daily',
      };
    case '3m':
      return {
        from: format(subMonths(now, 3), 'yyyy-MM-dd'),
        to: format(now, 'yyyy-MM-dd'),
        granularity: 'daily',
      };
    case '6m':
      return {
        from: format(subMonths(now, 5), 'yyyy-MM'),
        to: format(now, 'yyyy-MM'),
        granularity: 'monthly',
      };
    case 'ytd':
      return {
        from: format(startOfYear(now), 'yyyy-MM'),
        to: format(now, 'yyyy-MM'),
        granularity: 'monthly',
      };
    case '1y':
      return {
        from: format(subMonths(now, 11), 'yyyy-MM'),
        to: format(now, 'yyyy-MM'),
        granularity: 'monthly',
      };
    case 'all':
      return { from: '2000-01', to: format(now, 'yyyy-MM'), granularity: 'monthly' };
  }
}

export default function NetWorthMini() {
  const [preset, setPreset] = useState<Preset>('1m');

  const { from, to, granularity } = useMemo(() => computeRange(preset), [preset]);
  const { data = [], isLoading } = useNetWorth(from, to, granularity);
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const noAccounts = !accountsLoading && accounts?.length === 0;

  const dateLabels = useMemo(() => formatDateAxisLabels(data.map((d) => d.month)), [data]);
  const xAxis = useXAxisLayout({
    labels: dateLabels,
    kind: 'point',
    ordered: true,
    fontSize: 11,
    inset: { left: 8, right: 8 },
    edgeRoom: { left: 8, right: 8 },
  });

  const yDomain = useMemo(() => {
    if (data.length === 0) return [0, 100];
    const values = data.map((d) => d.netWorth);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const pad = range > 0 ? range * 0.05 : Math.abs(max) * 0.01 || 100;
    return [min - pad, max + pad];
  }, [data]);

  const latest = data.length > 0 ? data[data.length - 1].netWorth : 0;
  const first = data.length > 0 ? data[0].netWorth : latest;
  const change = latest - first;
  const pct = first !== 0 ? (change / Math.abs(first)) * 100 : 0;

  if (isLoading) {
    return (
      <div className="py-2">
        <div className="flex items-center justify-between mb-2">
          <div className="h-8 w-48 bg-surface-alt rounded animate-pulse" />
          <div className="h-8 w-28 bg-surface-alt rounded animate-pulse" />
        </div>
        <div className="h-28 bg-surface-alt rounded animate-pulse mt-4" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-text-tertiary uppercase tracking-wide">
            Net Worth
          </p>
          <p
            className={`text-3xl font-semibold tabular-nums mt-1 ${latest >= 0 ? 'text-text' : 'text-negative'}`}
          >
            {formatCurrency(latest)}
          </p>
          {noAccounts && (
            <p className="text-sm text-text-tertiary mt-1">
              What you own minus what you owe, across all your accounts.
            </p>
          )}
          {data.length > 1 && !noAccounts && (
            <p
              className={`text-sm tabular-nums mt-0.5 ${change >= 0 ? 'text-positive' : 'text-negative'}`}
            >
              {change >= 0 ? '+' : ''}
              {formatCurrency(change)} ({Math.abs(pct).toFixed(1)}%)
            </p>
          )}
        </div>

        {noAccounts ? (
          <ButtonLink size="sm" to="/accounts?add=1">
            Add an account
          </ButtonLink>
        ) : (
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as Preset)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-surface text-text cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-600"
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {data.length > 1 && !noAccounts && (
        <div className="mt-4" ref={xAxis.ref}>
          <ResponsiveContainer width="100%" height={112}>
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <defs>
                <linearGradient id="gNetMini" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColors.brand} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={chartColors.brand} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" axisLine={false} tickLine={false} {...xAxis.axisProps} />
              <YAxis hide domain={yDomain} />
              <Tooltip content={<MiniTooltip />} labelFormatter={formatDateLabel} />
              <Area
                type="monotone"
                dataKey="netWorth"
                name="Net Worth"
                stroke={chartColors.brand}
                strokeWidth={2}
                fill="url(#gNetMini)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
