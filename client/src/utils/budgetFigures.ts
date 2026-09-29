import type { BudgetCategory } from '../types';

// How one budget category reads, shared by the desktop table and the phone cards.

/**
 * `actual`: what was spent (expenses) or received (income) this month. `remaining`:
 * planned minus actual; income never shows a negative remainder (earning more than
 * planned isn't a shortfall).
 */
export function categoryFigures(cat: BudgetCategory, isIncome: boolean) {
  const actual = isIncome ? cat.balance - cat.carryOver - cat.budgeted : cat.spent;
  const raw = cat.budgeted - actual;
  return { actual, remaining: isIncome ? Math.max(raw, 0) : raw };
}

/** A category with nothing planned and no activity is "inactive" and tucked away. */
export function isActiveCategory(cat: BudgetCategory, isIncome: boolean) {
  return cat.budgeted !== 0 || categoryFigures(cat, isIncome).actual !== 0;
}

/** Each budget section always lists at least this many categories */
export const MIN_SHOWN_CATEGORIES = 3;

/**
 * Which categories a budget section lists, and which it tucks away behind "Show N inactive
 * categories": every active one, topped up with the first inactive ones (in the section's
 * order) to at least `min`, so no section ever looks empty. Both lists keep the section's
 * order.
 */
export function splitCategories(
  categories: BudgetCategory[],
  isIncome: boolean,
  min = MIN_SHOWN_CATEGORIES,
) {
  let fill = Math.max(min - categories.filter((c) => isActiveCategory(c, isIncome)).length, 0);
  const shown: BudgetCategory[] = [];
  const hidden: BudgetCategory[] = [];
  for (const cat of categories) {
    if (isActiveCategory(cat, isIncome)) shown.push(cat);
    else if (fill > 0) {
      shown.push(cat);
      fill--;
    } else hidden.push(cat);
  }
  return { shown, hidden };
}
