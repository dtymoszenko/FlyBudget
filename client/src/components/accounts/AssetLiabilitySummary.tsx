import { useMemo } from 'react';
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
        alwaysShow={['investments', 'cash']}
      />
      <div className="border-t border-border-light my-4" />
      <Section
        title="Liabilities"
        buckets={LIABILITY_BUCKETS}
        sums={liabilities}
        alwaysShow={['credit']}
        owed
      />
    </div>
  );
}

interface SectionProps {
  title: string;
  buckets: Bucket[];
  sums: Map<AccountGroup, number>;
  /** Rows shown even with no accounts, so the card never looks empty */
  alwaysShow: AccountGroup[];
  /** Liabilities: balances are negative */
  owed?: boolean;
}

function Section({ title, buckets, sums, alwaysShow, owed = false }: SectionProps) {
  const rows = buckets.filter((b) => sums.has(b.group) || alwaysShow.includes(b.group));
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
