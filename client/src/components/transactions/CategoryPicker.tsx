import { useState, useRef, useEffect } from 'react';
import { Search, Check, Plus, X } from 'lucide-react';
import { useCreateCategory } from '../../hooks/useCategories';
import { usePreferencesStore } from '../../store/preferencesStore';
import type { BudgetType, CategoryGroup } from '../../types';

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
  groups: CategoryGroup[];
  onClose: () => void;
  position?: 'below' | 'above';
}

export function CategoryPicker({ value, onChange, groups, onClose, position = 'below' }: Props) {
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGroupId, setNewGroupId] = useState(groups[0]?.id ?? '');
  const [newBudgetType, setNewBudgetType] = useState<BudgetType>('flexible');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const createCategory = useCreateCategory();
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const filtered = groups
    .map((g) => ({
      ...g,
      categories: g.categories.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())),
    }))
    .filter((g) => g.categories.length > 0);

  const selectedGroup = groups.find((g) => g.id === newGroupId);
  const isIncomeGroup = selectedGroup?.isIncome === 1;

  function handleCreate() {
    if (!newName.trim() || !newGroupId) return;
    createCategory.mutate(
      {
        groupId: newGroupId,
        name: newName.trim(),
        budgetType: isIncomeGroup ? null : newBudgetType,
      },
      {
        onSuccess: (created: { id: string }) => {
          onChange(created.id);
        },
      },
    );
  }

  return (
    <div
      ref={containerRef}
      className={`absolute left-0 z-50 w-64 bg-surface border border-border rounded-lg shadow-lg animate-menu-in ${position === 'above' ? 'bottom-full mb-1 origin-bottom-left' : 'top-full mt-1 origin-top-left'}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-2 border-b border-border-light">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
          />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search categories..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-surface text-text focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          />
        </div>
      </div>

      <div className="overflow-y-auto max-h-72">
        <button
          onClick={() => onChange(null)}
          className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-hover ${value === null ? 'bg-brand-50 text-brand-700' : 'text-text-secondary'}`}
        >
          <span className="italic">Uncategorized</span>
          {value === null && <Check size={14} className="text-brand-600 shrink-0" />}
        </button>

        {filtered.map((group) => (
          <div key={group.id}>
            <div className="px-3 py-1.5 text-xs font-medium text-text-tertiary bg-surface-alt">
              {group.name}
            </div>
            {group.categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => onChange(cat.id)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-hover ${value === cat.id ? 'bg-brand-50 text-brand-700' : 'text-text'}`}
              >
                {showCategoryIcons && cat.icon && <span className="text-base shrink-0">{cat.icon}</span>}
                <span className="truncate flex-1">{cat.name}</span>
                {value === cat.id && <Check size={14} className="text-brand-600 shrink-0" />}
              </button>
            ))}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="px-3 py-4 text-sm text-text-tertiary text-center">
            No categories found
          </div>
        )}
      </div>

      <div className="border-t border-border-light">
        {showCreate ? (
          <div className="p-3 space-y-2">
            <select
              value={newGroupId}
              onChange={(e) => setNewGroupId(e.target.value)}
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-surface text-text focus:border-brand-600 focus:outline-none"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            {!isIncomeGroup && (
              <div className="flex gap-1">
                {(
                  [
                    ['fixed', 'Fixed'],
                    ['flexible', 'Flexible'],
                    ['non_monthly', 'Non-Monthly'],
                  ] as [BudgetType, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setNewBudgetType(key)}
                    className={`flex-1 text-xs py-1 rounded border transition-colors ${
                      newBudgetType === key
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-surface text-text-secondary border-border hover:border-brand-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Category name"
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-surface text-text focus:border-brand-600 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || createCategory.isPending}
                className="flex-1 text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded px-2 py-1.5 disabled:opacity-50"
              >
                {createCategory.isPending ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => {
                  setShowCreate(false);
                  setNewName('');
                }}
                className="p-1.5 text-text-tertiary hover:text-text-secondary"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full px-3 py-2.5 text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1.5 hover:bg-hover"
          >
            <Plus size={14} />
            Create new category
          </button>
        )}
      </div>
    </div>
  );
}
