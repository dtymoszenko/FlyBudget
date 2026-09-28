import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  LabelList,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { useBudget, useCategoryHistory } from '../hooks/useBudget';
import { useTransactions } from '../hooks/useTransactions';
import { useAppStore } from '../store/appStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { formatCurrency } from '../utils/currency';
import { chartColors } from '../utils/chartColors';
import { TransactionTable } from '../components/transactions/TransactionTable';
import type { Transaction } from '../types';
import { useXAxisLayout } from '../hooks/useXAxisLayout';

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-border rounded-lg shadow-hover px-3 py-2">
      <p className="text-xs text-text-tertiary mb-1">{label}</p>
      <p className="text-xs font-medium text-text">
        {formatCurrency(Math.round(payload[0].value * 100))}
      </p>
    </div>
  );
}

interface HistoryChartProps {
  categoryId: string;
  month: string;
  isIncome: boolean;
  selectedBarMonth: string | null;
  onBarClick: (month: string | null) => void;
}

function HistoryChart({
  categoryId,
  month,
  isIncome,
  selectedBarMonth,
  onBarClick,
}: HistoryChartProps) {
  const { data } = useCategoryHistory(categoryId, month);

  const chartData = useMemo(
    () =>
      (data?.history ?? []).map((h) => ({
        label: format(parseISO(`${h.month}-01`), 'MMM'),
        rawMonth: h.month,
        amount: h.amount / 100,
      })),
    [data],
  );

  const hasData = chartData.some((d) => d.amount > 0);
  const barColor = isIncome ? chartColors.positive : chartColors.negative;
  const monthLabels = useMemo(() => chartData.map((d) => d.label), [chartData]);
  const xAxis = useXAxisLayout({
    labels: monthLabels,
    kind: 'band',
    ordered: true,
    inset: { left: 50, right: 8 },
  });

  return (
    <div
      className="bg-surface rounded-lg shadow-card border border-border-light p-4"
      onClick={() => onBarClick(null)}
    >
      <h2 className="text-sm font-semibold text-text mb-3">Spending History</h2>
      {hasData ? (
        <div ref={xAxis.ref}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" axisLine={false} tickLine={false} {...xAxis.axisProps} />
              <YAxis
                tick={{ fontSize: 10, fill: chartColors.axis }}
                axisLine={false}
                tickLine={false}
                width={50}
                domain={[0, 'auto']}
                tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`)}
              />
              <Tooltip content={<ChartTooltip />} cursor={false} />
              <Bar
                dataKey="amount"
                fill={barColor}
                radius={[3, 3, 0, 0]}
                className="cursor-pointer"
                onClick={(entry: any, _index: number, e: React.MouseEvent) => {
                  e.stopPropagation();
                  const clickedMonth = entry.rawMonth as string;
                  onBarClick(clickedMonth === selectedBarMonth ? null : clickedMonth);
                }}
              >
                {chartData.map((entry) => (
                  <Cell
                    key={entry.rawMonth}
                    fill={barColor}
                    fillOpacity={
                      selectedBarMonth == null || entry.rawMonth === selectedBarMonth ? 1 : 0.35
                    }
                  />
                ))}
                <LabelList
                  dataKey="amount"
                  position="top"
                  formatter={(v: any) => `$${Math.round(Number(v))}`}
                  style={{ fontSize: 10, fontWeight: 600, fill: chartColors.label }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[200px] flex items-center justify-center">
          <p className="text-sm text-text-disabled">No history available</p>
        </div>
      )}
    </div>
  );
}

function BudgetWidget({
  budgeted,
  actual,
  remaining,
  month,
  isIncome,
}: {
  budgeted: number;
  actual: number;
  remaining: number;
  month: string;
  isIncome: boolean;
}) {
  const remColor = remaining > 0 ? 'text-positive' : remaining < 0 ? 'text-negative' : 'text-text';

  return (
    <div className="bg-surface rounded-lg shadow-card border border-border-light p-4">
      <h2 className="text-sm font-semibold text-text">Budget</h2>
      <p className="text-xs text-text-tertiary mt-0.5">
        {format(parseISO(`${month}-01`), 'MMMM yyyy')}
      </p>
      <div className="mt-3 border-t border-border-light pt-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">Planned</span>
          <span className="text-sm tabular-nums text-text">{formatCurrency(budgeted)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">Actual</span>
          <span className="text-sm tabular-nums text-text">{formatCurrency(actual)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">Remaining</span>
          <span className={`text-sm tabular-nums font-medium ${remColor}`}>
            {formatCurrency(remaining)}
          </span>
        </div>
      </div>
    </div>
  );
}

function SummaryWidget({
  transactions,
  isIncome,
}: {
  transactions: Transaction[];
  isIncome: boolean;
}) {
  const stats = useMemo(() => {
    if (transactions.length === 0) return null;

    const amounts = transactions.map((t) => Math.abs(t.amount));
    const total = amounts.reduce((s, a) => s + a, 0);
    const largest = Math.max(...amounts);
    const average = Math.round(total / amounts.length);
    const dates = transactions.map((t) => t.date).sort();

    return {
      count: transactions.length,
      largest,
      average,
      total,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
    };
  }, [transactions]);

  const rows = stats
    ? [
        { label: 'Total transactions', value: String(stats.count), isAmount: false },
        { label: 'Largest transaction', value: formatCurrency(stats.largest), isAmount: true },
        { label: 'Average transaction', value: formatCurrency(stats.average), isAmount: true },
        {
          label: `Total ${isIncome ? 'income' : 'spending'}`,
          value: formatCurrency(stats.total),
          isAmount: true,
        },
        {
          label: 'First transaction',
          value: format(parseISO(stats.firstDate), 'MMM d, yyyy'),
          isAmount: false,
        },
        {
          label: 'Last transaction',
          value: format(parseISO(stats.lastDate), 'MMM d, yyyy'),
          isAmount: false,
        },
      ]
    : [];

  return (
    <div className="bg-surface rounded-lg shadow-card border border-border-light p-4">
      <h2 className="text-sm font-semibold text-text mb-3">Summary</h2>
      {!stats ? (
        <p className="text-sm text-text-disabled py-6 text-center">No data</p>
      ) : (
        <div className="border-t border-border-light pt-3 space-y-2.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">{row.label}</span>
              <span className="text-sm tabular-nums text-text">{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CategoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const selectedMonth = useAppStore((s) => s.selectedMonth);
  const [selectedBarMonth, setSelectedBarMonth] = useState<string | null>(selectedMonth);

  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { data: budgetData } = useBudget(selectedMonth);
  const { data: historyData } = useCategoryHistory(id ?? null, selectedMonth);

  const txMonth = selectedBarMonth ?? undefined;
  const { data: transactions = [] } = useTransactions(
    id ? { categoryId: id, ...(txMonth ? { month: txMonth } : {}) } : {},
  );

  const cat = useMemo(() => {
    if (!budgetData || !id) return null;
    for (const group of budgetData) {
      const found = group.categories.find((c: any) => c.id === id);
      if (found) return { ...found, isIncome: !!group.isIncome };
    }
    return null;
  }, [budgetData, id]);

  const isIncome = historyData?.isIncome ?? cat?.isIncome ?? false;
  const categoryName = cat?.name ?? 'Category';

  const actual = cat ? (isIncome ? cat.balance : cat.spent) : 0;
  const rawRemaining = cat ? cat.budgeted - actual : 0;
  const remaining = isIncome ? Math.max(rawRemaining, 0) : rawRemaining;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-1.5 text-base">
          <Link
            to="/budget"
            className="font-semibold text-text hover:text-brand-600 transition-colors"
          >
            Budget
          </Link>
          <ChevronRight size={14} className="text-text-tertiary" />
          <span className="font-semibold text-text">
            {showCategoryIcons && cat?.icon ? `${cat.icon} ` : ''}
            {categoryName}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            {id && (
              <HistoryChart
                categoryId={id}
                month={selectedMonth}
                isIncome={isIncome}
                selectedBarMonth={selectedBarMonth}
                onBarClick={setSelectedBarMonth}
              />
            )}
          </div>
          <div>
            <BudgetWidget
              budgeted={cat?.budgeted ?? 0}
              actual={actual}
              remaining={remaining}
              month={selectedMonth}
              isIncome={isIncome}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-surface rounded-lg shadow-card border border-border-light overflow-hidden">
            {id && (
              <TransactionTable
                categoryId={id}
                month={txMonth}
                onClearMonth={() => setSelectedBarMonth(null)}
                overlayDetail
              />
            )}
          </div>
          <div>
            <SummaryWidget transactions={transactions} isIncome={isIncome} />
          </div>
        </div>
      </div>
    </div>
  );
}
