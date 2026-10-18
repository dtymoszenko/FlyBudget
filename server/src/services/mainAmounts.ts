// What a transaction is worth in the budget's currency: pure decisions, so the same rules
// run on any device. The database side is in mainAmountService.ts.
//
// `transactions.main_amount` is null for rows in the budget's currency (the amount is
// already the value) and set for rows in an account with another currency, with
// `main_amount_source` saying where it came from:
//   rate      converted at the rate for the transaction's day
//   manual    typed in by the user (what the card statement says it cost)
//   transfer  the other side of a transfer, so the pair adds up to exactly zero
//   missing   no rate for that day yet: counted as 0 in the budget, and shown as a warning
import { isForeign, minorUnits } from '../utils/currencies.js';
import { convertMinor } from '../utils/money.js';
import type { RateBook } from './exchangeRates.js';

export type MainAmountSource = 'rate' | 'manual' | 'transfer' | 'missing';

export interface MainAmount {
  mainAmount: number | null;
  mainAmountSource: MainAmountSource | null;
}

export const SAME_CURRENCY: MainAmount = { mainAmount: null, mainAmountSource: null };

/** An amount in an account's currency converted to the budget's, at the day's rate */
export function mainAmountFor(
  row: { amount: number; date: string; currency: string | null },
  budgetCurrency: string | null,
  rates: RateBook,
): MainAmount {
  if (!isForeign(row.currency, budgetCurrency)) return SAME_CURRENCY;
  const from = row.currency!;
  const to = budgetCurrency!;
  if (row.amount === 0) return { mainAmount: 0, mainAmountSource: 'rate' };
  const found = rates.find(from, to, row.date);
  if (!found) return { mainAmount: null, mainAmountSource: 'missing' };
  try {
    return {
      mainAmount: convertMinor(row.amount, minorUnits(from), minorUnits(to), found.rate),
      mainAmountSource: 'rate',
    };
  } catch {
    // Too big to count exactly: shown as missing rather than wrong
    return { mainAmount: null, mainAmountSource: 'missing' };
  }
}

/** What a row counts as in budget and report totals (a missing rate counts as nothing) */
export function effectiveMainAmount(row: {
  amount: number;
  mainAmount: number | null;
  mainAmountSource: string | null;
}): number {
  if (row.mainAmountSource === 'missing') return 0;
  return row.mainAmount ?? row.amount;
}

export interface TransferSide {
  amount: number;
  date: string;
  currency: string | null;
}

/**
 * The budget-currency values of a transfer's two sides. They always add up to exactly zero,
 * so moving money between accounts never shows up as income or spending, whatever the rate:
 * - a side in the budget's currency is the transfer's value, and the other side is minus that
 * - with neither side in the budget's currency, the outflow is converted at its day's rate
 * - with no rate for that, both are missing
 */
export function transferMainAmounts(
  a: TransferSide,
  b: TransferSide,
  budgetCurrency: string | null,
  rates: RateBook,
): [MainAmount, MainAmount] {
  const aForeign = isForeign(a.currency, budgetCurrency);
  const bForeign = isForeign(b.currency, budgetCurrency);
  if (!aForeign && !bForeign) return [SAME_CURRENCY, SAME_CURRENCY];
  if (!aForeign) return [SAME_CURRENCY, { mainAmount: -a.amount, mainAmountSource: 'transfer' }];
  if (!bForeign) return [{ mainAmount: -b.amount, mainAmountSource: 'transfer' }, SAME_CURRENCY];
  // Both foreign: the side money left decides (or the first, for a zero transfer)
  const lead = b.amount < 0 && a.amount >= 0 ? b : a;
  const value = mainAmountFor(lead, budgetCurrency, rates);
  const pair: [MainAmount, MainAmount] =
    value.mainAmount === null
      ? [value, { mainAmount: null, mainAmountSource: 'missing' }]
      : [value, { mainAmount: -value.mainAmount, mainAmountSource: 'transfer' }];
  return lead === a ? pair : [pair[1], pair[0]];
}
