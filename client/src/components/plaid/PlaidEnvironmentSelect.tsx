import { useTranslation } from 'react-i18next';

export type PlaidEnvironment = 'production' | 'sandbox';

// Plaid's free tier ("limited Production") connects real banks; Sandbox only has test data.
export function PlaidEnvironmentSelect({
  value,
  onChange,
}: {
  value: PlaidEnvironment;
  onChange: (value: PlaidEnvironment) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="block text-xs font-medium text-text-tertiary mb-1">
        {t('banks.plaid.environment.label')}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PlaidEnvironment)}
        className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
      >
        <option value="production">{t('banks.plaid.environment.production')}</option>
        <option value="sandbox">{t('banks.plaid.environment.sandbox')}</option>
      </select>
      <p className="text-[11px] text-text-tertiary mt-1">{t('banks.plaid.environment.hint')}</p>
    </div>
  );
}
