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
 * Default categories most people use, most common first. When a section needs topping up,
 * these are picked before the rest, so a new budget shows Groceries and Rent rather than
 * whatever sorts first. Matched by name (ignoring case): renamed or custom categories just
 * keep the section's order.
 */
const COMMON_CATEGORIES = [
  // Income
  'paychecks',
  'other income',
  'interest',
  // Fixed
  'rent / mortgage',
  'electric',
  'phone',
  'internet',
  'car payment',
  'car insurance',
  'streaming services',
  // Flexible
  'groceries',
  'restaurants',
  'gas / fuel',
  'personal care',
  'clothing',
  'coffee shops',
  // Non-monthly
  'savings',
  'doctor / medical',
  'car maintenance',
  'entertainment',
  'vacation',
];

const commonRank = (cat: BudgetCategory) => {
  const rank = COMMON_CATEGORIES.indexOf(cat.name.trim().toLowerCase());
  return rank === -1 ? COMMON_CATEGORIES.length : rank;
};

/**
 * Which categories a budget section lists, and which it tucks away behind "Show N inactive
 * categories": every active one, topped up with inactive ones to at least `min` so no
 * section ever looks empty (common categories first, then the section's order). Both
 * lists keep the section's order.
 */
export function splitCategories(
  categories: BudgetCategory[],
  isIncome: boolean,
  min = MIN_SHOWN_CATEGORIES,
) {
  const inactive = categories.filter((c) => !isActiveCategory(c, isIncome));
  const fill = Math.max(min - (categories.length - inactive.length), 0);
  const topUp = new Set(
    inactive
      .map((cat, index) => ({ cat, index }))
      .sort((a, b) => commonRank(a.cat) - commonRank(b.cat) || a.index - b.index)
      .slice(0, fill)
      .map(({ cat }) => cat),
  );
  const shown = categories.filter((c) => isActiveCategory(c, isIncome) || topUp.has(c));
  const hidden = inactive.filter((c) => !topUp.has(c));
  return { shown, hidden };
}
