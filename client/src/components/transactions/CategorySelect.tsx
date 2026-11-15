import { usePreferencesStore } from '../../store/preferencesStore';
import type { Account, CategoryGroup } from '../../types';
import { useTranslation } from 'react-i18next';

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
  groups: CategoryGroup[];
  accounts?: Account[];
  currentAccountId?: string;
  className?: string;
  /** Replaces the field's own styling (the phone sheet uses full input styling, 16px text) */
  fieldClassName?: string;
  /** Accessible name; defaults to "Category" */
  label?: string;
}

export function CategorySelect({
  value,
  onChange,
  groups,
  accounts,
  currentAccountId,
  className = '',
  fieldClassName,
  label,
}: Props) {
  const { t } = useTranslation();
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const transferAccounts = accounts?.filter((a) => a.id !== currentAccountId && !a.closedAt) ?? [];

  return (
    <select
      aria-label={label ?? t('transactions.categorySelect.label')}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={
        fieldClassName ??
        `block w-full bg-transparent text-sm text-text focus:outline-none ${className}`
      }
    >
      <option value="">{t('transactions.categorySelect.uncategorized')}</option>
      {groups.map((g) => (
        <optgroup key={g.id} label={g.name}>
          {g.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {showCategoryIcons && c.icon ? `${c.icon} ` : ''}
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
      {transferAccounts.length > 0 && (
        <optgroup label={t('transactions.categorySelect.transfer')}>
          {transferAccounts.map((a) => (
            <option key={a.id} value={`transfer:${a.id}`}>
              {t('transactions.categorySelect.transferTo', { name: a.name })}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
