import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../../utils/currency';
import { chartColors } from '../../utils/chartColors';
import { accountTypeInfo } from '../../utils/accountTypes';
import type { Account, AccountGroup } from '../../types';

interface Bucket {
  group: AccountGroup;
  label: string;
  color: string;
}

const ASSET_BUCKETS: Bucket[] = [
  { group: 'investments', label: 'Investments', color: '#7C3AED' },
  { group: 'cash', label: 'Cash', color: chartColors.positive },
  { group: 'property', label: 'Property', color: '#0891B2' },
  { group: 'other', label: 'Other', color: '#78716C' },
];

const LIABILITY_BUCKETS: Bucket[] = [
  { group: 'credit', label: 'Credit', color: chartColors.negative },
  { group: 'loans', label: 'Loans', color: '#EA580C' },
  { group: 'other', label: 'Other', color: '#9F1239' },
];

interface Props {
  accounts: Account[];
}

export function AssetLiabilitySummary({ accounts }: Props) {
  const { assets, liabilities } = useMemo(() => {
    // Sums per group, and which groups have any accounts at all
    const assetSums = new Map<AccountGroup, number>();
    const liabilitySums = new Map<AccountGroup, number>();
    for (const a of accounts) {
      const info = accountTypeInfo(a.type);
      const sums = info.liability ? liabilitySums : assetSums;
      sums.set(info.group, (sums.get(info.group) ?? 0) + a.balance);
    }
    return { assets: assetSums, liabilities: liabilitySums };
  }, [accounts]);

  return (
    <div>
      <Section
        title="Assets"
        buckets={ASSET_BUCKETS}
        sums={assets}
        emptyText="No bank accounts, investments or property yet."
      />
      <div className="border-t border-border-light my-4" />
      <Section
        title="Liabilities"
        buckets={LIABILITY_BUCKETS}
        sums={liabilities}
        emptyText="No credit cards or loans yet."
        owed
      />
    </div>
  );
}

interface SectionProps {
  title: string;
  buckets: Bucket[];
  sums: Map<AccountGroup, number>;
  /** Shown when there are no accounts on this side at all */
  emptyText: string;
  /** Liabilities: balances are negative */
  owed?: boolean;
}

/**
 * One side of the balance sheet. Only groups with accounts are listed: a "$0" row for a
 * group you haven't added would read as "you have none", not "not tracked yet".
 */
function Section({ title, buckets, sums, emptyText, owed = false }: SectionProps) {
  const rows = buckets.filter((b) => sums.has(b.group));
  const total = rows.reduce((s, b) => s + (sums.get(b.group) ?? 0), 0);
  // Bar widths use magnitudes; a bucket on the "wrong" side (overpaid card) gets no width
  const sign = owed ? -1 : 1;
  const barTotal = rows.reduce((s, b) => s + Math.max(sign * (sums.get(b.group) ?? 0), 0), 0);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-text">{title}</span>
        <span className="text-sm font-semibold tabular-nums text-text">
          {formatCurrency(total)}
        </span>
      </div>

      {barTotal > 0 && (
        <div className="h-3 flex rounded-full overflow-hidden mt-2">
          {rows.map((b) => {
            const value = Math.max(sign * (sums.get(b.group) ?? 0), 0);
            if (value === 0) return null;
            return (
              <div
                key={b.group}
                className="h-full"
                style={{ width: `${(value / barTotal) * 100}%`, backgroundColor: b.color }}
              />
            );
          })}
        </div>
      )}

      {rows.length === 0 && (
        <p className="mt-2 text-sm text-text-tertiary">
          {emptyText}{' '}
          <Link
            to="/accounts?add=1"
            className="font-medium text-brand-600 hover:text-brand-700 whitespace-nowrap"
          >
            Add account
          </Link>
        </p>
      )}

      <div className="mt-3 space-y-1.5">
        {rows.map((b) => (
          <div key={b.group} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: b.color }}
              />
              <span className="text-sm text-text-secondary">{b.label}</span>
            </div>
            <span className="text-sm tabular-nums text-text">
              {formatCurrency(sums.get(b.group) ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
