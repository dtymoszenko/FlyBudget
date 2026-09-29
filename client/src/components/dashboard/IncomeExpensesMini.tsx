import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useIncomeVsExpenses } from '../../hooks/useReports';
import { formatCurrency } from '../../utils/currency';
import { ArrowLeftRight } from 'lucide-react';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ButtonLink } from '../ui/Button';
import { chartColors } from '../../utils/chartColors';
import { useXAxisLayout } from '../../hooks/useXAxisLayout';

function CurrencyTooltip({ active, payload, label }: any) {
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

interface Props {
  sixMonthsAgo: string;
  currentMonth: string;
}

export default function IncomeExpensesMini({ sixMonthsAgo, currentMonth }: Props) {
  const { data = [], isLoading } = useIncomeVsExpenses(sixMonthsAgo, currentMonth);

  const chartData = useMemo(
    () => data.map((d) => ({ ...d, month: format(parseISO(`${d.month}-01`), 'MMM yy') })),
    [data],
  );
  const monthLabels = useMemo(() => chartData.map((d) => d.month), [chartData]);
  const xAxis = useXAxisLayout({
    labels: monthLabels,
    kind: 'band',
    ordered: true,
    fontSize: 11,
    inset: { left: 4, right: 4 },
  });

  const latestNet = data.length > 0 ? data[data.length - 1].net : 0;
  const hasData = data.some((d) => d.income !== 0 || d.expenses !== 0);

  if (isLoading) {
    return (
      <Card>
        <div className="h-5 w-36 bg-surface-alt rounded animate-pulse mb-2" />
        <div className="h-48 flex items-end gap-2 animate-pulse">
          {[60, 45, 72, 55, 80, 50].map((h, i) => (
            <div key={i} className="flex-1 bg-surface-alt rounded-t" style={{ height: `${h}%` }} />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-text">Cash Flow</h3>
        <Link to="/reports" className="text-xs text-brand-600 hover:text-brand-700 font-medium">
          View all
        </Link>
      </div>
      {hasData && (
        <p className="text-sm text-text-tertiary mb-3">
          Net this month:{' '}
          <span
            className={`font-semibold tabular-nums ${latestNet >= 0 ? 'text-positive' : 'text-negative'}`}
          >
            {formatCurrency(latestNet)}
          </span>
        </p>
      )}

      {hasData ? (
        <div ref={xAxis.ref}>
          <ResponsiveContainer width="100%" height={192}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barGap={2}>
              <XAxis dataKey="month" axisLine={false} tickLine={false} {...xAxis.axisProps} />
              <Tooltip content={<CurrencyTooltip />} cursor={{ fill: 'rgba(37,99,235,0.1)' }} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: chartColors.axis }} />
              <Bar
                dataKey="income"
                name="Income"
                fill={chartColors.positive}
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="expenses"
                name="Expenses"
                fill={chartColors.negative}
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState
          compact
          icon={<ArrowLeftRight size={20} />}
          title="No money in or out yet"
          description="Add transactions to compare what comes in with what goes out, month by month."
          actions={
            <ButtonLink size="sm" to="/transactions?add=1">
              Add a transaction
            </ButtonLink>
          }
        />
      )}
    </Card>
  );
}
