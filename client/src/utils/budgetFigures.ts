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
