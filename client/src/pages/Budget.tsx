import { useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO, addMonths, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, ChevronDown, Eye } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { useBudget, useBudgetSummary, useSetBudget, useSetBudgetBulk } from '../hooks/useBudget';
import { formatCurrency, parseCents, centsToInput } from '../utils/currency';
import { BudgetSummaryWidget } from '../components/budget/BudgetSummaryWidget';
import { BudgetEditPopover } from '../components/budget/BudgetEditPopover';
import { Button } from '../components/ui/Button';
import { SpentBar } from '../components/budget/SpentBar';
import { PhoneBudget } from '../components/budget/PhoneBudget';
import { useIsPhone } from '../hooks/useIsPhone';
import { useCanSave } from '../hooks/useConnection';
import type { BudgetCategory, BudgetGroup, BudgetType } from '../types';

function AmountInput({
  cents,
  label,
  onSave,
  onCancel,
}: {
  cents: number;
  label: string;
  onSave: (c: number) => void;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState(centsToInput(cents));
  const cancelled = useRef(false);

  return (
    <input
      autoFocus
      aria-label={label}
      type="number"
      min="0"
      step="0.01"
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      // Select the amount so typing replaces it (number inputs don't allow moving the caret:
      // setSelectionRange throws on them)
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          cancelled.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!cancelled.current) onSave(parseCents(raw));
      }}
      className="w-28 text-right tabular-nums text-sm bg-surface border border-brand-500 rounded-md px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-600"
    />
  );
}

function getStatus(spent: number, planned: number): 'over' | 'healthy' {
  if (spent > planned) return 'over';
  return 'healthy';
}

interface CategoryRowProps {
  cat: BudgetCategory;
  isIncome: boolean;
  editingId: string | null;
  month: string;
  onStartEdit: (id: string) => void;
  onSave: (cents: number) => void;
  onCancel: () => void;
  onApplyBulk: (categoryId: string, cents: number) => void;
}

function CategoryRow({
  cat,
  isIncome,
  editingId,
  month,
  onStartEdit,
  onSave,
  onCancel,
  onApplyBulk,
}: CategoryRowProps) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  // Offline: amounts can't be saved, so they can't be edited (and an open editor closes)
  const canSave = useCanSave();
  const isEditing = editingId === cat.id && canSave;
  const actual = isIncome ? cat.balance - cat.carryOver - cat.budgeted : cat.spent;
  const rawRemaining = cat.budgeted - actual;
  const remaining = isIncome ? Math.max(rawRemaining, 0) : rawRemaining;

  let remainingClass: string;
  const pillBase = 'font-medium rounded-full px-2.5 py-0.5 text-text';
  if (remaining > 0) {
    remainingClass = `${pillBase} bg-positive/20`;
  } else if (remaining < 0) {
    remainingClass = `${pillBase} bg-negative/20`;
  } else {
    remainingClass = `${pillBase} bg-surface-alt`;
  }

  return (
    <tr className="border-b border-border-light">
      <td className="py-1.5 pb-2 pl-10 pr-3">
        <div className="text-sm text-text">
          {showCategoryIcons && cat.icon && <span className="text-xs mr-1">{cat.icon}</span>}
          {cat.name}
        </div>
        <SpentBar spent={actual} budgeted={cat.budgeted} isIncome={isIncome} />
      </td>
      <td className="py-1.5 px-3 text-right align-top">
        <div className="relative inline-block">
          {isEditing ? (
            <>
              <AmountInput
                cents={cat.budgeted}
                label={`Planned for ${cat.name}`}
                onSave={onSave}
                onCancel={onCancel}
              />
              <BudgetEditPopover
                categoryId={cat.id}
                isIncome={isIncome}
                currentAmount={cat.budgeted}
                month={month}
                onApplyBulk={(cents) => onApplyBulk(cat.id, cents)}
              />
            </>
          ) : (
            <button
              onClick={() => onStartEdit(cat.id)}
              disabled={!canSave}
              title={canSave ? undefined : 'Saving is paused until FlyBudget reconnects'}
              aria-label={`Planned for ${cat.name}: ${formatCurrency(cat.budgeted)}`}
              className="tabular-nums text-sm rounded px-2 py-0.5 min-w-[5.5rem] text-right border border-border bg-surface transition-colors hover:border-text-tertiary cursor-text disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="text-text-secondary">{formatCurrency(cat.budgeted)}</span>
            </button>
          )}
        </div>
      </td>
      <td className="py-1.5 px-3 align-top">
        <div className="text-right">
          <Link
            to={`/budget/category/${cat.id}`}
            className="tabular-nums text-sm text-text-secondary hover:text-brand-600 cursor-pointer transition-colors"
          >
            {formatCurrency(actual)}
          </Link>
        </div>
      </td>
      <td className="py-1.5 pl-3 pr-6 text-right align-top">
        <span className={`tabular-nums text-sm inline-block ${remainingClass}`}>
          {formatCurrency(remaining)}
        </span>
      </td>
    </tr>
  );
}

interface IncomeGroupProps {
  group: BudgetGroup;
  editingId: string | null;
  month: string;
  onStartEdit: (id: string) => void;
  onSave: (categoryId: string, cents: number) => void;
  onCancel: () => void;
  onApplyBulk: (categoryId: string, cents: number) => void;
}

function IncomeGroupSection({
  group,
  editingId,
  month,
  onStartEdit,
  onSave,
  onCancel,
  onApplyBulk,
}: IncomeGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showUnbudgeted, setShowUnbudgeted] = useState(false);

  const totals = useMemo(() => {
    const raw = group.categories.reduce(
      (acc, c) => ({
        budgeted: acc.budgeted + c.budgeted,
        spent: acc.spent + c.spent,
        balance: acc.balance + c.balance,
        carryOver: acc.carryOver + c.carryOver,
      }),
      { budgeted: 0, spent: 0, balance: 0, carryOver: 0 },
    );
    return { ...raw, received: raw.balance - raw.carryOver - raw.budgeted };
  }, [group.categories]);

  const active = group.categories.filter(
    (c) => c.budgeted !== 0 || c.balance - c.carryOver - c.budgeted !== 0,
  );
  const inactive = group.categories.filter(
    (c) => c.budgeted === 0 && c.balance - c.carryOver - c.budgeted === 0,
  );
  const visibleCats = showUnbudgeted ? group.categories : active;

  return (
    <>
      <tr className="h-2" aria-hidden>
        <td colSpan={4} />
      </tr>
      <tr
        className="bg-surface border-y border-border-light cursor-pointer select-none hover:bg-hover transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        <td className="py-2 px-4">
          <div className="flex items-center gap-2">
            <span className="text-text-tertiary shrink-0">
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
            <span className="text-sm font-bold text-text">{group.name}</span>
          </div>
        </td>
        <td className="py-2 px-3 text-right tabular-nums text-sm font-semibold text-text">
          {formatCurrency(totals.budgeted)}
        </td>
        <td className="py-2 px-3 text-right tabular-nums text-sm font-semibold text-text">
          {formatCurrency(totals.received)}
        </td>
        <td
          className={`py-2 pl-3 pr-6 text-right tabular-nums text-sm font-semibold ${Math.max(totals.budgeted - totals.received, 0) > 0 ? 'text-positive' : 'text-text-tertiary'}`}
        >
          {formatCurrency(Math.max(totals.budgeted - totals.received, 0))}
        </td>
      </tr>
      {!collapsed && (
        <>
          {visibleCats.map((cat) => (
            <CategoryRow
              key={cat.id}
              cat={cat}
              isIncome
              editingId={editingId}
              month={month}
              onStartEdit={onStartEdit}
              onSave={(cents) => onSave(cat.id, cents)}
              onCancel={onCancel}
              onApplyBulk={onApplyBulk}
            />
          ))}
          {inactive.length > 0 && (
            <tr className="border-b border-border-light">
              <td colSpan={4} className="py-2 pl-10 pr-3">
                <button
                  onClick={() => setShowUnbudgeted((s) => !s)}
                  className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary"
                >
                  <Eye size={12} />
                  {showUnbudgeted ? 'Hide' : 'Show'} {inactive.length} inactive{' '}
                  {inactive.length === 1 ? 'category' : 'categories'}
                </button>
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}

interface BudgetTypeSectionProps {
  budgetType: BudgetType;
  label: string;
  categories: BudgetCategory[];
  editingId: string | null;
  month: string;
  onStartEdit: (id: string) => void;
  onSave: (categoryId: string, cents: number) => void;
  onCancel: () => void;
  onApplyBulk: (categoryId: string, cents: number) => void;
}

function BudgetTypeSection({
  label,
  categories,
  editingId,
  month,
  onStartEdit,
  onSave,
  onCancel,
  onApplyBulk,
}: BudgetTypeSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showUnbudgeted, setShowUnbudgeted] = useState(false);

  const totals = useMemo(
    () =>
      categories.reduce(
        (acc, c) => ({
          budgeted: acc.budgeted + c.budgeted,
          spent: acc.spent + c.spent,
          balance: acc.balance + c.balance,
        }),
        { budgeted: 0, spent: 0, balance: 0 },
      ),
    [categories],
  );

  const active = categories.filter((c) => c.budgeted !== 0 || c.spent !== 0);
  const inactive = categories.filter((c) => c.budgeted === 0 && c.spent === 0);
  const visibleCats = showUnbudgeted ? categories : active;

  const status = getStatus(totals.spent, totals.budgeted);
  const remaining = totals.budgeted - totals.spent;
  const remainingColor = status === 'over' ? 'text-negative' : 'text-positive';

  return (
    <>
      <tr className="h-2" aria-hidden>
        <td colSpan={4} />
      </tr>
      <tr
        className="bg-surface border-y border-border-light cursor-pointer select-none hover:bg-hover transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        <td className="py-2 px-4">
          <div className="flex items-center gap-2">
            <span className="text-text-tertiary shrink-0">
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
            <span className="text-sm font-bold text-text">{label}</span>
          </div>
        </td>
        <td className="py-2 px-3 text-right tabular-nums text-sm font-semibold text-text">
          {formatCurrency(totals.budgeted)}
        </td>
        <td className="py-2 px-3 text-right tabular-nums text-sm font-semibold text-text">
          {formatCurrency(totals.spent)}
        </td>
        <td
          className={`py-2 pl-3 pr-6 text-right tabular-nums text-sm font-semibold ${remainingColor}`}
        >
          {formatCurrency(remaining)}
        </td>
      </tr>

      {!collapsed && (
        <>
          {visibleCats.map((cat) => (
            <CategoryRow
              key={cat.id}
              cat={cat}
              isIncome={false}
              editingId={editingId}
              month={month}
              onStartEdit={onStartEdit}
              onSave={(cents) => onSave(cat.id, cents)}
              onCancel={onCancel}
              onApplyBulk={onApplyBulk}
            />
          ))}

          {inactive.length > 0 && (
            <tr className="border-b border-border-light">
              <td colSpan={4} className="py-2 pl-10 pr-3">
                <button
                  onClick={() => setShowUnbudgeted((s) => !s)}
                  className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary"
                >
                  <Eye size={12} />
                  {showUnbudgeted ? 'Hide' : 'Show'} {inactive.length} inactive{' '}
                  {inactive.length === 1 ? 'category' : 'categories'}
                </button>
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}

const BUDGET_TYPES: { key: BudgetType; label: string }[] = [
  { key: 'fixed', label: 'Fixed' },
  { key: 'flexible', label: 'Flexible' },
  { key: 'non_monthly', label: 'Non-Monthly' },
  { key: 'savings', label: 'Savings/Investments' },
];

export default function BudgetPage() {
  const { selectedMonth, setSelectedMonth } = useAppStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [incomeCollapsed, setIncomeCollapsed] = useState(false);
  const [expensesCollapsed, setExpensesCollapsed] = useState(false);

  const { data: groups = [] } = useBudget(selectedMonth);
  const { data: summary } = useBudgetSummary(selectedMonth);
  const setBudgetMutation = useSetBudget();
  const setBulkMutation = useSetBudgetBulk();
  const isPhone = useIsPhone();

  const monthDate = useMemo(() => parseISO(`${selectedMonth}-01`), [selectedMonth]);

  const incomeGroups = useMemo(() => groups.filter((g) => g.isIncome), [groups]);
  const allExpenseCats = useMemo(
    () => groups.filter((g) => !g.isIncome).flatMap((g) => g.categories),
    [groups],
  );

  const expensesByType = useMemo(
    () =>
      BUDGET_TYPES.map((t) => ({
        ...t,
        categories: allExpenseCats.filter((c) => c.budgetType === t.key),
      })).filter((bt) => bt.categories.length > 0),
    [allExpenseCats],
  );

  const incomeTotals = useMemo(() => {
    const cats = incomeGroups.flatMap((g) => g.categories);
    return {
      budgeted: cats.reduce((s, c) => s + c.budgeted, 0),
      received: cats.reduce((s, c) => s + (c.balance - c.carryOver - c.budgeted), 0),
    };
  }, [incomeGroups]);

  const expenseTotals = useMemo(
    () => ({
      budgeted: allExpenseCats.reduce((s, c) => s + c.budgeted, 0),
      spent: allExpenseCats.reduce((s, c) => s + c.spent, 0),
      balance: allExpenseCats.reduce((s, c) => s + c.balance, 0),
    }),
    [allExpenseCats],
  );

  const savingsTotals = useMemo(() => {
    const cats = allExpenseCats.filter((c) => c.budgetType === 'savings');
    return {
      budgeted: cats.reduce((s, c) => s + c.budgeted, 0),
      spent: cats.reduce((s, c) => s + c.spent, 0),
    };
  }, [allExpenseCats]);

  const expensesByBudgetType = useMemo(() => {
    const calc = (type: string) => {
      const cats = allExpenseCats.filter((c) => c.budgetType === type);
      return {
        planned: cats.reduce((s, c) => s + c.budgeted, 0),
        spent: cats.reduce((s, c) => s + c.spent, 0),
      };
    };
    return { fixed: calc('fixed'), flexible: calc('flexible'), nonMonthly: calc('non_monthly') };
  }, [allExpenseCats]);

  function handleSave(categoryId: string, budgeted: number) {
    setBudgetMutation.mutate({ month: selectedMonth, categoryId, budgeted });
    setEditingId(null);
  }

  function handleApplyBulk(categoryId: string, budgeted: number) {
    setBulkMutation.mutate({ categoryId, budgeted, fromMonth: selectedMonth });
  }

  function goToToday() {
    setSelectedMonth(format(new Date(), 'yyyy-MM'));
  }

  const tbb = summary?.toBeBudgeted ?? 0;
  const carryOver = summary?.carryOver ?? 0;
  const expRemaining = expenseTotals.budgeted - expenseTotals.spent;
  const expBalColor =
    expRemaining > 0 ? 'text-positive' : expRemaining < 0 ? 'text-negative' : 'text-text-tertiary';

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-lg font-semibold text-text">
              {format(monthDate, 'MMMM yyyy')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedMonth(format(subMonths(monthDate, 1), 'yyyy-MM'))}
              aria-label="Previous month"
              className="p-1.5 max-md:min-w-11 max-md:min-h-11 flex items-center justify-center rounded-md hover:bg-surface-alt text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => setSelectedMonth(format(addMonths(monthDate, 1), 'yyyy-MM'))}
              aria-label="Next month"
              className="p-1.5 max-md:min-w-11 max-md:min-h-11 flex items-center justify-center rounded-md hover:bg-surface-alt text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <ChevronRight size={18} />
            </button>
            <Button variant="secondary" size="sm" onClick={goToToday}>
              Today
            </Button>
          </div>
        </div>
      </div>

      {/* Phones: the summary (with To Be Budgeted) goes above the table instead of beside it */}
      <div className="flex max-md:flex-col flex-1 overflow-y-auto">
        <div className="flex-1 max-md:flex-none max-md:order-last max-md:overflow-x-auto">
          {isPhone ? (
            <PhoneBudget
              sections={[
                ...incomeGroups.map((g) => ({
                  key: g.id,
                  label: g.name,
                  isIncome: true,
                  categories: g.categories,
                })),
                ...expensesByType.map((bt) => ({
                  key: bt.key,
                  label: bt.label,
                  isIncome: false,
                  categories: bt.categories,
                })),
              ]}
              month={selectedMonth}
              onSave={handleSave}
              onApplyBulk={handleApplyBulk}
            />
          ) : (
            <table className="w-full border-collapse">
              <colgroup>
                <col style={{ width: '55%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
              </colgroup>
              <tbody>
                {/* Income section header */}
                <tr
                  className="bg-surface-alt border-y border-border cursor-pointer select-none hover:bg-hover transition-colors"
                  onClick={() => setIncomeCollapsed((c) => !c)}
                >
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-text-tertiary shrink-0">
                        {incomeCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </span>
                      <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">
                        Income
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right text-xs font-semibold text-text-tertiary">
                    Planned
                  </td>
                  <td className="py-2 px-3 text-right text-xs font-semibold text-text-tertiary">
                    Actual
                  </td>
                  <td className="py-2 pl-3 pr-6 text-right text-xs font-bold text-text">
                    Remaining
                  </td>
                </tr>

                {!incomeCollapsed && (
                  <>
                    {incomeGroups.map((group) => (
                      <IncomeGroupSection
                        key={group.id}
                        group={group}
                        editingId={editingId}
                        month={selectedMonth}
                        onStartEdit={setEditingId}
                        onSave={handleSave}
                        onCancel={() => setEditingId(null)}
                        onApplyBulk={handleApplyBulk}
                      />
                    ))}

                    {/* Total Income row */}
                    <tr className="bg-surface border-y border-border">
                      <td className="py-2 px-4 text-sm font-bold text-text">Total Income</td>
                      <td className="py-2 px-3 text-right tabular-nums text-sm font-semibold text-text-secondary">
                        {formatCurrency(incomeTotals.budgeted)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-sm font-semibold text-text">
                        {formatCurrency(incomeTotals.received)}
                      </td>
                      <td className="py-2 pl-3 pr-6" />
                    </tr>
                  </>
                )}

                {/* Expenses section header */}
                <tr
                  className="bg-surface-alt border-y border-border cursor-pointer select-none hover:bg-hover transition-colors"
                  onClick={() => setExpensesCollapsed((c) => !c)}
                >
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-text-tertiary shrink-0">
                        {expensesCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </span>
                      <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">
                        Expenses
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right text-xs font-semibold text-text-tertiary">
                    Planned
                  </td>
                  <td className="py-2 px-3 text-right text-xs font-semibold text-text-tertiary">
                    Actual
                  </td>
                  <td className="py-2 pl-3 pr-6 text-right text-xs font-bold text-text">
                    Remaining
                  </td>
                </tr>

                {!expensesCollapsed && (
                  <>
                    {expensesByType.map((bt) => (
                      <BudgetTypeSection
                        key={bt.key}
                        budgetType={bt.key}
                        label={bt.label}
                        categories={bt.categories}
                        editingId={editingId}
                        month={selectedMonth}
                        onStartEdit={setEditingId}
                        onSave={handleSave}
                        onCancel={() => setEditingId(null)}
                        onApplyBulk={handleApplyBulk}
                      />
                    ))}

                    {/* Total Expenses row */}
                    <tr className="bg-surface border-y border-border">
                      <td className="py-2 px-4 text-sm font-bold text-text">Total Expenses</td>
                      <td className="py-2 px-3 text-right tabular-nums text-sm font-semibold text-text-secondary">
                        {formatCurrency(expenseTotals.budgeted)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-sm font-semibold text-text-secondary">
                        {formatCurrency(expenseTotals.spent)}
                      </td>
                      <td
                        className={`py-2 pl-3 pr-6 text-right tabular-nums text-sm font-semibold ${expBalColor}`}
                      >
                        {formatCurrency(expRemaining)}
                      </td>
                    </tr>
                  </>
                )}

                {groups.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-16 text-center text-sm text-text-tertiary">
                      No categories yet. Add some in Settings.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="w-80 max-md:w-full shrink-0 border-l max-md:border-l-0 max-md:border-b border-border p-4 self-start max-md:self-stretch sticky max-md:static top-0">
          <div>
            <BudgetSummaryWidget
              toBeBudgeted={tbb}
              carryOver={carryOver}
              incomePlanned={incomeTotals.budgeted}
              incomeEarned={incomeTotals.received}
              expensesPlanned={expenseTotals.budgeted}
              expensesSpent={expenseTotals.spent}
              savingsPlanned={savingsTotals.budgeted}
              savingsContributed={savingsTotals.spent}
              fixedExpenses={expensesByBudgetType.fixed}
              flexibleExpenses={expensesByBudgetType.flexible}
              nonMonthlyExpenses={expensesByBudgetType.nonMonthly}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
