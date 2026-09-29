interface Props {
  className?: string;
  /** Color of "Budget": the page's text color by default (black, or white in dark mode) */
  budgetClassName?: string;
  /** Color of "Fly" */
  flyClassName?: string;
}

/** The FlyBudget wordmark: "Fly" in the brand blue, "Budget" in the text color */
export function BrandName({
  className = '',
  budgetClassName = 'text-text',
  flyClassName = 'text-brand-600',
}: Props) {
  return (
    <span className={className}>
      <span className={flyClassName}>Fly</span>
      <span className={budgetClassName}>Budget</span>
    </span>
  );
}
