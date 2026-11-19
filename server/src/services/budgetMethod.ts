// How months add up. Pure: settings and integer-cent totals in, numbers out (the database side
// is in routes/budget.ts).
//
// `zero_based`: every category carries its balance into the next month, and money not yet
// assigned rolls into "To be budgeted". `category`: each month's plan stands on its own; a
// category carries over only when it (or, if it has no setting, the budget) says so, and
// "To be budgeted" is that month's income minus that month's plan. Income never carries over.

export const BUDGET_METHODS = ['zero_based', 'category'] as const;
export type BudgetMethod = (typeof BUDGET_METHODS)[number];

export interface BudgetMethodSettings {
  method: BudgetMethod;
  /** Category budgeting's default: true = carry over, false = start fresh each month */
  carryOver: boolean;
}

/** The settings as stored in `budget_settings` (anything unknown reads as zero-based) */
export function readBudgetMethod(stored: {
  budgetMethod: string;
  carryOver: number;
}): BudgetMethodSettings {
  return {
    method: stored.budgetMethod === 'category' ? 'category' : 'zero_based',
    carryOver: stored.carryOver === 1,
  };
}

/** Whether a category brings what's left (or overspent) from earlier months into this one */
export function carriesOver(
  settings: BudgetMethodSettings,
  category: { isIncome: boolean; carryOver: number | null },
): boolean {
  if (settings.method === 'zero_based') return true;
  if (category.isIncome) return false;
  return category.carryOver === null ? settings.carryOver : category.carryOver === 1;
}

/** A category's carry-over: everything budgeted plus all activity before this month, or 0 */
export function categoryCarryOver(
  carries: boolean,
  prior: { budgeted: number; activity: number },
): number {
  return carries ? prior.budgeted + prior.activity : 0;
}

/** The summary's money from earlier months: income not yet budgeted, or 0 in category budgeting */
export function summaryCarryOver(
  method: BudgetMethod,
  prior: { income: number; budgeted: number },
): number {
  return method === 'category' ? 0 : prior.income - prior.budgeted;
}
