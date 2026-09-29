import { useMemo } from 'react';
import { format, subMonths } from 'date-fns';
import { useBudget } from '../../hooks/useBudget';
import { useIncomeVsExpenses } from '../../hooks/useReports';
import { formatCurrency } from '../../utils/currency';
import { StatCard } from '../ui/StatCard';
import { monthsToAverage } from '../../utils/reportSummary';
import { usePreferencesStore } from '../../store/preferencesStore';

interface Props {
  currentMonth: string;
  sixMonthsAgo: string;
}

const GOAL_OPTIONS = [10, 15, 20, 25, 30];

export default function SummaryStats({ currentMonth }: Props) {
  const twelveMonthsAgo = useMemo(() => format(subMonths(new Date(), 11), 'yyyy-MM'), []);
  const savingsGoal = usePreferencesStore((s) => s.savingsGoal);
  const setSavingsGoal = usePreferencesStore((s) => s.setSavingsGoal);

  const { data: budgetData = [], isLoading: budgetLoading } = useBudget(currentMonth);
  const { data: ieData = [], isLoading: ieLoading } = useIncomeVsExpenses(
    twelveMonthsAgo,
    currentMonth,
  );

  const isLoading = budgetLoading || ieLoading;

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[72px] bg-surface-alt rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  const expenseCats = budgetData.filter((g) => g.isIncome === 0).flatMap((g) => g.categories);

  const totalBudgeted = expenseCats.reduce((sum, c) => sum + c.budgeted, 0);
  const totalSpent = expenseCats.reduce((sum, c) => sum + Math.abs(c.spent), 0);
  const leftToSpend = totalBudgeted - totalSpent;
  const spentPct = totalBudgeted > 0 ? totalSpent / totalBudgeted : 0;

  const ltsColor =
    spentPct > 1 ? 'text-negative' : spentPct >= 0.8 ? 'text-caution' : 'text-positive';

  // Only months since the budget's first income or spending (not the full 12 before it)
  const monthCount = monthsToAverage(ieData);
  const avgIncome = Math.round(ieData.reduce((sum, p) => sum + p.income, 0) / monthCount);
  const avgExpenses = Math.round(ieData.reduce((sum, p) => sum + p.expenses, 0) / monthCount);
  const savingsRate = avgIncome > 0 ? Math.round(((avgIncome - avgExpenses) / avgIncome) * 100) : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {totalBudgeted > 0 ? (
        <StatCard label="Left to Spend" value={formatCurrency(leftToSpend)} valueColor={ltsColor} />
      ) : (
        <StatCard label="Left to Spend" value="—" sub="No budget set this month" />
      )}
      <StatCard
        label="Avg Monthly Income"
        value={formatCurrency(avgIncome)}
        valueColor={avgIncome > 0 ? 'text-positive' : undefined}
      />
      <StatCard
        label="Avg Monthly Expenses"
        value={formatCurrency(avgExpenses)}
        valueColor={avgExpenses > 0 ? 'text-negative' : undefined}
      />
      <div className="bg-surface-alt rounded-lg px-4 py-3 border border-border-light">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-text-tertiary">Savings Rate</p>
          <select
            value={savingsGoal}
            onChange={(e) => setSavingsGoal(Number(e.target.value))}
            className="text-[10px] border border-border rounded px-1 py-0.5 bg-surface text-text-secondary cursor-pointer focus:outline-none"
          >
            {GOAL_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {g}% goal
              </option>
            ))}
          </select>
        </div>
        {avgIncome > 0 ? (
          <p
            className={`text-lg font-semibold tabular-nums mt-0.5 ${savingsRate >= savingsGoal ? 'text-positive' : 'text-negative'}`}
          >
            {savingsRate}%
          </p>
        ) : (
          <>
            <p className="text-lg font-semibold tabular-nums mt-0.5 text-text">—</p>
            <p className="text-xs text-text-tertiary mt-0.5">Shown once you have income</p>
          </>
        )}
      </div>
    </div>
  );
}
