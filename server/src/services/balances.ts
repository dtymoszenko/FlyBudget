import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { transactions } from '../db/schema.js';

// A split is stored as a parent row holding the full amount plus child rows holding
// the parts, all in the same account. Account balances count the parent only;
// category totals count the children only (the parent has no category).

/** Rows that make up an account's balance: everything except split children. */
export const inAccountBalance: SQL = isNull(transactions.parentTransactionId);

/**
 * Rows that are money earned or spent, for income and spending reports: everything except
 * balance corrections (reconciliation, "Update value") the user left without a category.
 * Balances and net worth still count those.
 */
export const isIncomeOrSpending: SQL = sql`not (${transactions.isAdjustment} = 1 and ${transactions.categoryId} is null)`;

/** Sum of an account's transactions, as added to its starting balance. */
export function accountTransactionSum(accountId: string): number {
  const row = db
    .select({ sum: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), inAccountBalance))
    .get();
  return row?.sum ?? 0;
}

/**
 * What a row counts as in the budget and in reports that add up more than one account: its
 * value in the budget's currency (services/mainAmounts.ts). That's its amount in an account
 * with the budget's currency, the converted one in another, and nothing while its rate is
 * missing (shown as a warning instead of counting it at a made-up rate).
 * Per-account sums (balances, reconciling) use `amount`, in the account's own currency.
 */
export const mainAmount: SQL<number> = sql<number>`(case when ${transactions.mainAmountSource} = 'missing' then 0 else coalesce(${transactions.mainAmount}, ${transactions.amount}) end)`;
