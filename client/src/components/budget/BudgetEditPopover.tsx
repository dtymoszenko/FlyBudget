import { useState, useEffect, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, LabelList, ResponsiveContainer } from 'recharts';
import { useCategoryHistory } from '../../hooks/useBudget';
import { formatCurrency } from '../../utils/currency';
import { chartColors } from '../../utils/chartColors';
import { useXAxisLayout } from '../../hooks/useXAxisLayout';

interface BudgetEditPopoverProps {
  categoryId: string;
  isIncome: boolean;
  currentAmount: number;
  month: string;
  onApplyBulk: (cents: number) => void;
}

export function BudgetEditPopover({
  categoryId,
  isIncome,
  currentAmount,
  month,
  onApplyBulk,
}: BudgetEditPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [checked, setChecked] = useState(true);
  const { data } = useCategoryHistory(categoryId, month);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        const input = ref.current.previousElementSibling as HTMLElement | null;
        if (input && input.contains(e.target as Node)) return;
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const chartData = (data?.history ?? []).map((h) => ({
    month: format(parseISO(`${h.month}-01`), 'MMM'),
    amount: h.amount / 100,
  }));

  const hasData = chartData.some((d) => d.amount > 0);
  const barColor = isIncome ? chartColors.positive : chartColors.negative;
  const xAxis = useXAxisLayout({
    labels: chartData.map((d) => d.month),
    kind: 'band',
    ordered: true,
    fontSize: 10,
    inset: { left: 30, right: 2 },
  });

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg shadow-card border border-border-light bg-surface p-4 origin-top-right animate-menu-in"
      onMouseDown={(e) => e.preventDefault()}
    >
      <p className="text-sm font-semibold text-text mb-2">History</p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-surface-alt rounded-lg p-2.5">
          <p className="text-sm font-semibold tabular-nums text-text">
            {formatCurrency(data?.lastMonth ?? 0)}
          </p>
          <p className="text-xs text-text-tertiary">{isIncome ? 'Earned' : 'Spent'} last month</p>
        </div>
        <div className="bg-surface-alt rounded-lg p-2.5">
          <p className="text-sm font-semibold tabular-nums text-text">
            {formatCurrency(data?.average ?? 0)}
          </p>
          <p className="text-xs text-text-tertiary">Monthly average</p>
        </div>
      </div>

      <div className="bg-surface-alt rounded-lg p-3 mb-3">
        {hasData ? (
          <div ref={xAxis.ref}>
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={chartData} margin={{ top: 14, right: 2, left: -10, bottom: 0 }}>
                <XAxis dataKey="month" axisLine={false} tickLine={false} {...xAxis.axisProps} />
                <YAxis
                  tick={{ fontSize: 9, fill: chartColors.axis }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  domain={[0, 'auto']}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
                  }
                />
                <Bar dataKey="amount" fill={barColor} radius={[3, 3, 0, 0]}>
                  <LabelList
                    dataKey="amount"
                    position="top"
                    formatter={(v) => `$${Math.round(Number(v))}`}
                    style={{ fontSize: 9, fontWeight: 600, fill: chartColors.label }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-text-disabled text-center py-6">No history available</p>
        )}
      </div>

      <button
        type="button"
        className="flex items-center gap-2 text-sm text-text cursor-pointer w-full text-left"
        onClick={() => {
          const next = !checked;
          setChecked(next);
          if (next) onApplyBulk(currentAmount);
        }}
      >
        <span
          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${checked ? 'bg-brand-600 border-brand-600' : 'border-border'}`}
        >
          {checked && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path
                d="M1 4L3.5 6.5L9 1"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        Apply {formatCurrency(currentAmount)} to all future months
      </button>
    </div>
  );
}
