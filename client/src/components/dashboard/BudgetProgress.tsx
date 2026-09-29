import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format, parse } from 'date-fns';
import { useBudget } from '../../hooks/useBudget';
import { formatCurrency } from '../../utils/currency';
import { Wallet } from 'lucide-react';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ButtonLink } from '../ui/Button';
import { docsUrl } from '../../utils/project';
import type { BudgetType } from '../../types';

interface Props {
  currentMonth: string;
}

function getStatus(spent: number, planned: number): 'over' | 'warning' | 'healthy' {
  if (spent > planned) return 'over';
  if (spent >= planned * 0.8) return 'warning';
  return 'healthy';
}

export default function BudgetProgress({ currentMonth }: Props) {
  const { data: groups = [], isLoading } = useBudget(currentMonth);

  const monthLabel = useMemo(
    () => format(parse(currentMonth, 'yyyy-MM', new Date()), 'MMMM yyyy'),
    [currentMonth],
  );

  const groupStats = useMemo(() => {
    const types: { key: BudgetType; name: string }[] = [
      { key: 'fixed', name: 'Fixed' },
      { key: 'flexible', name: 'Flexible' },
      { key: 'non_monthly', name: 'Non-Monthly' },
    ];
    const allCats = groups.filter((g) => !g.isIncome).flatMap((g) => g.categories);
    return types
      .map((t) => ({
        id: t.key,
        name: t.name,
        planned: allCats.filter((c) => c.budgetType === t.key).reduce((s, c) => s + c.budgeted, 0),
        spent: allCats.filter((c) => c.budgetType === t.key).reduce((s, c) => s + c.spent, 0),
      }))
      .filter((g) => g.planned > 0);
  }, [groups]);

  if (isLoading) {
    return (
      <Card>
        <div className="h-5 w-40 bg-surface-alt rounded animate-pulse mb-6" />
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div
                className="h-4 bg-surface-alt rounded animate-pulse mb-2"
                style={{ width: `${50 + i * 15}%` }}
              />
              <div className="h-2 bg-surface-alt rounded-full animate-pulse mb-1" />
              <div className="h-3 bg-surface-alt rounded animate-pulse w-24" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold text-text">Budget</h3>
          <Link to="/budget" className="text-sm text-text-tertiary hover:text-text-secondary">
            {monthLabel}
          </Link>
        </div>
      </div>

      {groupStats.length === 0 ? (
        <EmptyState
          compact
          icon={<Wallet size={20} />}
          title={`No budget for ${monthLabel} yet`}
          description="Set how much you plan to spend in each category, then watch your progress here."
          learnMoreHref={docsUrl('budgeting')}
          actions={
            <ButtonLink size="sm" to="/budget">
              Plan your budget
            </ButtonLink>
          }
        />
      ) : (
        <div className="divide-y divide-border-light">
          {groupStats.map((g) => {
            const remaining = g.planned - g.spent;
            const status = getStatus(g.spent, g.planned);
            const ratio = Math.min(g.spent / g.planned, 1);

            return (
              <div key={g.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-text">{g.name}</span>
                  <span className="text-sm text-text-tertiary tabular-nums">
                    {formatCurrency(g.planned)} planned
                  </span>
                </div>

                <div className="h-2.5 w-full bg-surface-alt rounded-full overflow-hidden flex">
                  {status === 'over' ? (
                    <div className="h-full w-full bg-negative rounded-full" />
                  ) : status === 'warning' ? (
                    <>
                      <div
                        className="h-full bg-positive rounded-l-full"
                        style={{ width: `${(ratio * 100).toFixed(1)}%` }}
                      />
                      <div
                        className="h-full bg-caution rounded-r-full"
                        style={{ width: `${((1 - ratio) * 100).toFixed(1)}%` }}
                      />
                    </>
                  ) : (
                    <div
                      className="h-full bg-positive rounded-full"
                      style={{ width: `${(ratio * 100).toFixed(1)}%` }}
                    />
                  )}
                </div>

                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-text-tertiary tabular-nums">
                    {formatCurrency(g.spent)} spent
                  </span>
                  <span
                    className={`text-sm font-medium tabular-nums ${
                      status === 'over'
                        ? 'text-negative'
                        : status === 'warning'
                          ? 'text-caution'
                          : 'text-positive'
                    }`}
                  >
                    {status === 'over' ? '-' : ''}
                    {formatCurrency(Math.abs(remaining))} remaining
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
