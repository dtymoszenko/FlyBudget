import { Router } from 'express';
import { db } from '../db/index.js';
import { accounts, transactions } from '../db/schema.js';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { logoSchema } from '../utils/logo.js';
import { accountTypeSchema, defaultOffBudget } from '../utils/accountTypes.js';
import { accountTransactionSum, inAccountBalance } from '../services/balances.js';
import {
  bookedValue,
  budgetCurrency,
  currencyContext,
  currencyToStore,
  valueToday,
  type CurrencyContext,
} from '../services/mainAmountService.js';
import { currencySchema } from '../utils/validation.js';
import {
  importSettingsSchema,
  readImportSettings,
  readStatementAccount,
  statementAccountSchema,
  storeImportSettings,
} from '../utils/importSettings.js';

export const accountsRouter = Router();

const fields = {
  name: z.string().trim().min(1).max(200),
  type: accountTypeSchema,
  startingBalance: z.number().int(),
  isOffBudget: z.number().int().min(0).max(1),
  /** ISO 4217; null or the budget's own = the budget's currency */
  currency: currencySchema.nullable(),
};

const createSchema = z.object({
  ...fields,
  startingBalance: fields.startingBalance.default(0),
  isOffBudget: fields.isOffBudget.optional(),
  currency: fields.currency.optional(),
});

// Built without defaults: Zod applies `.default()` even inside `.partial()`, so an update
// that only renames an account would otherwise reset its starting balance to 0
const updateSchema = z.object(fields).partial().extend({
  logo: logoSchema.optional(),
  // Reopens a closed account (undo of "Close account"); closing is DELETE
  closedAt: z.null().optional(),
});

/**
 * An account as the API shows it: its balance, its currency (the budget's when it has none
 * of its own) and the balance in the budget's currency at the latest rate (null without one)
 */
function shown(
  account: typeof accounts.$inferSelect,
  balance: number,
  hasTransactions: boolean,
  ctx: CurrencyContext,
) {
  const currency = account.currency ?? ctx.budget;
  const value = valueToday(balance, currency, ctx);
  // In another currency: how much more (or less) it's worth today than it was counted as
  let currencyDifference: number | null = null;
  if (value.rateDate && value.mainBalance !== null) {
    const booked = bookedValue(account, ctx);
    currencyDifference = booked === null ? null : value.mainBalance - booked;
  }
  return { ...account, currency, balance, hasTransactions, ...value, currencyDifference };
}

function withBalance(account: typeof accounts.$inferSelect) {
  const sum = accountTransactionSum(account.id);
  const any = !!db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.accountId, account.id))
    .get();
  return shown(account, account.startingBalance + sum, any, currencyContext());
}

const storedCurrency = currencyToStore;

accountsRouter.get('/', (_req, res) => {
  const rows = db
    .select()
    .from(accounts)
    .where(isNull(accounts.closedAt))
    .orderBy(accounts.sortOrder)
    .all();
  if (!rows.length) return res.json([]);

  const sums = db
    .select({
      accountId: transactions.accountId,
      sum: sql<number>`coalesce(sum(case when ${inAccountBalance} then ${transactions.amount} else 0 end), 0)`,
      // A split counts once, not once per part
      count: sql<number>`count(case when ${inAccountBalance} then 1 end)`,
    })
    .from(transactions)
    .groupBy(transactions.accountId)
    .all();

  const sumMap = new Map(sums.map((s) => [s.accountId, s]));
  const ctx = currencyContext();
  res.json(
    rows.map((a) => ({
      ...shown(a, a.startingBalance + (sumMap.get(a.id)?.sum ?? 0), sumMap.has(a.id), ctx),
      transactionCount: sumMap.get(a.id)?.count ?? 0,
    })),
  );
});

accountsRouter.get('/balances-ago', (_req, res) => {
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const cutoff = oneMonthAgo.toISOString().slice(0, 10);

  const rows = db.select().from(accounts).where(isNull(accounts.closedAt)).all();
  const sums = db
    .select({
      accountId: transactions.accountId,
      sum: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(and(sql`${transactions.date} < ${cutoff}`, inAccountBalance))
    .groupBy(transactions.accountId)
    .all();

  const sumMap = Object.fromEntries(sums.map((s) => [s.accountId, s.sum]));
  const result: Record<string, number> = {};
  for (const a of rows) {
    result[a.id] = a.startingBalance + (sumMap[a.id] ?? 0);
  }
  res.json(result);
});

accountsRouter.post('/', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const account = {
    id: nanoid(),
    ...parsed.data,
    currency: storedCurrency(parsed.data.currency) ?? null,
    // Homes, cars, investments and loans stay off budget unless asked otherwise
    isOffBudget: parsed.data.isOffBudget ?? defaultOffBudget(parsed.data.type),
    sortOrder: 0,
    closedAt: null,
    createdAt: new Date().toISOString(),
  };
  db.insert(accounts).values(account).run();
  res.status(201).json(withBalance(account as typeof accounts.$inferSelect));
});

accountsRouter.put('/reorder', (req, res) => {
  const parsed = z.object({ ids: z.array(z.string().max(64)).max(10_000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  db.transaction((tx) => {
    parsed.data.ids.forEach((id, i) => {
      tx.update(accounts).set({ sortOrder: i }).where(eq(accounts.id, id)).run();
    });
  });
  res.json({ ok: true });
});

accountsRouter.put('/:id/reconcile', (req, res) => {
  const parsed = z
    .object({ transactionIds: z.array(z.string().max(64)).min(1).max(100_000) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Only this account's transactions
  const result = db
    .update(transactions)
    .set({ reconciled: 1 })
    .where(
      and(
        eq(transactions.accountId, req.params.id),
        inArray(transactions.id, parsed.data.transactionIds),
        ne(transactions.reconciled, 1),
      ),
    )
    .run();

  res.json({ reconciled: result.changes });
});

const storedImportSettings = (id: string) =>
  db
    .select({ importSettings: accounts.importSettings })
    .from(accounts)
    .where(eq(accounts.id, id))
    .get();

accountsRouter.get('/:id/import-settings', (req, res) => {
  const account = storedImportSettings(req.params.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  res.json({
    settings: readImportSettings(account.importSettings),
    statementAccount: readStatementAccount(account.importSettings),
  });
});

/** Saves one part of the import settings (CSV settings or statement account), keeping the other */
function saveImportSettingsPart(
  id: string,
  change: Parameters<typeof storeImportSettings>[1],
): boolean {
  return db.transaction((tx) => {
    const account = tx
      .select({ importSettings: accounts.importSettings })
      .from(accounts)
      .where(eq(accounts.id, id))
      .get();
    if (!account) return false;
    tx.update(accounts)
      .set({ importSettings: storeImportSettings(account.importSettings, change) })
      .where(eq(accounts.id, id))
      .run();
    return true;
  });
}

accountsRouter.put('/:id/import-settings', (req, res) => {
  const parsed = importSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!saveImportSettingsPart(req.params.id, { settings: parsed.data })) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ settings: parsed.data });
});

accountsRouter.put('/:id/statement-account', (req, res) => {
  const parsed = z.object({ account: statementAccountSchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!saveImportSettingsPart(req.params.id, { statementAccount: parsed.data.account })) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ statementAccount: parsed.data.account });
});

accountsRouter.put('/:id', (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = db.select().from(accounts).where(eq(accounts.id, req.params.id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const data = { ...parsed.data };
  if (data.currency !== undefined) {
    const budget = budgetCurrency();
    const before = existing.currency ?? budget;
    const after = data.currency ?? budget;
    if (after !== before) {
      // Its amounts are in its currency: another one would change what they mean
      const any = db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.accountId, existing.id))
        .get();
      if (any) {
        return res.status(409).json({
          error:
            "An account's currency can't change once it has transactions. Add a new account in the other currency and move the money with a transfer.",
        });
      }
    }
    data.currency = storedCurrency(data.currency);
  }

  if (Object.keys(data).length) {
    db.update(accounts).set(data).where(eq(accounts.id, req.params.id)).run();
  }
  const updated = db.select().from(accounts).where(eq(accounts.id, req.params.id)).get()!;
  res.json(withBalance(updated));
});

accountsRouter.delete('/:id', (req, res) => {
  db.update(accounts)
    .set({ closedAt: new Date().toISOString() })
    .where(eq(accounts.id, req.params.id))
    .run();
  res.status(204).send();
});
