import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useCategories } from '../../hooks/useCategories';
import { usePreferencesStore } from '../../store/preferencesStore';

interface Props {
  selectedCategoryIds: string[];
  selectedGroupIds: string[];
  onChange: (categoryIds: string[], groupIds: string[]) => void;
}

export default function CategoryTreePicker({
  selectedCategoryIds,
  selectedGroupIds,
  onChange,
}: Props) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { data: groups = [] } = useCategories();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const allSelected = selectedCategoryIds.length === 0 && selectedGroupIds.length === 0;

  function toggleExpand(groupId: string) {
    const next = new Set(expanded);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    setExpanded(next);
  }

  function selectAll() {
    onChange([], []);
  }

  function toggleGroup(groupId: string) {
    if (allSelected) {
      const allGroupIds = groups.filter((g) => g.id !== groupId).map((g) => g.id);
      onChange([], allGroupIds);
    } else if (selectedGroupIds.includes(groupId)) {
      onChange(
        selectedCategoryIds,
        selectedGroupIds.filter((id) => id !== groupId),
      );
    } else {
      onChange(selectedCategoryIds, [...selectedGroupIds, groupId]);
    }
  }

  function toggleCategory(catId: string) {
    if (allSelected) {
      const allCatIds = groups
        .flatMap((g) => g.categories)
        .filter((c) => c.id !== catId)
        .map((c) => c.id);
      onChange(allCatIds, []);
    } else if (selectedCategoryIds.includes(catId)) {
      onChange(
        selectedCategoryIds.filter((id) => id !== catId),
        selectedGroupIds,
      );
    } else {
      onChange([...selectedCategoryIds, catId], selectedGroupIds);
    }
  }

  function isGroupChecked(groupId: string) {
    if (allSelected) return true;
    return selectedGroupIds.includes(groupId);
  }

  function isCatChecked(catId: string) {
    if (allSelected) return true;
    return selectedCategoryIds.includes(catId);
  }

  return (
    <div className="space-y-0.5">
      <button
        onClick={selectAll}
        className={`text-xs px-1.5 py-0.5 rounded ${allSelected ? 'text-brand-600 font-medium' : 'text-text-tertiary hover:text-text-secondary'}`}
      >
        {allSelected ? 'All selected' : 'Select all'}
      </button>
      {groups.map((g) => (
        <div key={g.id}>
          <div className="flex items-center gap-1 py-0.5">
            <button
              type="button"
              onClick={() => toggleExpand(g.id)}
              aria-label={`${g.name} categories`}
              aria-expanded={expanded.has(g.id)}
              className="text-text-tertiary hover:text-text-secondary p-0.5"
            >
              {expanded.has(g.id) ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isGroupChecked(g.id)}
                onChange={() => toggleGroup(g.id)}
                className="rounded border-border text-brand-600 focus:ring-brand-600"
              />
              <span className="text-sm font-medium text-text-secondary">{g.name}</span>
            </label>
          </div>
          {expanded.has(g.id) && (
            <div className="ml-6 space-y-0.5">
              {g.categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 py-0.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isCatChecked(c.id)}
                    onChange={() => toggleCategory(c.id)}
                    className="rounded border-border text-brand-600 focus:ring-brand-600"
                  />
                  <span className="text-sm text-text-secondary">
                    {showCategoryIcons && c.icon ? `${c.icon} ` : ''}
                    {c.name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
