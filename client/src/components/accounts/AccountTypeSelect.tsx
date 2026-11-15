import { useTranslation } from 'react-i18next';
import { ACCOUNT_GROUPS, ACCOUNT_TYPES, type AccountType } from '../../types';
import { accountTypeInfo } from '../../utils/accountTypes';

interface Props {
  value: AccountType;
  onChange: (type: AccountType) => void;
}

/** Account type picker grouped into Cash, Credit, Investments, Property, Loans and Other */
export function AccountTypeSelect({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="block text-sm font-medium text-text-secondary mb-1">
        {t('accounts.form.type')}
      </label>
      <select
        aria-label={t('accounts.form.typeLabel')}
        value={value}
        onChange={(e) => onChange(e.target.value as AccountType)}
        className="block w-full rounded-lg border border-border px-3 py-2 text-sm bg-surface text-text focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        {ACCOUNT_GROUPS.map((group) => (
          <optgroup key={group} label={t(`accounts.groups.${group}`)}>
            {ACCOUNT_TYPES.filter((type) => type.group === group).map((type) => (
              <option key={type.value} value={type.value}>
                {t(`accounts.types.${type.value}.label`)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="mt-1 text-xs text-text-tertiary">
        {t(`accounts.types.${accountTypeInfo(value).value}.hint`)}
      </p>
    </div>
  );
}
