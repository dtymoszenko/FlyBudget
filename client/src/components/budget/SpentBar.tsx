/** How much of a category's plan is used: green, amber from 80%, red when over. */
export function SpentBar({
  spent,
  budgeted,
  isIncome,
  className = 'h-[3px] w-[90%] mt-1',
}: {
  spent: number;
  budgeted: number;
  isIncome?: boolean;
  className?: string;
}) {
  if (budgeted <= 0 && spent <= 0) return null;
  const effectiveBudget = Math.max(budgeted, 1);
  const ratio = spent / effectiveBudget;
  const fillWidth = Math.min(ratio * 100, 100);

  let color: string;
  if (isIncome || ratio < 0.8 || ratio === 1) {
    color = 'bg-positive';
  } else if (ratio < 1) {
    color = 'bg-caution';
  } else {
    color = 'bg-negative';
  }

  return (
    <div className={`${className} bg-surface-alt rounded-full overflow-hidden`}>
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${fillWidth.toFixed(1)}%` }}
      />
    </div>
  );
}
