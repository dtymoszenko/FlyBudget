import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useCategories } from '../../hooks/useCategories';
import { usePreferencesStore } from '../../store/preferencesStore';
import { CategoryPicker } from './CategoryPicker';
import { selectorInputClass } from './MerchantSelect';
import type { CategoryGroup } from '../../types';

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
  position?: 'below' | 'above';
  placeholder?: string;
}

/** Category field from the Add transaction workflow: a button that opens the searchable CategoryPicker. */
export function CategorySelectButton({
  value,
  onChange,
  position = 'below',
  placeholder = 'Search categories...',
}: Props) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { data: groups = [] } = useCategories();
  const [open, setOpen] = useState(false);

  const entry = useMemo(() => {
    if (!value) return null;
    for (const g of groups as CategoryGroup[]) {
      const cat = g.categories.find((c) => c.id === value);
      if (cat) return { name: cat.name, icon: cat.icon };
    }
    return null;
  }, [value, groups]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`${selectorInputClass} text-left flex items-center justify-between cursor-pointer`}
      >
        <span className="flex items-center gap-2 truncate">
          {entry ? (
            <>
              {showCategoryIcons && entry.icon && <span className="text-base">{entry.icon}</span>}
              <span className="text-text">{entry.name}</span>
            </>
          ) : (
            <span className="text-text-disabled">{placeholder}</span>
          )}
        </span>
        <ChevronDown size={14} className="text-text-tertiary shrink-0" />
      </button>
      {open && (
        <CategoryPicker
          value={value}
          onChange={(id) => {
            onChange(id);
            setOpen(false);
          }}
          groups={groups as CategoryGroup[]}
          onClose={() => setOpen(false)}
          position={position}
        />
      )}
    </div>
  );
}
