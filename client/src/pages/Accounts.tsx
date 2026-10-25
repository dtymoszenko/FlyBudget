import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Landmark,
  Link2,
} from 'lucide-react';
import { useAccounts, useBalancesAgo } from '../hooks/useAccounts';
import { AddAccountModal } from '../components/accounts/AddAccountModal';
import { AssetLiabilitySummary } from '../components/accounts/AssetLiabilitySummary';
import { Button, ButtonLink } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useOpenFromLink } from '../hooks/useOpenFromLink';
import { docsUrl } from '../utils/project';
import { formatCurrency, formatMoney } from '../utils/currency';
import {
  balanceValue,
  earlierValue,
  totalValue,
  unconvertedCurrencies,
} from '../utils/accountMoney';
import { UnconvertedNote } from '../components/currency/UnconvertedNote';
import NetWorthMini from '../components/dashboard/NetWorthMini';
import { ACCOUNT_GROUPS, type Account, type AccountGroup } from '../types';
import { AccountIcon } from '../components/accounts/AccountIcon';
import { accountTypeInfo, accountTypeLabel } from '../utils/accountTypes';

type AccountSort = 'order' | 'balance' | 'name';

// Balance: biggest first by size (the largest debt too), accounts without a rate last
const size = (a: Account) => {
  const value = balanceValue(a);
  return value === null ? -1 : Math.abs(value);
};

const SORTS: Record<Exclude<AccountSort, 'order'>, (a: Account, b: Account) => number> = {
  balance: (a, b) => size(b) - size(a),
  name: (a, b) => a.name.localeCompare(b.name),
};

function groupAccountsByType(accounts: Account[], sort: AccountSort) {
  const groups = new Map<AccountGroup, Account[]>();
  const sorted = sort === 'order' ? accounts : [...accounts].sort(SORTS[sort]);
  for (const a of sorted) {
    const group = accountTypeInfo(a.type).group;
    const list = groups.get(group) ?? [];
    list.push(a);
    groups.set(group, list);
  }
  return ACCOUNT_GROUPS.filter((g) => groups.has(g.value)).map((g) => ({
    label: g.label,
    accounts: groups.get(g.value)!,
  }));
}

interface AccountGroupProps {
  label: string;
  accounts: Account[];
  balancesAgo: Record<string, number>;
}

function AccountGroup({ label, accounts, balancesAgo }: AccountGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  // In the budget's currency, at today's rate (so the change is the accounts', not the rate's)
  const groupTotal = totalValue(accounts);
  const groupTotalAgo = accounts.reduce((sum, a) => {
    const now = balanceValue(a) ?? 0;
    const ago = balancesAgo[a.id];
    return sum + (ago === undefined ? now : (earlierValue(a, ago) ?? now));
  }, 0);
  const missing = unconvertedCurrencies(accounts);
  const change = groupTotal - groupTotalAgo;
  const changePct = groupTotalAgo !== 0 ? (change / Math.abs(groupTotalAgo)) * 100 : 0;

  return (
    <Card padding="none">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={`w-full flex items-center justify-between px-5 py-3.5 hover:bg-hover transition-colors ${
          collapsed ? 'rounded-lg' : 'rounded-t-lg border-b border-border'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-text-tertiary">
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </span>
          <span className="text-base font-semibold text-text">{label}</span>
          {change !== 0 && (
            <span
              className={`flex items-center gap-1 text-xs tabular-nums ${change >= 0 ? 'text-positive' : 'text-negative'}`}
            >
              {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {change >= 0 ? '+' : ''}
              {formatCurrency(change)} ({Math.abs(changePct).toFixed(1)}%)
            </span>
          )}
          <span className="text-xs text-text-tertiary">past month</span>
        </div>
        <span className="text-right">
          <span
            className={`block text-base font-semibold tabular-nums ${groupTotal < 0 ? 'text-negative' : 'text-text'}`}
          >
            {formatCurrency(groupTotal)}
          </span>
          <UnconvertedNote currencies={missing} link={false} />
        </span>
      </button>
      {!collapsed && (
        <div className="divide-y divide-border-light">
          {accounts.map((account) => (
            <div
              key={account.id}
              onClick={() => navigate(`/accounts/${account.id}`)}
              className="flex items-center justify-between px-5 py-4 hover:bg-hover cursor-pointer group transition-colors last:rounded-b-lg"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-3 min-w-0">
                  <AccountIcon
                    name={account.name}
                    type={account.type}
                    logo={account.logo}
                    size="md"
                  />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-text truncate block">
                      {account.name}
                    </span>
                    <span className="text-xs text-text-tertiary mt-0.5 block">
                      {accountTypeLabel(account.type)}
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-right">
                <span className="block text-sm font-medium tabular-nums text-text">
                  {formatMoney(account.balance, account.currency)}
                </span>
                {account.rateDate && account.mainBalance !== null && (
                  <span className="block text-xs tabular-nums text-text-tertiary">
                    ≈ {formatCurrency(account.mainBalance)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function AccountsPage() {
  const { data: accounts = [], isLoading } = useAccounts();
  const { data: balancesAgo = {} } = useBalancesAgo();
  const [addOpen, setAddOpen] = useState(false);
  useOpenFromLink('add', () => setAddOpen(true));
  const [sort, setSort] = useState<AccountSort>('order');
  const allGroups = useMemo(() => groupAccountsByType(accounts, sort), [accounts, sort]);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-surface">
        <div className="px-6 py-4 border-b border-border shrink-0">
          <div className="h-5 w-32 bg-surface-alt rounded animate-pulse" />
        </div>
        <div className="p-6 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-surface-alt rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 py-4 border-b border-border shrink-0 flex items-center justify-between gap-2 max-md:flex-wrap">
        <h1 className="text-lg font-semibold text-text">Accounts</h1>
        <div className="flex items-center gap-2">
          {accounts.length > 1 && (
            <select
              aria-label="Sort accounts"
              value={sort}
              onChange={(e) => setSort(e.target.value as AccountSort)}
              className="text-sm border border-border rounded-md px-3 py-1.5 max-md:min-h-11 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
            >
              <option value="order">Your order</option>
              <option value="balance">Balance</option>
              <option value="name">Name</option>
            </select>
          )}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add Account
          </Button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="flex-1 flex items-center justify-center overflow-y-auto">
          <EmptyState
            icon={<Landmark size={26} />}
            title="Add the accounts you want to track"
            description="Checking, savings, credit cards, loans, investments or your home: each account keeps its own balance and transactions, and together they make up your net worth."
            learnMoreHref={docsUrl('accounts')}
            actions={
              <>
                <Button onClick={() => setAddOpen(true)}>
                  <Plus size={14} /> Add your first account
                </Button>
                <ButtonLink variant="secondary" to="/settings?tab=connections">
                  <Link2 size={14} /> Connect a bank
                </ButtonLink>
              </>
            }
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 pt-5 pb-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Card>
                <NetWorthMini />
              </Card>
              <Card>
                <AssetLiabilitySummary accounts={accounts} />
              </Card>
            </div>
          </div>

          <div className="px-6 pb-6 space-y-4">
            {allGroups.map((g) => (
              <AccountGroup
                key={g.label}
                label={g.label}
                accounts={g.accounts}
                balancesAgo={balancesAgo}
              />
            ))}
          </div>
        </div>
      )}

      <AddAccountModal isOpen={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
