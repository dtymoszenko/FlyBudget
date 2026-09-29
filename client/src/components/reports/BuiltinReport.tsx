import { useMemo } from 'react';
import {
  TOP_TREND_CATEGORIES,
  useIncomeVsExpenses,
  useTopSpendingCategories,
} from '../../hooks/useReports';
import { formatCurrency } from '../../utils/currency';
import {
  NetWorthChart,
  IncomeExpensesChart,
  SpendingChart,
  SpendingTrendsChart,
} from './BuiltinCharts';
import { TransactionCalendar } from './TransactionCalendar';
import { ChartSkeleton } from './ChartHelpers';
import type { StatCard } from './ChartHelpers';
import type { BuiltinWidgetType } from '../../types';

export const BUILTIN_REPORTS: Record<BuiltinWidgetType, { label: string; description: string }> = {
  summary: { label: 'Summary', description: 'Income, expenses and monthly averages' },
  'net-worth': { label: 'Net Worth', description: 'Assets, liabilities and net worth over time' },
  'income-expenses': {
    label: 'Income & Expenses',
    description: 'Money in vs. money out each month',
  },
  spending: { label: 'Spending by Category', description: 'Where your money went, by category' },
  'spending-trends': {
    label: 'Spending Trends',
    description: 'How spending in your biggest categories changes over time',
  },
  calendar: { label: 'Transaction Calendar', description: 'Money in and out on each day' },
};

export const BUILTIN_TYPES = Object.keys(BUILTIN_REPORTS) as BuiltinWidgetType[];

/** Signed totals, colored by sign: >0 green, <0 red, 0 neutral. */
export function useSummaryCards(from: string, to: string): StatCard[] {
  const { data: ieData = [] } = useIncomeVsExpenses(from, to);
  return useMemo(() => {
    const totalInc = ieData.reduce((s, d) => s + d.income, 0);
    const expNet = ieData.reduce((s, d) => s + d.expenseNet, 0);
    const txCount = ieData.reduce((s, d) => s + d.expenseCount, 0);
    const monthCount = Math.max(ieData.length, 1);
    const signedCard = (label: string, cents: number): StatCard => {
      const v = Math.round(cents);
      return {
        label,
        value: formatCurrency(Math.abs(v)),
        tone: v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral',
      };
    };
    return [
      signedCard('Total Income', totalInc),
      signedCard('Total Expenses', expNet),
      signedCard('Avg Monthly Expenses', expNet / monthCount),
      signedCard('Avg Per Transaction', txCount > 0 ? expNet / txCount : 0),
    ];
  }, [ieData]);
}

const TONE_CLASS = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-text-tertiary',
};

/**
 * The summary widget: four figures in a row next to the title on a wide card (the card is the
 * @container, see WidgetCard), two by two under it otherwise.
 */
function SummaryTiles({ from, to }: { from: string; to: string }) {
  const cards = useSummaryCards(from, to);
  return (
    <div className="h-full grid grid-cols-2 @4xl:grid-cols-4 gap-x-3 gap-y-2 content-center">
      {cards.map((c) => (
        <div key={c.label} className="text-center min-w-0">
          {/* A size down on narrow cards (a phone), so "$12,345.67" fits two to a row */}
          <p
            className={`text-lg @sm:text-xl font-semibold tabular-nums break-words ${c.tone ? TONE_CLASS[c.tone] : 'text-text'}`}
          >
            {c.value}
          </p>
          <p className="text-xs text-text-secondary mt-1">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Spending Trends on a dashboard: the widget's chosen categories, or else the
 * TOP_TREND_CATEGORIES with the most spending in the range.
 */
function DashboardSpendingTrends({
  from,
  to,
  categoryIds,
}: {
  from: string;
  to: string;
  categoryIds?: string[];
}) {
  const top = useTopSpendingCategories(from, to, TOP_TREND_CATEGORIES);
  const ids = categoryIds ?? top.ids;
  if (!categoryIds && top.isLoading) return <ChartSkeleton />;
  const caption = categoryIds
    ? undefined
    : ids.length === 1
      ? 'Biggest spending category'
      : `${ids.length} biggest spending categories`;
  return <SpendingTrendsChart from={from} to={to} categoryIds={ids} caption={caption} />;
}

/** A built-in report as its dashboard widget shows it (the full view is in ReportDetail). */
export function BuiltinReportChart({
  type,
  from,
  to,
  categoryIds,
}: {
  type: BuiltinWidgetType;
  from: string;
  to: string;
  /** Spending Trends: the categories to chart (undefined = the biggest ones) */
  categoryIds?: string[];
}) {
  switch (type) {
    case 'summary':
      return <SummaryTiles from={from} to={to} />;
    case 'net-worth':
      return <NetWorthChart from={from} to={to} headline />;
    case 'income-expenses':
      return <IncomeExpensesChart from={from} to={to} />;
    case 'spending':
      return <SpendingChart from={from} to={to} />;
    case 'calendar':
      return <TransactionCalendar from={from} to={to} fit />;
    case 'spending-trends':
      return <DashboardSpendingTrends from={from} to={to} categoryIds={categoryIds} />;
  }
}
