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

  // The categories the filters include (the server applies both lists); every click
  // turns that into a list of categories, so a group is just a shortcut for its own
  const selected = new Set(
    groups.flatMap((g) =>
      g.categories
        .filter(
          (c) =>
            (!selectedCategoryIds.length || selectedCategoryIds.includes(c.id)) &&
            (!selectedGroupIds.length || selectedGroupIds.includes(g.id)),
        )
        .map((c) => c.id),
    ),
  );
  const total = groups.reduce((n, g) => n + g.categories.length, 0);

  function emit(next: Set<string>) {
    // An empty list means all categories, so the last one can't be unticked
    if (!next.size) return;
    onChange(next.size === total ? [] : [...next], []);
  }

  function selectAll() {
    onChange([], []);
  }

  function toggleGroup(groupId: string) {
    const ids = groups.find((g) => g.id === groupId)?.categories.map((c) => c.id) ?? [];
    const next = new Set(selected);
    const all = ids.every((id) => next.has(id));
    for (const id of ids) {
      if (all) next.delete(id);
      else next.add(id);
    }
    emit(next);
  }

  function toggleCategory(catId: string) {
    const next = new Set(selected);
    if (next.has(catId)) next.delete(catId);
    else next.add(catId);
    emit(next);
  }

  function groupState(groupId: string) {
    const ids = groups.find((g) => g.id === groupId)?.categories.map((c) => c.id) ?? [];
    const count = ids.filter((id) => selected.has(id)).length;
    return { checked: count === ids.length, partly: count > 0 && count < ids.length };
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
                checked={groupState(g.id).checked}
                ref={(el) => {
                  if (el) el.indeterminate = groupState(g.id).partly;
                }}
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
                    checked={selected.has(c.id)}
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
