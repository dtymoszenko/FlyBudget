import { useMemo } from 'react';
import { useNetWorth, useIncomeVsExpenses, useSpendingByCategory } from '../../hooks/useReports';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCurrency } from '../../utils/currency';
import { downloadCsv } from '../../utils/exportCsv';
import { formatDateRange } from '../../utils/dateRange';
import {
  NetWorthChart,
  IncomeExpensesChart,
  SpendingChart,
  SpendingTrendsChart,
} from './BuiltinCharts';
import { StatCardRow } from './ChartHelpers';
import type { StatCard } from './ChartHelpers';
import type { BuiltinWidgetType } from '../../types';

export const BUILTIN_REPORTS: Record<BuiltinWidgetType, { label: string; description: string }> = {
  summary: { label: 'Summary', description: 'Income, expenses and averages' },
  'net-worth': { label: 'Net Worth', description: 'Assets, liabilities and net worth' },
  'income-expenses': { label: 'Income & Expenses', description: 'Monthly income vs. spending' },
  spending: { label: 'Spending by Category', description: 'Top 10 categories' },
  'spending-trends': { label: 'Spending Trends', description: 'Category spending over time' },
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
    const sub = formatDateRange({ preset: 'custom', from, to });
    const signedCard = (label: string, cents: number): StatCard => {
      const v = Math.round(cents);
      return {
        label,
        sub,
        value: formatCurrency(Math.abs(v)),
        tone: v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral',
      };
    };
    return [
      signedCard('Total Income', totalInc),
      signedCard('Total Expenses', expNet),
      signedCard('Avg Per Month', expNet / monthCount),
      signedCard('Avg Per Transaction', txCount > 0 ? expNet / txCount : 0),
    ];
  }, [ieData, from, to]);
}

const TONE_CLASS = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-text-tertiary',
};

/** The summary widget: four figures side by side, wrapping to two rows when narrow. */
function SummaryTiles({ from, to }: { from: string; to: string }) {
  const cards = useSummaryCards(from, to);
  return (
    <div className="h-full grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3 content-center">
      {cards.map((c) => (
        <div key={c.label} className="text-center">
          <p
            className={`text-xl font-semibold tabular-nums ${c.tone ? TONE_CLASS[c.tone] : 'text-text'}`}
          >
            {c.value}
          </p>
          <p className="text-xs text-text-secondary mt-1">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

/** Spending Trends on a dashboard shows the three biggest expense categories in the range. */
function TopSpendingTrends({ from, to }: { from: string; to: string }) {
  const { data: spData = [] } = useSpendingByCategory(from, to);
  const topCategoryIds = useMemo(
    () =>
      [...spData]
        .filter((d) => d.categoryId)
        .sort((a, b) => b.totalSpent - a.totalSpent)
        .slice(0, 3)
        .map((d) => d.categoryId!),
    [spData],
  );
  return <SpendingTrendsChart from={from} to={to} compact topCategoryIds={topCategoryIds} />;
}

/** A built-in report's chart. `compact` is the dashboard version; otherwise the full view. */
export function BuiltinReportChart({
  type,
  from,
  to,
  compact,
}: {
  type: BuiltinWidgetType;
  from: string;
  to: string;
  compact?: boolean;
}) {
  switch (type) {
    case 'summary':
      return compact ? (
        <SummaryTiles from={from} to={to} />
      ) : (
        <IncomeExpensesChart from={from} to={to} />
      );
    case 'net-worth':
      return <NetWorthChart from={from} to={to} />;
    case 'income-expenses':
      return <IncomeExpensesChart from={from} to={to} />;
    case 'spending':
      return <SpendingChart from={from} to={to} />;
    case 'spending-trends':
      return compact ? (
        <TopSpendingTrends from={from} to={to} />
      ) : (
        <SpendingTrendsChart from={from} to={to} />
      );
  }
}

/** Stat cards shown above a built-in report in its full view. */
export function BuiltinReportStats({
  type,
  from,
  to,
}: {
  type: BuiltinWidgetType;
  from: string;
  to: string;
}) {
  const summary = useSummaryCards(from, to);
  const { data: nwData = [] } = useNetWorth(from, to);
  const { data: ieData = [] } = useIncomeVsExpenses(from, to);
  const { data: spData = [] } = useSpendingByCategory(from, to);

  const cards = useMemo((): StatCard[] => {
    switch (type) {
      case 'summary':
        return summary;
      case 'net-worth': {
        if (!nwData.length) return [];
        const latest = nwData[nwData.length - 1].netWorth;
        const change = nwData.length > 1 ? latest - nwData[0].netWorth : 0;
        const sign = change >= 0 ? '+' : '';
        return [
          { label: 'Net Worth', value: formatCurrency(latest) },
          { label: 'Period Change', value: `${sign}${formatCurrency(change)}` },
        ];
      }
      case 'income-expenses': {
        const totalIncome = ieData.reduce((s, d) => s + d.income, 0);
        const totalExpenses = ieData.reduce((s, d) => s + d.expenses, 0);
        const net = totalIncome - totalExpenses;
        const rate = totalIncome > 0 ? Math.round((net / totalIncome) * 100) : 0;
        return [
          { label: 'Total Income', value: formatCurrency(totalIncome) },
          { label: 'Total Expenses', value: formatCurrency(totalExpenses) },
          { label: 'Net Savings', value: formatCurrency(net) },
          { label: 'Savings Rate', value: `${rate}%` },
        ];
      }
      case 'spending': {
        const totalSpent = spData.reduce((s, d) => s + d.totalSpent, 0);
        return [
          { label: 'Total Spent', value: formatCurrency(totalSpent) },
          { label: 'Categories', value: String(spData.length) },
        ];
      }
      case 'spending-trends':
        return [];
    }
  }, [type, summary, nwData, ieData, spData]);

  return <StatCardRow cards={cards} variant={type === 'summary' ? 'hero' : 'default'} />;
}

/** CSV export for a built-in report's full view, or null when the report has none. */
export function useBuiltinCsvExport(type: BuiltinWidgetType, from: string, to: string) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { data: nwData = [] } = useNetWorth(from, to);
  const { data: ieData = [] } = useIncomeVsExpenses(from, to);
  const { data: spData = [] } = useSpendingByCategory(from, to);
  const filename = `reports-${type}-${from}-${to}.csv`;

  switch (type) {
    case 'net-worth':
      return () =>
        downloadCsv(
          filename,
          nwData.map((d) => ({
            month: d.month,
            assets_cents: d.assets,
            liabilities_cents: d.liabilities,
            net_worth_cents: d.netWorth,
          })),
        );
    case 'summary':
    case 'income-expenses':
      return () =>
        downloadCsv(
          filename,
          ieData.map((d) => ({
            month: d.month,
            income_cents: d.income,
            expenses_cents: d.expenses,
            net_cents: d.net,
          })),
        );
    case 'spending':
      return () =>
        downloadCsv(
          filename,
          spData.map((d) => ({
            category: `${showCategoryIcons && d.categoryIcon ? d.categoryIcon + ' ' : ''}${d.categoryName ?? 'Uncategorized'}`,
            group: d.groupName ?? '',
            total_cents: d.totalSpent,
          })),
        );
    case 'spending-trends':
      return null;
  }
}
