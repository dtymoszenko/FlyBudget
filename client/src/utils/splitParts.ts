// The parts of a split while they're typed in a dialog (pure: no React, no API)

/** One part of a split as it's typed: the amount is positive, in the same direction as the whole */
export interface SplitPart {
  categoryId: string | null;
  amount: number;
  notes: string;
}

export const emptyPart = (): SplitPart => ({ categoryId: null, amount: 0, notes: '' });

/** What's left to assign: zero when the parts add up to the whole */
export const remainingOf = (total: number, parts: SplitPart[]) =>
  total - parts.reduce((sum, p) => sum + p.amount, 0);

/** At least two parts with an amount, adding up to the whole */
export const partsBalanced = (total: number, parts: SplitPart[]) =>
  parts.filter((p) => p.amount > 0).length >= 2 && remainingOf(total, parts) === 0;

/** The parts as the server takes them: signed like the whole, empty ones left out */
export const partsToSend = (parts: SplitPart[], outflow: boolean) =>
  parts
    .filter((p) => p.amount > 0)
    .map((p) => ({
      categoryId: p.categoryId,
      amount: outflow ? -p.amount : p.amount,
      notes: p.notes || null,
    }));

/**
 * The part that would make the split add up, and the amount it would need: the first empty
 * part, or else the first part. Null when it's balanced or that part couldn't take it.
 */
export function balancingPart(total: number, parts: SplitPart[]) {
  const remaining = remainingOf(total, parts);
  const empty = parts.findIndex((p) => p.amount === 0);
  const index = empty === -1 ? 0 : empty;
  const amount = (parts[index]?.amount ?? 0) + remaining;
  return remaining === 0 || amount <= 0 ? null : { index, amount };
}
