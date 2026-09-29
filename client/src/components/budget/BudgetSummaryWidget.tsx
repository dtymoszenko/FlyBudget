import { useState } from 'react';
import { formatCurrency } from '../../utils/currency';

interface ExpenseBreakdown {
  planned: number;
  spent: number;
}

interface BudgetSummaryWidgetProps {
  toBeBudgeted: number;
  carryOver: number;
  incomePlanned: number;
  incomeEarned: number;
  expensesPlanned: number;
  expensesSpent: number;
  savingsPlanned: number;
  savingsContributed: number;
  fixedExpenses?: ExpenseBreakdown;
  flexibleExpenses?: ExpenseBreakdown;
  nonMonthlyExpenses?: ExpenseBreakdown;
}

function getHeroStyle(tbb: number, incomePlanned: number) {
  if (tbb < 0) return { bg: 'bg-negative-subtle', text: 'text-negative', label: 'Over budget' };
  if (tbb === 0)
    return { bg: 'bg-positive-subtle', text: 'text-positive', label: 'Fully budgeted' };
  const threshold = Math.max(incomePlanned * 0.02, 500);
  if (tbb <= threshold)
    return { bg: 'bg-caution-subtle', text: 'text-caution', label: 'Almost budgeted' };
  return { bg: 'bg-positive-subtle', text: 'text-positive', label: 'Left to budget' };
}

function getBarColor(actual: number, planned: number, type: 'income' | 'expenses' | 'savings') {
  if (type === 'income' || type === 'savings') return 'bg-positive';
  if (planned <= 0) return actual > 0 ? 'bg-negative' : 'bg-positive';
  return actual > planned ? 'bg-negative' : 'bg-positive';
}

interface SummarySectionProps {
  label: string;
  planned: number;
  actual: number;
  actualLabel: string;
  type: 'income' | 'expenses' | 'savings';
}

function SummarySection({ label, planned, actual, actualLabel, type }: SummarySectionProps) {
  const rawRemaining = planned - actual;
  const displayRemaining = type === 'income' ? Math.max(rawRemaining, 0) : rawRemaining;
  const ratio =
    type === 'income' ? (actual > 0 ? 1 : 0) : planned > 0 ? Math.min(actual / planned, 1) : 0;
  const barColor = getBarColor(actual, planned, type);
  const remainingColor =
    type === 'income'
      ? displayRemaining === 0
        ? 'text-text-tertiary'
        : 'text-positive'
      : displayRemaining >= 0
        ? 'text-positive'
        : 'text-negative';

  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-text">{label}</span>
        <span className="text-sm tabular-nums text-text-tertiary">
          {formatCurrency(planned)} planned
        </span>
      </div>

      <div className="h-3 w-full bg-surface-alt rounded-full overflow-hidden mt-2">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${(ratio * 100).toFixed(1)}%` }}
        />
      </div>

      <div className="flex justify-between mt-2">
        <div className="flex flex-col">
          <span className="text-sm font-semibold tabular-nums text-text">
            {formatCurrency(actual)}
          </span>
          <span className="text-xs text-text-tertiary">{actualLabel}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className={`text-sm font-medium tabular-nums ${remainingColor}`}>
            {displayRemaining === 0 ? '$0' : formatCurrency(displayRemaining)}
          </span>
          <span className="text-xs text-text-tertiary">remaining</span>
        </div>
      </div>
    </div>
  );
}

type Tab = 'summary' | 'income' | 'expenses';

const TABS: { key: Tab; label: string }[] = [
  { key: 'summary', label: 'Summary' },
  { key: 'income', label: 'Income' },
  { key: 'expenses', label: 'Expenses' },
];

export function BudgetSummaryWidget({
  toBeBudgeted,
  carryOver,
  incomePlanned,
  incomeEarned,
  expensesPlanned,
  expensesSpent,
  savingsPlanned,
  savingsContributed,
  fixedExpenses,
  flexibleExpenses,
  nonMonthlyExpenses,
}: BudgetSummaryWidgetProps) {
  const [activeTab, setActiveTab] = useState<Tab>('summary');
  const hero = getHeroStyle(toBeBudgeted, incomePlanned);

  return (
    <div className="rounded-lg shadow-card border border-border-light overflow-hidden bg-surface">
      <div className="p-3">
        <div
          role="status"
          aria-label="To be budgeted"
          className={`${hero.bg} rounded-lg px-4 py-3 text-center`}
        >
          <p className={`text-lg font-semibold tabular-nums ${hero.text}`}>
            {formatCurrency(toBeBudgeted)}
          </p>
          <p className={`text-xs ${hero.text} mt-0.5 opacity-75`}>{hero.label}</p>
        </div>
      </div>

      <div className="flex justify-center gap-4 px-4 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`pb-1.5 text-xs transition-colors border-b-2 ${
              activeTab === tab.key
                ? 'border-text text-text font-semibold'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="px-4 pb-2">
        {activeTab === 'summary' && (
          <div>
            <SummarySection
              label="Income"
              planned={incomePlanned}
              actual={incomeEarned}
              actualLabel="earned"
              type="income"
            />
            <div className="border-t border-border-light" />
            <SummarySection
              label="Expenses"
              planned={expensesPlanned}
              actual={expensesSpent}
              actualLabel="spent"
              type="expenses"
            />
            {savingsPlanned > 0 && (
              <>
                <div className="border-t border-border-light" />
                <SummarySection
                  label="Save up"
                  planned={savingsPlanned}
                  actual={savingsContributed}
                  actualLabel="contributed"
                  type="savings"
                />
              </>
            )}
          </div>
        )}
        {activeTab === 'income' && (
          <SummarySection
            label="Income"
            planned={incomePlanned}
            actual={incomeEarned}
            actualLabel="earned"
            type="income"
          />
        )}
        {activeTab === 'expenses' && (
          <div>
            {fixedExpenses && (fixedExpenses.planned > 0 || fixedExpenses.spent > 0) && (
              <SummarySection
                label="Fixed"
                planned={fixedExpenses.planned}
                actual={fixedExpenses.spent}
                actualLabel="spent"
                type="expenses"
              />
            )}
            {flexibleExpenses && (flexibleExpenses.planned > 0 || flexibleExpenses.spent > 0) && (
              <>
                {fixedExpenses && (fixedExpenses.planned > 0 || fixedExpenses.spent > 0) && (
                  <div className="border-t border-border-light" />
                )}
                <SummarySection
                  label="Flexible"
                  planned={flexibleExpenses.planned}
                  actual={flexibleExpenses.spent}
                  actualLabel="spent"
                  type="expenses"
                />
              </>
            )}
            {nonMonthlyExpenses &&
              (nonMonthlyExpenses.planned > 0 || nonMonthlyExpenses.spent > 0) && (
                <>
                  <div className="border-t border-border-light" />
                  <SummarySection
                    label="Non-Monthly"
                    planned={nonMonthlyExpenses.planned}
                    actual={nonMonthlyExpenses.spent}
                    actualLabel="spent"
                    type="expenses"
                  />
                </>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
