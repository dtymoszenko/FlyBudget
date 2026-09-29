import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Eye, Pencil } from 'lucide-react';
import { SpentBar } from './SpentBar';
import { BudgetAmountSheet } from './BudgetAmountSheet';
import { usePreferencesStore } from '../../store/preferencesStore';
import { useCanSave } from '../../hooks/useConnection';
import { formatCurrency } from '../../utils/currency';
import { categoryFigures, isActiveCategory } from '../../utils/budgetFigures';
import type { BudgetCategory } from '../../types';

export interface PhoneBudgetSection {
  key: string;
  label: string;
  isIncome: boolean;
  categories: BudgetCategory[];
}

interface Props {
  sections: PhoneBudgetSection[];
  month: string;
  onSave: (categoryId: string, cents: number) => void;
  onApplyBulk: (categoryId: string, cents: number) => void;
  /** Nothing is planned this month yet: list every category, so there's something to plan */
  showAll?: boolean;
}

/**
 * The budget on a phone: a card per category (planned, actual, remaining) instead of the
 * four-column table. Tapping the planned amount opens a sheet to change it.
 */
export function PhoneBudget({ sections, month, onSave, onApplyBulk, showAll = false }: Props) {
  const [editing, setEditing] = useState<{ cat: BudgetCategory; isIncome: boolean } | null>(null);

  return (
    <div>
      {sections.map((section) => (
        <Section
          key={section.key}
          section={section}
          showAll={showAll}
          onEdit={(cat) => setEditing({ cat, isIncome: section.isIncome })}
        />
      ))}
      <BudgetAmountSheet
        category={editing?.cat ?? null}
        isIncome={editing?.isIncome ?? false}
        month={month}
        onClose={() => setEditing(null)}
        onSave={onSave}
        onApplyBulk={onApplyBulk}
      />
    </div>
  );
}

function Section({
  section,
  showAll,
  onEdit,
}: {
  section: PhoneBudgetSection;
  showAll: boolean;
  onEdit: (cat: BudgetCategory) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const { isIncome, categories } = section;
  const active = categories.filter((c) => isActiveCategory(c, isIncome));
  const inactiveCount = categories.length - active.length;
  const visible = showInactive || showAll ? categories : active;
  const planned = categories.reduce((s, c) => s + c.budgeted, 0);
  const actual = categories.reduce((s, c) => s + categoryFigures(c, isIncome).actual, 0);

  return (
    <section aria-label={section.label} className="border-b border-border">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="w-full min-h-11 flex items-center gap-2 px-4 py-2 bg-surface-alt text-left"
      >
        {collapsed ? (
          <ChevronRight size={16} className="text-text-tertiary" aria-hidden />
        ) : (
          <ChevronDown size={16} className="text-text-tertiary" aria-hidden />
        )}
        <span className="flex-1 text-sm font-semibold text-text">{section.label}</span>
        <span className="text-xs text-text-tertiary tabular-nums">
          {formatCurrency(actual)} of {formatCurrency(planned)}
        </span>
      </button>
      {!collapsed && (
        <>
          {visible.map((cat) => (
            <CategoryCard key={cat.id} cat={cat} isIncome={isIncome} onEdit={() => onEdit(cat)} />
          ))}
          {inactiveCount > 0 && !showAll && (
            <button
              type="button"
              onClick={() => setShowInactive((s) => !s)}
              className="w-full min-h-11 flex items-center gap-1.5 px-4 text-sm text-text-tertiary"
            >
              <Eye size={14} aria-hidden />
              {showInactive ? 'Hide' : 'Show'} {inactiveCount} inactive{' '}
              {inactiveCount === 1 ? 'category' : 'categories'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function CategoryCard({
  cat,
  isIncome,
  onEdit,
}: {
  cat: BudgetCategory;
  isIncome: boolean;
  onEdit: () => void;
}) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const canSave = useCanSave();
  const { actual, remaining } = categoryFigures(cat, isIncome);
  const pill =
    remaining > 0 ? 'bg-positive/20' : remaining < 0 ? 'bg-negative/20' : 'bg-surface-alt';

  return (
    <div className="px-4 py-3 border-t border-border-light bg-surface" data-testid="budget-card">
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate text-[15px] font-medium text-text">
          {showCategoryIcons && cat.icon ? `${cat.icon} ` : ''}
          {cat.name}
        </span>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-medium tabular-nums text-text ${pill}`}
        >
          {formatCurrency(remaining)}
          <span className="sr-only"> remaining</span>
        </span>
      </div>
      <SpentBar
        spent={actual}
        budgeted={cat.budgeted}
        isIncome={isIncome}
        className="h-1.5 w-full mt-2"
      />
      <div className="mt-1 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onEdit}
          disabled={!canSave}
          aria-label={`Planned for ${cat.name}: ${formatCurrency(cat.budgeted)}`}
          className="min-h-11 flex items-center gap-1.5 text-left disabled:opacity-50"
        >
          <span className="grid">
            <span className="text-xs text-text-tertiary">Planned</span>
            <span className="text-sm font-medium tabular-nums text-text">
              {formatCurrency(cat.budgeted)}
            </span>
          </span>
          <Pencil size={13} className="text-text-tertiary" aria-hidden />
        </button>
        <Link
          to={`/budget/category/${cat.id}`}
          className="min-h-11 grid justify-items-end content-center text-right"
        >
          <span className="text-xs text-text-tertiary">{isIncome ? 'Received' : 'Spent'}</span>
          <span className="text-sm font-medium tabular-nums text-text">
            {formatCurrency(actual)}
          </span>
        </Link>
      </div>
    </div>
  );
}
