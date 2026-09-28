import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAccounts } from '../../hooks/useAccounts';
import { formatCurrency } from '../../utils/currency';
import { Card } from '../ui/Card';
import { accountTypeInfo, isLiabilityType } from '../../utils/accountTypes';
import { ACCOUNT_GROUPS, type Account, type AccountGroup } from '../../types';

export default function AccountsOverview() {
  const { data: accounts = [], isLoading } = useAccounts();

  const grouped = useMemo(() => {
    const open = accounts.filter((a) => !a.closedAt);
    const groups = new Map<AccountGroup, Account[]>();
    for (const a of open) {
      const group = accountTypeInfo(a.type).group;
      const list = groups.get(group) || [];
      list.push(a);
      groups.set(group, list);
    }
    return ACCOUNT_GROUPS.filter((g) => groups.has(g.value)).map((g) => ({
      type: g.value,
      label: g.label,
      accounts: groups.get(g.value)!,
    }));
  }, [accounts]);

  const totals = useMemo(() => {
    const open = accounts.filter((a) => !a.closedAt);
    const assets = open.filter((a) => !isLiabilityType(a.type)).reduce((s, a) => s + a.balance, 0);
    const liabilities = open
      .filter((a) => isLiabilityType(a.type))
      .reduce((s, a) => s - a.balance, 0);
    return { assets, liabilities };
  }, [accounts]);

  if (isLoading) {
    return (
      <Card>
        <div className="h-5 w-32 bg-surface-alt rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-5 bg-surface-alt rounded animate-pulse"
              style={{ width: `${80 - i * 10}%` }}
            />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text">Accounts</h3>
        <Link to="/accounts" className="text-xs text-brand-600 hover:text-brand-700 font-medium">
          View all
        </Link>
      </div>

      <div className="space-y-4">
        {grouped.map((g) => (
          <div key={g.type}>
            <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">
              {g.label}
            </p>
            <div className="divide-y divide-border-light">
              {g.accounts.map((a) => (
                <Link
                  key={a.id}
                  to={`/accounts/${a.id}`}
                  className="flex items-center justify-between py-1.5 hover:bg-hover transition-colors -mx-2 px-2 rounded"
                >
                  <span className="text-sm text-text-secondary">{a.name}</span>
                  <span
                    className={`text-sm font-medium tabular-nums ${a.balance < 0 ? 'text-negative' : 'text-text'}`}
                  >
                    {formatCurrency(a.balance)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-border space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-text-tertiary">Assets</span>
          <span className="font-medium tabular-nums text-text">
            {formatCurrency(totals.assets)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-tertiary">Liabilities</span>
          <span className="font-medium tabular-nums text-negative">
            {formatCurrency(-totals.liabilities)}
          </span>
        </div>
      </div>
    </Card>
  );
}
