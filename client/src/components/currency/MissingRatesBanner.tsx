import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { useCurrencySettings } from '../../hooks/useCurrency';

/**
 * Over the budget and reports: transactions in another currency whose day has no exchange
 * rate yet count as nothing there, so say so (with where to fix it) instead of showing a
 * total that's quietly short
 */
export function MissingRatesBanner({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
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
        {t('currency.missingRates', {
          count: missing.count,
          currencies: missing.currencies.join(', '),
          budget: data!.currency,
        })}
      </span>
      <Link to="/settings?tab=currencies" className="font-medium text-brand-600 hover:underline">
        {t('currency.addRate')}
      </Link>
    </div>
  );
}
