// The database side of multiple currencies: the budget's settings, stored rates, and keeping
// each transaction's budget-currency value (`main_amount`) up to date. The rules themselves
// are pure, in mainAmounts.ts and exchangeRates.ts.
//
// Every write that creates or changes a transaction's amount, date or account calls
// refreshMainAmounts with its id afterwards (a transfer's other side and a split's parts are
// included automatically). In a budget with one currency that finds nothing to do.
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accounts, budgetSettings, exchangeRates, transactions } from '../db/schema.js';
import { isCurrencyCode, isForeign, minorUnits } from '../utils/currencies.js';
import { allocate, convertMinor } from '../utils/money.js';
import { buildRateBook, type RateBook } from './exchangeRates.js';
import {
  SAME_CURRENCY,
  mainAmountFor,
  transferMainAmounts,
  type MainAmount,
  type MainAmountSource,
} from './mainAmounts.js';

const SETTINGS_ID = 'budget';

export type BudgetSettings = typeof budgetSettings.$inferSelect;

export function getBudgetSettings(): BudgetSettings {
  return (
    db.select().from(budgetSettings).where(eq(budgetSettings.id, SETTINGS_ID)).get() ?? {
      id: SETTINGS_ID,
      currency: null,
      ratesEnabled: 0,
      ratesUrl: null,
      ratesLastFetchedAt: null,
      ratesLastError: null,
      updatedAt: new Date(0).toISOString(),
    }
  );
}

export function updateBudgetSettings(
  patch: Partial<Omit<BudgetSettings, 'id' | 'updatedAt'>>,
): BudgetSettings {
  const next = { ...getBudgetSettings(), ...patch, updatedAt: new Date().toISOString() };
  db.insert(budgetSettings)
    .values(next)
    .onConflictDoUpdate({ target: budgetSettings.id, set: { ...patch, updatedAt: next.updatedAt } })
    .run();
  return next;
}

/** The budget's currency, or null while none is chosen */
export const budgetCurrency = (): string | null => getBudgetSettings().currency;

// Stored rates change only through this module (manual rates, downloads, restores), so the
// lookup index is kept until they do
let rateBook: RateBook | null = null;

/** Call after changing exchange_rates */
export function ratesChanged() {
  rateBook = null;
}

export function loadRateBook(): RateBook {
  return (rateBook ??= buildRateBook(db.select().from(exchangeRates).all()));
}

/** Each account's own currency (null = the budget's) */
export function accountCurrencies(): Map<string, string | null> {
  return new Map(
    db
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .all()
      .map((a) => [a.id, a.currency]),
  );
}

/** A currency code from a bank, if it's one FlyBudget knows (SimpleFIN may send a URL instead) */
export function bankCurrency(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const upper = code.trim().toUpperCase();
  return isCurrencyCode(upper) ? upper : null;
}

/**
 * The currency to store for an account: none when it's the budget's. While the budget has no
 * currency yet, the first one an account is given becomes the budget's.
 */
export function currencyToStore<T extends string | null | undefined>(currency: T): T | null {
  if (currency === undefined || currency === null) return currency;
  const budget = budgetCurrency();
  if (!budget) {
    updateBudgetSettings({ currency });
    return null;
  }
  return currency === budget ? null : currency;
}

/** Whether any account has another currency than the budget's: if not, there's nothing to convert */
export function hasForeignAccounts(): boolean {
  const budget = budgetCurrency();
  if (!budget) return false;
  return !!db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(isNotNull(accounts.currency), ne(accounts.currency, budget)))
    .get();
}

type Row = typeof transactions.$inferSelect;

/** What converting needs, loaded once: pass it along when inserting many rows (imports, syncs) */
export interface CurrencyContext {
  budget: string | null;
  currencies: Map<string, string | null>;
  rates: RateBook;
}
type Context = CurrencyContext;

export const currencyContext = (): CurrencyContext => ({
  budget: budgetCurrency(),
  currencies: accountCurrencies(),
  rates: loadRateBook(),
});
const context = currencyContext;

/** The currency an account's amounts are in (its own, else the budget's; null if neither is set) */
export function accountCurrency(accountId: string, ctx: CurrencyContext = currencyContext()) {
  return ctx.currencies.get(accountId) ?? ctx.budget;
}

/** The value of a new row (not a transfer): set when it's inserted */
export function newRowValue(
  row: { accountId: string; amount: number; date: string },
  ctx: CurrencyContext = currencyContext(),
): MainAmount {
  const currency = ctx.currencies.get(row.accountId) ?? null;
  return mainAmountFor({ amount: row.amount, date: row.date, currency }, ctx.budget, ctx.rates);
}

/**
 * An amount in one currency at the day's rate in another, or null without a rate (or without
 * currencies: a budget that hasn't chosen one has nothing to convert)
 */
export function convertAmount(
  amount: number,
  from: string | null,
  to: string | null,
  date: string,
  ctx: CurrencyContext = currencyContext(),
): number | null {
  if (from === to) return amount;
  if (!from || !to) return null;
  const found = ctx.rates.find(from, to, date);
  if (!found) return null;
  try {
    return convertMinor(amount, minorUnits(from), minorUnits(to), found.rate);
  } catch {
    return null;
  }
}

/** Today as `YYYY-MM-DD` on this machine */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * A balance in the budget's currency at the latest rate (as of `date`, default today), for
 * totals across accounts: `mainBalance` is null without a rate, and `rateDate` says which
 * day's rate was used (null when no conversion was needed)
 */
export function valueToday(
  balance: number,
  currency: string | null,
  ctx: CurrencyContext = currencyContext(),
  date: string = todayIso(),
): { mainBalance: number | null; rateDate: string | null } {
  if (!isForeign(currency, ctx.budget)) return { mainBalance: balance, rateDate: null };
  const found = ctx.rates.find(currency!, ctx.budget!, date);
  if (!found) return { mainBalance: null, rateDate: null };
  try {
    return {
      mainBalance: convertMinor(balance, minorUnits(currency), minorUnits(ctx.budget), found.rate),
      rateDate: found.date,
    };
  } catch {
    return { mainBalance: null, rateDate: null };
  }
}

/**
 * What an account in another currency was counted as when its money came in: its starting
 * balance at the rate of its first day, plus every transaction's value. Null if any of those
 * has no rate. (Its value today minus this is the currency difference: what the rate changed.)
 */
export function bookedValue(
  account: { id: string; startingBalance: number; createdAt: string; currency: string | null },
  ctx: CurrencyContext = currencyContext(),
): number | null {
  const row = db
    .select({
      total: sql<number>`coalesce(sum(coalesce(${transactions.mainAmount}, ${transactions.amount})), 0)`,
      missing: sql<number>`coalesce(sum(case when ${transactions.mainAmountSource} = 'missing' then 1 else 0 end), 0)`,
      first: sql<string | null>`min(${transactions.date})`,
    })
    .from(transactions)
    .where(and(eq(transactions.accountId, account.id), isNull(transactions.parentTransactionId)))
    .get();
  if (!row || row.missing > 0) return null;
  if (account.startingBalance === 0) return row.total;
  const created = account.createdAt.slice(0, 10);
  const firstDay = row.first && row.first < created ? row.first : created;
  const start = valueToday(account.startingBalance, account.currency ?? ctx.budget, ctx, firstDay);
  return start.mainBalance === null ? null : start.mainBalance + row.total;
}

/** The values of a new split's parts, sharing the whole's */
export const splitPartValues = (whole: MainAmount, partAmounts: number[]): MainAmount[] =>
  partValues(
    whole,
    partAmounts.map((amount) => ({ amount })),
  );

const sameValue = (row: Row, m: MainAmount) =>
  row.mainAmount === m.mainAmount && row.mainAmountSource === m.mainAmountSource;

/** A single row's value: a manual one is kept unless asked not to */
function ownValue(row: Row, ctx: Context, keepManual: boolean): MainAmount {
  const currency = ctx.currencies.get(row.accountId) ?? null;
  if (!isForeign(currency, ctx.budget)) return SAME_CURRENCY;
  if (keepManual && row.mainAmountSource === 'manual' && row.mainAmount !== null) {
    return { mainAmount: row.mainAmount, mainAmountSource: 'manual' };
  }
  return mainAmountFor({ amount: row.amount, date: row.date, currency }, ctx.budget, ctx.rates);
}

/** The values of a transfer's two sides, adding up to zero (a manual side leads) */
function pairValues(a: Row, b: Row, ctx: Context, keepManual: boolean): [MainAmount, MainAmount] {
  const side = (r: Row) => ({
    amount: r.amount,
    date: r.date,
    currency: ctx.currencies.get(r.accountId) ?? null,
  });
  const aForeign = isForeign(side(a).currency, ctx.budget);
  const bForeign = isForeign(side(b).currency, ctx.budget);
  if (keepManual && aForeign && bForeign) {
    const manual = [a, b].find((r) => r.mainAmountSource === 'manual' && r.mainAmount !== null);
    if (manual) {
      const lead: MainAmount = { mainAmount: manual.mainAmount, mainAmountSource: 'manual' };
      const other: MainAmount = { mainAmount: -manual.mainAmount!, mainAmountSource: 'transfer' };
      return manual === a ? [lead, other] : [other, lead];
    }
  }
  return transferMainAmounts(side(a), side(b), ctx.budget, ctx.rates);
}

/** Split parts share the parent's value in proportion to their amounts */
function partValues(parent: MainAmount, parts: Pick<Row, 'amount'>[]): MainAmount[] {
  if (parent.mainAmountSource === null) return parts.map(() => SAME_CURRENCY);
  if (parent.mainAmount === null) return parts.map(() => parent);
  const shares = allocate(
    parent.mainAmount,
    parts.map((p) => p.amount),
  );
  const source: MainAmountSource = parent.mainAmountSource === 'manual' ? 'manual' : 'rate';
  return shares.map((mainAmount) => ({ mainAmount, mainAmountSource: source }));
}

function write(row: Row, value: MainAmount) {
  if (sameValue(row, value)) return;
  db.update(transactions)
    .set({ mainAmount: value.mainAmount, mainAmountSource: value.mainAmountSource })
    .where(eq(transactions.id, row.id))
    .run();
}

const rowsById = (ids: string[]): Row[] => {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    out.push(
      ...db
        .select()
        .from(transactions)
        .where(inArray(transactions.id, ids.slice(i, i + 500)))
        .all(),
    );
  }
  return out;
};

export interface RefreshOptions {
  /** Keep values the user typed (default). False after the amount itself changed. */
  keepManual?: boolean;
}

/**
 * Recomputes the budget-currency value of these transactions, with a transfer's other side
 * and a split's parent and parts. Rows in the budget's currency end up with none.
 */
export function refreshMainAmounts(
  ids: Array<string | null | undefined>,
  opts: RefreshOptions = {},
) {
  const wanted = ids.filter((id): id is string => !!id);
  if (!wanted.length) return;
  const ctx = context();
  // Nothing to convert and nothing left over from a time there was: skip the work
  if (!ctx.budget || ![...ctx.currencies.values()].some((c) => isForeign(c, ctx.budget))) {
    const stale = rowsById(wanted).filter(
      (r) => r.mainAmountSource !== null || r.mainAmount !== null,
    );
    if (!stale.length) return;
  }
  const keepManual = opts.keepManual ?? true;
  const done = new Set<string>();

  // No transaction of its own: callers are often inside one (the demo's SQLite can't nest them)
  for (const start of rowsById(wanted)) {
    if (done.has(start.id)) continue;
    // A split part is refreshed through its parent
    const row = start.parentTransactionId
      ? (rowsById([start.parentTransactionId])[0] ?? start)
      : start;
    if (done.has(row.id)) continue;
    done.add(row.id);

    const other = row.transferTransactionId ? rowsById([row.transferTransactionId])[0] : undefined;
    let value: MainAmount;
    if (other && !other.parentTransactionId) {
      const [mine, theirs] = pairValues(row, other, ctx, keepManual);
      value = mine;
      done.add(other.id);
      write(other, theirs);
    } else {
      value = ownValue(row, ctx, keepManual);
    }
    write(row, value);

    if (row.isParent) {
      const parts = db
        .select()
        .from(transactions)
        .where(eq(transactions.parentTransactionId, row.id))
        .orderBy(transactions.id)
        .all();
      partValues(value, parts).forEach((v, i) => {
        done.add(parts[i].id);
        write(parts[i], v);
      });
    }
  }
}

/**
 * Fills in values that are missing: rows in another currency without a value or waiting for
 * a rate, transfer sides no longer linked, and rows left with a value after their account
 * turned out to be in the budget's currency. Values from a rate, typed in, or from a
 * transfer stay as they are. Returns how many rows were looked at.
 */
export function fillMissingMainAmounts(opts: { accountId?: string } = {}): number {
  const budget = budgetCurrency();
  const currencies = accountCurrencies();
  const foreign = [...currencies].filter(([, c]) => isForeign(c, budget)).map(([id]) => id);
  const notForeign = [...currencies].filter(([, c]) => !isForeign(c, budget)).map(([id]) => id);
  const scope = (list: string[]) =>
    opts.accountId ? list.filter((id) => id === opts.accountId) : list;

  const ids: string[] = [];
  const foreignIds = scope(foreign);
  if (foreignIds.length) {
    ids.push(
      ...db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            inArray(transactions.accountId, foreignIds),
            or(
              isNull(transactions.mainAmountSource),
              eq(transactions.mainAmountSource, 'missing'),
              and(
                eq(transactions.mainAmountSource, 'transfer'),
                isNull(transactions.transferTransactionId),
                isNull(transactions.parentTransactionId),
              ),
            ),
          ),
        )
        .all()
        .map((r) => r.id),
    );
  }
  const otherIds = scope(notForeign);
  if (otherIds.length) {
    ids.push(
      ...db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            inArray(transactions.accountId, otherIds),
            or(isNotNull(transactions.mainAmountSource), isNotNull(transactions.mainAmount)),
          ),
        )
        .all()
        .map((r) => r.id),
    );
  }
  refreshMainAmounts(ids);
  return ids.length;
}

/**
 * "Recalculate from rates": values that came from a rate are worked out again with today's
 * stored rates (after correcting or adding rates). Typed-in values and reconciled rows stay.
 */
export function recalculateMainAmounts(opts: {
  from?: string;
  to?: string;
  accountIds?: string[];
  dryRun?: boolean;
}): number {
  const where = [
    or(eq(transactions.mainAmountSource, 'rate'), eq(transactions.mainAmountSource, 'missing')),
    ne(transactions.reconciled, 1),
    isNull(transactions.parentTransactionId),
  ];
  if (opts.from) where.push(sql`${transactions.date} >= ${opts.from}`);
  if (opts.to) where.push(sql`${transactions.date} <= ${opts.to}`);
  if (opts.accountIds?.length) where.push(inArray(transactions.accountId, opts.accountIds));
  const rows = db
    .select()
    .from(transactions)
    .where(and(...where))
    .all();
  const ctx = context();
  const changing = rows.filter((r) => {
    const value = ownValue(r, ctx, true);
    return !sameValue(r, value) || !!r.transferTransactionId;
  });
  if (opts.dryRun) return changing.length;
  refreshMainAmounts(changing.map((r) => r.id));
  return changing.length;
}

/** How many transactions are waiting for a rate, per currency */
export function missingRateSummary(): { count: number; currencies: string[] } {
  const rows = db
    .select({ currency: accounts.currency, count: sql<number>`count(*)` })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(eq(transactions.mainAmountSource, 'missing'), isNull(transactions.parentTransactionId)),
    )
    .groupBy(accounts.currency)
    .all();
  return {
    count: rows.reduce((n, r) => n + r.count, 0),
    currencies: rows
      .map((r) => r.currency)
      .filter((c): c is string => !!c)
      .sort(),
  };
}
