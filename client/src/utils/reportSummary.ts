import { formatCurrency } from './currency';

export type Tone = 'positive' | 'negative' | 'neutral';

interface MonthFlow {
  income: number;
  expenses: number;
  expenseNet?: number;
}

/**
 * How many months of a range to average over: from the first month with any income or
 * spending to the end of the range (at least 1). A budget started this month isn't averaged
 * over the months before it existed.
 */
export function monthsToAverage(months: MonthFlow[]): number {
  const first = months.findIndex(
    (m) => m.income !== 0 || m.expenses !== 0 || (m.expenseNet ?? 0) !== 0,
  );
  return first === -1 ? 1 : months.length - first;
}

/** An income figure: negative (more refunded than received) keeps its minus sign. */
export function incomeFigure(cents: number): { value: string; tone: Tone } {
  const v = Math.round(cents);
  return { value: formatCurrency(v), tone: v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral' };
}

/**
 * An expenses figure from net spending (negative = money out): shown as the amount spent,
 * or "+$X" when refunds outweighed spending, so money back never reads as money spent.
 */
export function expenseFigure(netCents: number): { value: string; tone: Tone } {
  const v = Math.round(netCents);
  if (v < 0) return { value: formatCurrency(-v), tone: 'negative' };
  if (v > 0) return { value: `+${formatCurrency(v)}`, tone: 'positive' };
  return { value: formatCurrency(0), tone: 'neutral' };
}
