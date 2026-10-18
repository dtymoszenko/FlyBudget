// Adding up accounts that may be in different currencies: each counts in the budget's
// currency, at the latest rate (the server's `mainBalance`). An account without a rate
// can't be counted honestly, so it's left out and named (see unconvertedCurrencies).
import type { Account, Transaction } from '../types';
import { convertMinor, impliedRate } from './money';

/** An account's balance in the budget's currency, or null without a rate for its currency */
export function balanceValue(account: Pick<Account, 'balance' | 'mainBalance'>): number | null {
  // An offline copy saved before currencies existed has no mainBalance: one currency then
  return account.mainBalance === undefined ? account.balance : account.mainBalance;
}

/** The accounts' balances added up in the budget's currency, leaving out ones without a rate */
export function totalValue(accounts: Pick<Account, 'balance' | 'mainBalance'>[]): number {
  return accounts.reduce((sum, a) => sum + (balanceValue(a) ?? 0), 0);
}

/** Currencies of accounts a total had to leave out for want of a rate */
export function unconvertedCurrencies(
  accounts: Pick<Account, 'balance' | 'mainBalance' | 'currency'>[],
): string[] {
  return [
    ...new Set(
      accounts
        .filter((a) => balanceValue(a) === null && a.balance !== 0)
        .map((a) => a.currency ?? '?'),
    ),
  ].sort();
}

/**
 * An earlier balance of an account (in its own currency) in the budget's, at today's rate:
 * how much it changed is then about the account, not about the rate. Null when that can't be
 * worked out (no rate, or nothing to take the rate from).
 */
export function earlierValue(
  account: Pick<Account, 'balance' | 'mainBalance' | 'rateDate'>,
  earlier: number,
): number | null {
  const value = balanceValue(account);
  if (value === null) return null;
  // No conversion was needed: it's in the budget's currency
  if (!account.rateDate) return earlier;
  if (account.balance === 0) return null;
  // Exact: the rate the two balances imply, applied once (cents times cents can pass 2^53)
  const rate = impliedRate(account.balance, 0, value, 0);
  if (!rate) return 0;
  // impliedRate works on sizes: the sign comes from the two balances
  return Math.sign(value) * Math.sign(account.balance) * convertMinor(earlier, 0, 0, rate);
}

/** What a transaction counts as in the budget's currency (nothing while its rate is missing) */
export function transactionValue(
  tx: Pick<Transaction, 'amount' | 'mainAmount' | 'mainAmountSource'>,
): number {
  if (tx.mainAmountSource === 'missing') return 0;
  return tx.mainAmount ?? tx.amount;
}
