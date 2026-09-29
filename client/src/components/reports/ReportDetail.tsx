import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { Check, ChevronDown, Download, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { StatCard as StatTile } from '../ui/StatCard';
import {
  MAX_TREND_CATEGORIES,
  TOP_TREND_CATEGORIES,
  useDailyFlow,
  useIncomeVsExpenses,
  useNetWorth,
  useNetWorthSeries,
  useSpendingByCategory,
  useSpendingTrends,
  useTopSpendingCategories,
} from '../../hooks/useReports';
import { useAccounts } from '../../hooks/useAccounts';
import { useCategories } from '../../hooks/useCategories';
import { usePayees } from '../../hooks/usePayees';
import { useTransactions } from '../../hooks/useTransactions';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatCurrency } from '../../utils/currency';
import { downloadCsv } from '../../utils/exportCsv';
import { dayBounds, monthCount } from '../../utils/dateRange';
import { CALENDAR_MONTHS_MAX } from '../../utils/calendarLayout';
import { PayeeIcon } from '../payees/PayeeIcon';
import { TransactionCalendar } from './TransactionCalendar';
import { CATEGORY_COLORS } from '../../utils/chartColors';
import {
  IncomeExpensesChart,
  MonthlySpendingChart,
  NetWorthChart,
  SpendingChart,
  SpendingTrendsChart,
  categoryLabel,
  formatChange,
  netWorthChange,
} from './BuiltinCharts';
import { useSummaryCards } from './BuiltinReport';
import { EXPENSE_COLORS } from './ChartHelpers';
import type { StatCard } from './ChartHelpers';
import type { BuiltinWidgetType } from '../../types';

// The full view of every built-in report has the same parts, top to bottom: four headline
// figures, the chart, and a table of the numbers behind it (which is what Export CSV saves).

const TONE_CLASS = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-text-tertiary',
} as const;

const toneOf = (cents: number): StatCard['tone'] =>
  cents > 0 ? 'positive' : cents < 0 ? 'negative' : 'neutral';

const fullMonth = (month: string) => format(parseISO(`${month}-01`), 'MMM yyyy');
const percent = (part: number, whole: number) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—';

interface Column<R> {
  label: string;
  align?: 'left' | 'right';
  cell: (row: R, index: number) => React.ReactNode;
}

interface FooterRow {
  label: string;
  /** One cell per column after the first */
  cells: React.ReactNode[];
}

function BreakdownTable<R>({
  columns,
  rows,
  rowKey,
  footer = [],
  onRowClick,
  selectedKey,
  maxRows,
}: {
  columns: Column<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  footer?: FooterRow[];
  onRowClick?: (row: R) => void;
  selectedKey?: string | null;
  /** Show only this many rows until "Show all" is clicked */
  maxRows?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const align = (c: Column<R>) => (c.align === 'right' ? 'text-right' : 'text-left');
  const shown = maxRows && !showAll ? rows.slice(0, maxRows) : rows;
  if (!rows.length) {
    return (
      <p className="px-4 py-10 text-sm text-center text-text-tertiary">No data for this period.</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-alt border-y border-border">
          <tr>
            {columns.map((c) => (
              <th
                key={c.label}
                className={`px-4 py-2 text-xs font-medium text-text-tertiary whitespace-nowrap ${align(c)}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {shown.map((r, i) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick && (() => onRowClick(r))}
              className={`hover:bg-hover transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${
                selectedKey === rowKey(r) ? 'bg-brand-50' : ''
              }`}
            >
              {columns.map((c, ci) => (
                <td
                  key={c.label}
                  className={`px-4 py-2 whitespace-nowrap ${align(c)} ${
                    ci === 0 ? 'text-text' : 'tabular-nums text-text-secondary'
                  }`}
                >
                  {c.cell(r, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer.length > 0 && (
          <tfoot className="border-t border-border">
            {footer.map((f) => (
              <tr key={f.label}>
                <td className="px-4 py-2 font-semibold text-text">{f.label}</td>
                {f.cells.map((cell, i) => (
                  <td
                    key={i}
                    className={`px-4 py-2 font-semibold tabular-nums text-text whitespace-nowrap ${align(columns[i + 1])}`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tfoot>
        )}
      </table>
      {shown.length < rows.length && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full px-4 py-2.5 text-xs font-medium text-brand-600 hover:bg-hover border-t border-border-light cursor-pointer"
        >
          Show all {rows.length}
        </button>
      )}
    </div>
  );
}

/** A signed amount colored by sign, for net and change columns. */
function Signed({ cents, children }: { cents: number; children?: React.ReactNode }) {
  return <span className={TONE_CLASS[toneOf(cents)!]}>{children ?? formatCurrency(cents)}</span>;
}

function Swatch({ color }: { color?: string }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full mr-2 shrink-0 align-middle"
      style={{ background: color ?? 'var(--color-border)' }}
    />
  );
}

function ShareBar({ part, whole }: { part: number; whole: number }) {
  const pct = whole > 0 ? (part / whole) * 100 : 0;
  return (
    <span className="inline-flex items-center gap-2 justify-end">
      <span className="hidden sm:block w-16 h-1.5 rounded-full bg-surface-alt overflow-hidden">
        <span className="block h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-12 text-right">{percent(part, whole)}</span>
    </span>
  );
}

/** The layout every report detail shares. */
function DetailLayout({
  stats,
  loading,
  chartTitle,
  chartSubtitle,
  chartActions,
  chartHeight = 'h-80',
  chart,
  extra,
  tableTitle,
  table,
  onExport,
}: {
  stats: StatCard[];
  loading: boolean;
  chartTitle: string;
  chartSubtitle?: React.ReactNode;
  chartActions?: React.ReactNode;
  chartHeight?: string;
  chart: React.ReactNode;
  /** Shown between the chart and the table */
  extra?: React.ReactNode;
  tableTitle: string;
  table: React.ReactNode;
  onExport?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-[72px] bg-surface-alt rounded-lg animate-pulse" />
            ))
          : stats.map((s) => (
              <StatTile
                key={s.label}
                label={s.label}
                value={s.value}
                sub={s.sub}
                valueColor={s.tone ? TONE_CLASS[s.tone] : undefined}
              />
            ))}
      </div>

      <Card>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text">{chartTitle}</h3>
            {chartSubtitle && <p className="text-xs text-text-tertiary mt-0.5">{chartSubtitle}</p>}
          </div>
          {chartActions}
        </div>
        <div className={`w-full ${chartHeight}`}>{chart}</div>
      </Card>

      {extra}

      <Card padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <h3 className="text-sm font-semibold text-text">{tableTitle}</h3>
          {onExport && (
            <Button variant="secondary" size="sm" onClick={onExport}>
              <Download size={13} /> Export CSV
            </Button>
          )}
        </div>
        {table}
      </Card>
    </div>
  );
}

interface DetailProps {
  from: string;
  to: string;
}

const csvName = (type: BuiltinWidgetType, from: string, to: string) =>
  `report-${type}-${from}-to-${to}.csv`;

function SummaryDetail({ from, to }: DetailProps) {
  const { data = [], isLoading } = useIncomeVsExpenses(from, to);
  const stats = useSummaryCards(from, to);
  const rows = data.map((d) => ({
    month: d.month,
    income: d.income,
    expenses: -d.expenseNet,
    net: d.income + d.expenseNet,
    count: d.expenseCount,
  }));
  const sum = (key: 'income' | 'expenses' | 'net' | 'count') =>
    rows.reduce((s, r) => s + r[key], 0);
  const months = Math.max(rows.length, 1);
  const avg = (key: 'income' | 'expenses' | 'net') => Math.round(sum(key) / months);

  return (
    <DetailLayout
      loading={isLoading}
      stats={stats}
      chartTitle="Expenses by month"
      chartSubtitle="Spending net of refunds, against the monthly average"
      chart={<MonthlySpendingChart from={from} to={to} />}
      tableTitle="Monthly breakdown"
      onExport={() =>
        downloadCsv(
          csvName('summary', from, to),
          rows.map((r) => ({
            month: r.month,
            income_cents: r.income,
            expenses_cents: r.expenses,
            net_cents: r.net,
            transactions: r.count,
          })),
        )
      }
      table={
        <BreakdownTable
          rows={rows}
          rowKey={(r) => r.month}
          columns={[
            { label: 'Month', cell: (r) => fullMonth(r.month) },
            { label: 'Income', align: 'right', cell: (r) => formatCurrency(r.income) },
            { label: 'Expenses', align: 'right', cell: (r) => formatCurrency(r.expenses) },
            { label: 'Net', align: 'right', cell: (r) => <Signed cents={r.net} /> },
            { label: 'Transactions', align: 'right', cell: (r) => r.count },
          ]}
          footer={[
            {
              label: 'Total',
              cells: [
                formatCurrency(sum('income')),
                formatCurrency(sum('expenses')),
                <Signed cents={sum('net')} />,
                sum('count'),
              ],
            },
            {
              label: 'Monthly average',
              cells: [
                formatCurrency(avg('income')),
                formatCurrency(avg('expenses')),
                <Signed cents={avg('net')} />,
                Math.round(sum('count') / months),
              ],
            },
          ]}
        />
      }
    />
  );
}

function NetWorthDetail({ from, to }: DetailProps) {
  // The stats follow the chart (daily for short ranges); the table is always month by month
  const { data: series = [], isLoading } = useNetWorthSeries(from, to);
  const { data: monthly = [] } = useNetWorth(from, to);
  const change = netWorthChange(series);
  const last = series[series.length - 1];
  const stats: StatCard[] = [
    { label: 'Net Worth', value: formatCurrency(change?.latest ?? 0) },
    {
      label: 'Change',
      value: change ? formatChange(change.change, change.percent) : formatCurrency(0),
      tone: toneOf(change?.change ?? 0),
    },
    { label: 'Assets', value: formatCurrency(last?.assets ?? 0) },
    { label: 'Liabilities', value: formatCurrency(last?.liabilities ?? 0) },
  ];
  const rows = monthly.map((d, i) => ({
    ...d,
    change: i > 0 ? d.netWorth - monthly[i - 1].netWorth : null,
  }));

  return (
    <DetailLayout
      loading={isLoading}
      stats={stats}
      chartTitle="Net worth over time"
      chartSubtitle="Assets minus liabilities"
      chartHeight="h-96"
      chart={<NetWorthChart from={from} to={to} />}
      tableTitle="Month-end balances"
      onExport={() =>
        downloadCsv(
          csvName('net-worth', from, to),
          rows.map((r) => ({
            month: r.month,
            assets_cents: r.assets,
            liabilities_cents: r.liabilities,
            net_worth_cents: r.netWorth,
            change_cents: r.change ?? '',
          })),
        )
      }
      table={
        <BreakdownTable
          rows={rows}
          rowKey={(r) => r.month}
          columns={[
            { label: 'Month', cell: (r) => fullMonth(r.month) },
            { label: 'Assets', align: 'right', cell: (r) => formatCurrency(r.assets) },
            { label: 'Liabilities', align: 'right', cell: (r) => formatCurrency(r.liabilities) },
            {
              label: 'Net worth',
              align: 'right',
              cell: (r) => <span className="text-text">{formatCurrency(r.netWorth)}</span>,
            },
            {
              label: 'Change',
              align: 'right',
              cell: (r) =>
                r.change === null ? (
                  '—'
                ) : (
                  <Signed cents={r.change}>
                    {r.change > 0 ? '+' : ''}
                    {formatCurrency(r.change)}
                  </Signed>
                ),
            },
          ]}
        />
      }
    />
  );
}

function IncomeExpensesDetail({ from, to }: DetailProps) {
  const { data = [], isLoading } = useIncomeVsExpenses(from, to);
  const income = data.reduce((s, d) => s + d.income, 0);
  const expenses = data.reduce((s, d) => s + d.expenses, 0);
  const net = income - expenses;
  const months = Math.max(data.length, 1);
  const rate = (i: number, n: number) => (i > 0 ? `${Math.round((n / i) * 100)}%` : '—');
  const stats: StatCard[] = [
    { label: 'Income', value: formatCurrency(income), tone: 'positive' },
    { label: 'Expenses', value: formatCurrency(expenses), tone: 'negative' },
    { label: 'Net Savings', value: formatCurrency(net), tone: toneOf(net) },
    { label: 'Savings Rate', value: rate(income, net), tone: income > 0 ? toneOf(net) : undefined },
  ];

  return (
    <DetailLayout
      loading={isLoading}
      stats={stats}
      chartTitle="Income vs. expenses"
      chartSubtitle="Money in and out each month"
      chart={<IncomeExpensesChart from={from} to={to} />}
      tableTitle="Monthly breakdown"
      onExport={() =>
        downloadCsv(
          csvName('income-expenses', from, to),
          data.map((d) => ({
            month: d.month,
            income_cents: d.income,
            expenses_cents: d.expenses,
            net_cents: d.net,
          })),
        )
      }
      table={
        <BreakdownTable
          rows={data}
          rowKey={(r) => r.month}
          columns={[
            { label: 'Month', cell: (r) => fullMonth(r.month) },
            { label: 'Income', align: 'right', cell: (r) => formatCurrency(r.income) },
            { label: 'Expenses', align: 'right', cell: (r) => formatCurrency(r.expenses) },
            { label: 'Net', align: 'right', cell: (r) => <Signed cents={r.net} /> },
            { label: 'Savings rate', align: 'right', cell: (r) => rate(r.income, r.net) },
          ]}
          footer={[
            {
              label: 'Total',
              cells: [
                formatCurrency(income),
                formatCurrency(expenses),
                <Signed cents={net} />,
                rate(income, net),
              ],
            },
            {
              label: 'Monthly average',
              cells: [
                formatCurrency(Math.round(income / months)),
                formatCurrency(Math.round(expenses / months)),
                <Signed cents={Math.round(net / months)} />,
                '',
              ],
            },
          ]}
        />
      }
    />
  );
}

function SpendingDetail({ from, to }: DetailProps) {
  const showIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { data = [], isLoading } = useSpendingByCategory(from, to);
  const rows = useMemo(
    () =>
      [...data]
        .sort((a, b) => b.totalSpent - a.totalSpent)
        .map((d) => ({
          ...d,
          id: d.categoryId ?? 'uncategorized',
          label: categoryLabel({ name: d.categoryName, icon: d.categoryIcon }, showIcons),
        })),
    [data, showIcons],
  );
  const total = rows.reduce((s, r) => s + r.totalSpent, 0);
  const months = monthCount(from, to);
  const top = rows[0];
  const stats: StatCard[] = [
    { label: 'Total Spent', value: formatCurrency(total) },
    { label: 'Monthly Average', value: formatCurrency(Math.round(total / months)) },
    {
      label: 'Biggest Category',
      value: top ? formatCurrency(top.totalSpent) : '—',
      sub: top?.label,
    },
    { label: 'Categories', value: String(rows.length) },
  ];

  return (
    <DetailLayout
      loading={isLoading}
      stats={stats}
      chartTitle={rows.length > 10 ? 'Top 10 categories' : 'Spending by category'}
      chartSubtitle={rows.length > 10 ? 'Every category is listed in the table below' : undefined}
      chartHeight="h-96"
      chart={<SpendingChart from={from} to={to} />}
      tableTitle="All categories"
      onExport={() =>
        downloadCsv(
          csvName('spending', from, to),
          rows.map((r) => ({
            category: r.label,
            group: r.groupName ?? '',
            spent_cents: r.totalSpent,
            monthly_average_cents: Math.round(r.totalSpent / months),
          })),
        )
      }
      table={
        <BreakdownTable
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            {
              label: 'Category',
              // The chart colors its ten bars in this same order
              cell: (r, i) => (
                <span className="inline-flex items-center">
                  <Swatch
                    color={i < 10 ? CATEGORY_COLORS[i % CATEGORY_COLORS.length] : undefined}
                  />
                  {r.label}
                </span>
              ),
            },
            {
              label: 'Group',
              cell: (r) => <span className="text-text-secondary">{r.groupName ?? '—'}</span>,
            },
            { label: 'Spent', align: 'right', cell: (r) => formatCurrency(r.totalSpent) },
            {
              label: 'Monthly average',
              align: 'right',
              cell: (r) => formatCurrency(Math.round(r.totalSpent / months)),
            },
            {
              label: 'Share',
              align: 'right',
              cell: (r) => <ShareBar part={r.totalSpent} whole={total} />,
            },
          ]}
          footer={[
            {
              label: 'Total',
              cells: [
                '',
                formatCurrency(total),
                formatCurrency(Math.round(total / months)),
                '100%',
              ],
            },
          ]}
        />
      }
    />
  );
}

/** Pick up to MAX_TREND_CATEGORIES spending categories, or go back to the biggest ones. */
function TrendCategoryPicker({
  value,
  auto,
  onChange,
}: {
  value: string[];
  auto: boolean;
  onChange: (ids: string[] | undefined) => void;
}) {
  const showIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { data: groups = [] } = useCategories();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const expenseGroups = groups.filter((g) => g.isIncome === 0 && g.categories.length);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle(id: string) {
    const next = value.includes(id) ? value.filter((x) => x !== id) : [...value, id];
    onChange(next.length ? next : undefined);
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(!open)}>
        Categories ({value.length}) <ChevronDown size={12} />
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 max-h-[60vh] overflow-y-auto bg-surface rounded-md border border-border shadow-hover z-30 py-1">
          <button
            onClick={() => onChange(undefined)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-hover transition-colors cursor-pointer"
          >
            <span>
              <span className="block text-sm text-text">Biggest categories</span>
              <span className="block text-xs text-text-tertiary">
                The {TOP_TREND_CATEGORIES} with the most spending in the date range
              </span>
            </span>
            {auto && <Check size={14} className="text-brand-600 shrink-0" />}
          </button>
          <div className="border-t border-border-light my-1" />
          <p className="px-3 pt-1 pb-1 text-[11px] text-text-tertiary">
            Or choose up to {MAX_TREND_CATEGORIES}
          </p>
          {expenseGroups.map((g) => (
            <div key={g.id}>
              <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                {g.name}
              </p>
              {g.categories.map((c) => {
                const checked = value.includes(c.id);
                const full = !checked && value.length >= MAX_TREND_CATEGORIES;
                return (
                  <label
                    key={c.id}
                    className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
                      full
                        ? 'text-text-disabled cursor-not-allowed'
                        : 'text-text-secondary hover:bg-hover cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={full}
                      onChange={() => toggle(c.id)}
                      className="accent-brand-600"
                    />
                    {categoryLabel(c, showIcons)}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SpendingTrendsDetail({
  from,
  to,
  categoryIds,
  onCategoryIdsChange,
}: DetailProps & {
  categoryIds: string[] | undefined;
  onCategoryIdsChange: (ids: string[] | undefined) => void;
}) {
  const showIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const top = useTopSpendingCategories(from, to, TOP_TREND_CATEGORIES);
  const ids = categoryIds ?? top.ids;
  const { data: groups = [] } = useCategories();
  const { data: spending = [] } = useSpendingByCategory(from, to);
  const { data: trend = [], isLoading } = useSpendingTrends(ids, from, to);
  const months = monthCount(from, to);

  const rows = useMemo(() => {
    const byId = new Map(groups.flatMap((g) => g.categories).map((c) => [c.id, c]));
    return ids.map((id, i) => {
      const points = trend.filter((p) => p.categoryId === id);
      const total = points.reduce((s, p) => s + p.total, 0);
      const peak = points.reduce<(typeof points)[number] | null>(
        (best, p) => (!best || p.total > best.total ? p : best),
        null,
      );
      return {
        id,
        color: EXPENSE_COLORS[i % EXPENSE_COLORS.length],
        label: categoryLabel(byId.get(id), showIcons, 'Deleted category'),
        total,
        peak,
      };
    });
  }, [ids, trend, groups, showIcons]);
  const selected = rows.reduce((s, r) => s + r.total, 0);
  const allSpending = spending.reduce((s, d) => s + d.totalSpent, 0);
  const biggest = rows.reduce<(typeof rows)[number] | null>(
    (best, r) => (!best || r.total > best.total ? r : best),
    null,
  );
  const stats: StatCard[] = [
    { label: 'Total Spent', value: formatCurrency(selected) },
    { label: 'Monthly Average', value: formatCurrency(Math.round(selected / months)) },
    { label: 'Share of All Spending', value: percent(selected, allSpending) },
    {
      label: 'Biggest Category',
      value: biggest && biggest.total > 0 ? formatCurrency(biggest.total) : '—',
      sub: biggest && biggest.total > 0 ? biggest.label : undefined,
    },
  ];
  const auto = !categoryIds;

  return (
    <DetailLayout
      loading={top.isLoading || (ids.length > 0 && isLoading)}
      stats={stats}
      chartTitle="Spending over time"
      chartSubtitle={
        auto
          ? `Your ${ids.length === 1 ? 'biggest spending category' : `${ids.length} biggest spending categories`} in this period`
          : `${ids.length} chosen ${ids.length === 1 ? 'category' : 'categories'}`
      }
      chartActions={<TrendCategoryPicker value={ids} auto={auto} onChange={onCategoryIdsChange} />}
      chart={<SpendingTrendsChart from={from} to={to} categoryIds={ids} />}
      tableTitle="By category"
      onExport={() =>
        downloadCsv(
          csvName('spending-trends', from, to),
          [...trend]
            .sort((a, b) => a.month.localeCompare(b.month))
            .map((p) => ({
              month: p.month,
              category: rows.find((r) => r.id === p.categoryId)?.label ?? '',
              spent_cents: p.total,
            })),
        )
      }
      table={
        <BreakdownTable
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            {
              label: 'Category',
              cell: (r) => (
                <span className="inline-flex items-center">
                  <Swatch color={r.color} />
                  {r.label}
                </span>
              ),
            },
            { label: 'Spent', align: 'right', cell: (r) => formatCurrency(r.total) },
            {
              label: 'Monthly average',
              align: 'right',
              cell: (r) => formatCurrency(Math.round(r.total / months)),
            },
            {
              label: 'Highest month',
              align: 'right',
              cell: (r) =>
                r.peak ? `${formatCurrency(r.peak.total)} (${fullMonth(r.peak.month)})` : '—',
            },
            {
              label: 'Share of all spending',
              align: 'right',
              cell: (r) => <ShareBar part={r.total} whole={allSpending} />,
            },
          ]}
          footer={[
            {
              label: 'Total',
              cells: [
                formatCurrency(selected),
                formatCurrency(Math.round(selected / months)),
                '',
                percent(selected, allSpending),
              ],
            },
          ]}
        />
      }
    />
  );
}

/** Transactions on one day of the calendar, counted the same way (budget accounts, no transfers). */
function DayTransactions({ day, onClose }: { day: string; onClose: () => void }) {
  const showIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { data = [], isLoading } = useTransactions({ from: day, to: day, limit: 1000 });
  const { data: accounts = [] } = useAccounts();
  const { data: groups = [] } = useCategories();
  const { data: payees = [] } = usePayees();
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoriesById = useMemo(
    () => new Map(groups.flatMap((g) => g.categories).map((c) => [c.id, c])),
    [groups],
  );
  const logos = useMemo(() => new Map(payees.map((p) => [p.id, p.logo])), [payees]);
  const rows = data.filter(
    (t) => !t.transferTransactionId && accountsById.get(t.accountId)?.isOffBudget === 0,
  );
  const moneyIn = rows.reduce((s, t) => s + Math.max(t.amount, 0), 0);
  const moneyOut = rows.reduce((s, t) => s - Math.min(t.amount, 0), 0);

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-text">
            {format(parseISO(day), 'EEEE, MMMM d, yyyy')}
          </h3>
          <p className="text-xs text-text-tertiary mt-0.5 tabular-nums">
            {rows.length} {rows.length === 1 ? 'transaction' : 'transactions'}
            {moneyIn > 0 && <span className="text-positive"> · {formatCurrency(moneyIn)} in</span>}
            {moneyOut > 0 && (
              <span className="text-negative"> · {formatCurrency(moneyOut)} out</span>
            )}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-1.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>
      {isLoading ? (
        <div className="h-24 px-5 pb-4">
          <div className="h-full bg-surface-alt rounded animate-pulse" />
        </div>
      ) : (
        <BreakdownTable
          rows={rows}
          rowKey={(t) => t.id}
          columns={[
            {
              label: 'Payee',
              cell: (t) => (
                <span className="inline-flex items-center gap-2">
                  <PayeeIcon
                    name={t.payeeName ?? ''}
                    logo={t.payeeId ? logos.get(t.payeeId) : null}
                    size="sm"
                  />
                  {t.payeeName || <span className="text-text-tertiary">No payee</span>}
                </span>
              ),
            },
            {
              label: 'Category',
              cell: (t) => (
                <span className="text-text-secondary">
                  {t.isParent
                    ? `Split (${t.children?.length ?? 0})`
                    : t.categoryId
                      ? categoryLabel(categoriesById.get(t.categoryId), showIcons)
                      : 'Uncategorized'}
                </span>
              ),
            },
            {
              label: 'Account',
              cell: (t) => (
                <Link
                  to={`/accounts/${t.accountId}`}
                  className="text-text-secondary hover:text-brand-600 transition-colors"
                >
                  {accountsById.get(t.accountId)?.name ?? ''}
                </Link>
              ),
            },
            {
              label: 'Amount',
              align: 'right',
              cell: (t) =>
                t.amount > 0 ? (
                  <span className="text-positive">+{formatCurrency(t.amount)}</span>
                ) : (
                  <span className="text-text">{formatCurrency(t.amount)}</span>
                ),
            },
          ]}
        />
      )}
    </Card>
  );
}

function CalendarDetail({ from, to }: DetailProps) {
  const { data = [], isLoading } = useDailyFlow(from, to);
  const [selected, setSelected] = useState<string | null>(null);
  const dayRef = useRef<HTMLDivElement>(null);
  const moneyIn = data.reduce((s, d) => s + d.income, 0);
  const moneyOut = data.reduce((s, d) => s + d.expenses, 0);
  const net = moneyIn - moneyOut;
  // Days so far, from the first transaction ("All time" starts years early) up to today
  const bounds = dayBounds(from, to);
  if (data.length && data[0].date > bounds.from) bounds.from = data[0].date;
  const days = Math.max(
    0,
    differenceInCalendarDays(parseISO(bounds.to), parseISO(bounds.from)) + 1,
  );
  const stats: StatCard[] = [
    { label: 'Money In', value: formatCurrency(moneyIn), tone: 'positive' },
    { label: 'Money Out', value: formatCurrency(moneyOut), tone: 'negative' },
    { label: 'Net', value: formatCurrency(net), tone: toneOf(net) },
    {
      label: 'Daily Average Out',
      value: formatCurrency(days ? Math.round(moneyOut / days) : 0),
      sub: days ? `Over ${days} ${days === 1 ? 'day' : 'days'}` : undefined,
    },
  ];
  const rows = [...data].reverse();

  function select(day: string) {
    setSelected((cur) => (cur === day ? null : day));
    // Bring the day's transactions into view once they render
    requestAnimationFrame(() =>
      dayRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  }

  return (
    <DetailLayout
      loading={isLoading}
      stats={stats}
      chartTitle="Transaction calendar"
      chartSubtitle={
        monthCount(from, to) > CALENDAR_MONTHS_MAX
          ? 'Each day is colored by its net: green when more came in, red when more went out. Click a day to see its transactions.'
          : 'Green is money in, red is money out. Click a day to see its transactions.'
      }
      chartHeight=""
      chart={<TransactionCalendar from={from} to={to} selected={selected} onSelect={select} />}
      extra={
        selected && (
          <div ref={dayRef} className="scroll-mt-4">
            <DayTransactions day={selected} onClose={() => setSelected(null)} />
          </div>
        )
      }
      tableTitle="Days with transactions"
      onExport={() =>
        downloadCsv(
          csvName('calendar', from, to),
          data.map((d) => ({
            date: d.date,
            transactions: d.count,
            money_in_cents: d.income,
            money_out_cents: d.expenses,
            net_cents: d.income - d.expenses,
          })),
        )
      }
      table={
        <BreakdownTable
          rows={rows}
          rowKey={(r) => r.date}
          maxRows={31}
          selectedKey={selected}
          onRowClick={(r) => select(r.date)}
          columns={[
            { label: 'Date', cell: (r) => format(parseISO(r.date), 'EEE, MMM d, yyyy') },
            { label: 'Transactions', align: 'right', cell: (r) => r.count },
            { label: 'Money in', align: 'right', cell: (r) => formatCurrency(r.income) },
            { label: 'Money out', align: 'right', cell: (r) => formatCurrency(r.expenses) },
            { label: 'Net', align: 'right', cell: (r) => <Signed cents={r.income - r.expenses} /> },
          ]}
          footer={[
            {
              label: 'Total',
              cells: [
                data.reduce((s, d) => s + d.count, 0),
                formatCurrency(moneyIn),
                formatCurrency(moneyOut),
                <Signed cents={net} />,
              ],
            },
          ]}
        />
      }
    />
  );
}

/** The full view of a built-in report: headline figures, chart and breakdown table. */
export function ReportDetail({
  type,
  from,
  to,
  categoryIds,
  onCategoryIdsChange,
}: {
  type: BuiltinWidgetType;
  from: string;
  to: string;
  /** Spending Trends only: the chosen categories (undefined = the biggest ones) */
  categoryIds?: string[];
  onCategoryIdsChange: (ids: string[] | undefined) => void;
}) {
  switch (type) {
    case 'summary':
      return <SummaryDetail from={from} to={to} />;
    case 'net-worth':
      return <NetWorthDetail from={from} to={to} />;
    case 'income-expenses':
      return <IncomeExpensesDetail from={from} to={to} />;
    case 'spending':
      return <SpendingDetail from={from} to={to} />;
    case 'calendar':
      return <CalendarDetail from={from} to={to} />;
    case 'spending-trends':
      return (
        <SpendingTrendsDetail
          from={from}
          to={to}
          categoryIds={categoryIds}
          onCategoryIdsChange={onCategoryIdsChange}
        />
      );
  }
}
