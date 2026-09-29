import { ACCOUNT_GROUPS, ACCOUNT_TYPES, type AccountType } from '../../types';
import { accountTypeInfo } from '../../utils/accountTypes';

interface Props {
  value: AccountType;
  onChange: (type: AccountType) => void;
}

/** Account type picker grouped into Cash, Credit, Investments, Property, Loans and Other */
export function AccountTypeSelect({ value, onChange }: Props) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-secondary mb-1">Account Type</label>
      <select
        aria-label="Account type"
        value={value}
        onChange={(e) => onChange(e.target.value as AccountType)}
        className="block w-full rounded-lg border border-border px-3 py-2 text-sm bg-surface text-text focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        {ACCOUNT_GROUPS.map((g) => (
          <optgroup key={g.value} label={g.label}>
            {ACCOUNT_TYPES.filter((t) => t.group === g.value).map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="mt-1 text-xs text-text-tertiary">{accountTypeInfo(value).hint}</p>
    </div>
  );
}
