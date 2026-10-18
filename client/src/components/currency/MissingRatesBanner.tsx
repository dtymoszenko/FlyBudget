import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useCurrencySettings } from '../../hooks/useCurrency';

/**
 * Over the budget and reports: transactions in another currency whose day has no exchange
 * rate yet count as nothing there, so say so (with where to fix it) instead of showing a
 * total that's quietly short
 */
export function MissingRatesBanner({ className = '' }: { className?: string }) {
  const { data } = useCurrencySettings();
  const missing = data?.missing;
  if (!missing?.count) return null;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-caution/30 bg-caution-subtle px-3 py-2 text-sm text-text ${className}`}
    >
      <AlertTriangle size={15} className="shrink-0 text-caution" aria-hidden />
      <span>
        {missing.count} {missing.currencies.join(', ')} transaction{missing.count === 1 ? '' : 's'}{' '}
        {missing.count === 1 ? 'has' : 'have'} no {data!.currency} value yet: no exchange rate for{' '}
        {missing.count === 1 ? 'its' : 'their'} day.
      </span>
      <Link to="/settings?tab=currencies" className="font-medium text-brand-600 hover:underline">
        Add a rate
      </Link>
    </div>
  );
}
