import { usePreferencesStore } from '../../store/preferencesStore';
import type { Account, CategoryGroup } from '../../types';

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
  groups: CategoryGroup[];
  accounts?: Account[];
  currentAccountId?: string;
  className?: string;
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
  label = 'Category',
}: Props) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const transferAccounts = accounts?.filter((a) => a.id !== currentAccountId && !a.closedAt) ?? [];

  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={`block w-full bg-transparent text-sm text-text focus:outline-none ${className}`}
    >
      <option value="">Uncategorized</option>
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
        <optgroup label="Transfer">
          {transferAccounts.map((a) => (
            <option key={a.id} value={`transfer:${a.id}`}>
              Transfer: {a.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
