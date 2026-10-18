// /api/currency: the budget's currency, exchange rates (typed in or downloaded), and
// transactions waiting for a rate. Loaded by the demo too, so no network code here: the
// download is plugged in by index.ts (setRateDownloader).
import { Router } from 'express';
import { and, desc, eq, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { accounts, budgetMonths, exchangeRates, transactions } from '../db/schema.js';
import { isForeign, minorUnits } from '../utils/currencies.js';
import { convertMinor, formatRate, parseRate } from '../utils/money.js';
import { currencySchema, isoDate } from '../utils/validation.js';
import { insertNewTransaction } from '../services/ruleService.js';
import { accountTransactionSum } from '../services/balances.js';
import {
  accountCurrencies,
  bookedValue,
  budgetCurrency,
  currencyContext,
  fillMissingMainAmounts,
  getBudgetSettings,
  loadRateBook,
  missingRateSummary,
  ratesChanged,
  recalculateMainAmounts,
  todayIso,
  updateBudgetSettings,
  valueToday,
} from '../services/mainAmountService.js';

export const currencyRouter = Router();

/** What downloading rates does; set by index.ts (the demo has none) */
type RateDownloader = () => Promise<{ stored: number; unsupported: string[] }>;
let downloadRates: RateDownloader | null = null;
/** The URL check for a chosen rate server (https, public): set with the downloader */
let checkRatesUrl: (url: string) => void = () => {};
let defaultRatesUrl: string | null = null;

export function setRateDownloader(opts: {
  download: RateDownloader;
  checkUrl: (url: string) => void;
  defaultUrl: string;
}) {
  downloadRates = opts.download;
  checkRatesUrl = opts.checkUrl;
  defaultRatesUrl = opts.defaultUrl;
}

/** Currencies the budget's accounts are in, other than the budget's own */
function foreignCurrencies(): string[] {
  const budget = budgetCurrency();
  return [...new Set([...accountCurrencies().values()])]
    .filter((c): c is string => !!c && isForeign(c, budget))
    .sort();
}

/**
 * Whether the budget's currency can be changed to `next` by relabelling (no amount changes):
 * no account with transactions or a balance would end up in another currency than the budget,
 * and amounts already in the budget's currency keep meaning the same (amounts are stored in
 * minor units: from dollars to yen, 10.00 would become 1,000)
 */
function relabelBlocker(current: string | null, next: string): string | null {
  const used = new Set(
    db
      .selectDistinct({ accountId: transactions.accountId })
      .from(transactions)
      .all()
      .map((r) => r.accountId),
  );
  const all = db.select().from(accounts).all();
  const hasAmounts = (a: (typeof all)[number]) => a.startingBalance !== 0 || used.has(a.id);
  if (minorUnits(current) !== minorUnits(next)) {
    const planned = db
      .select({ id: budgetMonths.id })
      .from(budgetMonths)
      .where(ne(budgetMonths.budgeted, 0))
      .get();
    if (planned || all.some((a) => !a.currency && hasAmounts(a))) {
      return `Your budget already has amounts in ${current ?? 'its currency'}, and ${next} has a different number of decimals, so they would change. Choose a currency with ${minorUnits(current)} decimals, or start a new budget.`;
    }
  }
  const blocked = all.some((a) => hasAmounts(a) && a.currency && a.currency !== next);
  return blocked
    ? "Your budget has accounts in other currencies. Changing its currency would mean converting every amount, which FlyBudget can't do yet."
    : null;
}

function settingsResponse() {
  const s = getBudgetSettings();
  const latest = latestRates(s.currency);
  return {
    currency: s.currency,
    ratesEnabled: s.ratesEnabled === 1,
    ratesUrl: s.ratesUrl,
    defaultRatesUrl,
    canDownload: downloadRates !== null,
    lastFetchedAt: s.ratesLastFetchedAt,
    lastError: s.ratesLastError,
    foreignCurrencies: foreignCurrencies(),
    latestRates: latest,
    missing: missingRateSummary(),
  };
}

/** For each currency in use: today's rate to the budget's (or the latest within a month) */
function latestRates(budget: string | null) {
  if (!budget) return [];
  const book = loadRateBook();
  const today = todayIso();
  return foreignCurrencies().map((currency) => {
    const found = book.find(currency, budget, today);
    return {
      currency,
      rate: found ? formatRate(found.rate) : null,
      date: found?.date ?? null,
      source: found?.source ?? null,
    };
  });
}

currencyRouter.get('/', (_req, res) => res.json(settingsResponse()));

// PUT /currency — the budget's currency: chosen once, or corrected while nothing depends on it
currencyRouter.put('/', (req, res) => {
  const parsed = z.object({ currency: currencySchema }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const next = parsed.data.currency;
  const current = budgetCurrency();
  if (current !== next) {
    const blocker = relabelBlocker(current, next);
    if (blocker) return res.status(409).json({ error: blocker });
    db.transaction(() => {
      updateBudgetSettings({ currency: next });
      // Accounts that named the new currency are now simply in the budget's
      db.update(accounts).set({ currency: null }).where(eq(accounts.currency, next)).run();
    });
    fillMissingMainAmounts();
  }
  res.json(settingsResponse());
});

// PUT /currency/download — turn downloading ECB rates on or off, and where from
currencyRouter.put('/download', (req, res) => {
  const parsed = z
    .object({
      enabled: z.boolean().optional(),
      url: z.string().trim().max(500).nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { enabled, url } = parsed.data;
  if (url) {
    try {
      checkRatesUrl(url);
    } catch {
      return res.status(400).json({ error: 'Use an https:// address of a public server' });
    }
  }
  updateBudgetSettings({
    ...(enabled !== undefined ? { ratesEnabled: enabled ? 1 : 0 } : {}),
    // A new server: the next check downloads right away
    ...(url !== undefined ? { ratesUrl: url || null, ratesLastFetchedAt: null } : {}),
    ...(enabled === false ? { ratesLastError: null } : {}),
  });
  res.json(settingsResponse());
});

// POST /currency/download — "Download now"
currencyRouter.post('/download', async (_req, res) => {
  if (!downloadRates) {
    return res.status(403).json({ error: "Downloading rates isn't available here." });
  }
  try {
    const result = await downloadRates();
    res.json({ ...result, settings: settingsResponse() });
  } catch (err) {
    // RateFetchError messages are written for the user; anything else stays generic
    const message = err instanceof Error && err.name === 'RateFetchError' ? err.message : null;
    res.status(422).json({
      error: message ?? getBudgetSettings().ratesLastError ?? "Couldn't download exchange rates",
    });
  }
});

const pairQuery = z.object({
  base: currencySchema.optional(),
  quote: currencySchema.optional(),
  source: z.enum(['manual', 'ecb']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

// GET /currency/rates?base=&quote=&source= — stored rates, newest first
currencyRouter.get('/rates', (req, res) => {
  const parsed = pairQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { base, quote, source, limit } = parsed.data;
  const where = [];
  if (base && quote) {
    where.push(
      or(
        and(eq(exchangeRates.base, base), eq(exchangeRates.quote, quote)),
        and(eq(exchangeRates.base, quote), eq(exchangeRates.quote, base)),
      ),
    );
  } else if (base) where.push(or(eq(exchangeRates.base, base), eq(exchangeRates.quote, base)));
  else if (quote) where.push(eq(exchangeRates.quote, quote));
  if (source) where.push(eq(exchangeRates.source, source));
  res.json(
    db
      .select()
      .from(exchangeRates)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(exchangeRates.date), exchangeRates.source)
      .limit(limit)
      .all(),
  );
});

// GET /currency/convert?from=&to=&date=&amount= — an amount at the day's rate (the transfer
// form fills in what arrives with it)
currencyRouter.get('/convert', (req, res) => {
  const parsed = z
    .object({
      from: currencySchema,
      to: currencySchema,
      date: isoDate,
      amount: z.coerce.number().int().min(-1e13).max(1e13),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { from, to, date, amount } = parsed.data;
  const found = loadRateBook().find(from, to, date);
  if (!found) return res.json({ amount: null, rate: null, date: null, source: null });
  let converted: number | null = null;
  try {
    converted = convertMinor(amount, minorUnits(from), minorUnits(to), found.rate);
  } catch {
    // Too big to count exactly: no suggestion
  }
  res.json({
    amount: converted,
    rate: formatRate(found.rate),
    date: found.date,
    source: found.source,
  });
});

const manualRateSchema = z
  .object({
    date: isoDate,
    base: currencySchema,
    quote: currencySchema,
    rate: z.string().trim().max(30),
  })
  .refine((r) => r.base !== r.quote, 'Choose two different currencies')
  .refine((r) => parseRate(r.rate) !== null, {
    message: 'Type the rate as a positive number, like 1.0812',
    path: ['rate'],
  });

// POST /currency/rates — a rate typed in (overrides the ECB's for that day and pair)
currencyRouter.post('/rates', (req, res) => {
  const parsed = manualRateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { date, base, quote } = parsed.data;
  const rate = formatRate(parseRate(parsed.data.rate)!, 12);
  const row = { id: `manual:${date}:${base}:${quote}`, date, base, quote, rate, source: 'manual' };
  db.insert(exchangeRates)
    .values(row)
    .onConflictDoUpdate({ target: exchangeRates.id, set: { rate } })
    .run();
  ratesChanged();
  fillMissingMainAmounts();
  res.status(201).json(row);
});

// DELETE /currency/rates/:id — only rates typed in (downloaded ones come back anyway)
currencyRouter.delete('/rates/:id', (req, res) => {
  const result = db
    .delete(exchangeRates)
    .where(and(eq(exchangeRates.id, req.params.id), eq(exchangeRates.source, 'manual')))
    .run();
  if (!result.changes) return res.status(404).json({ error: 'Not found' });
  ratesChanged();
  res.status(204).send();
});

const recalculateSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  accountIds: z.array(z.string().max(64)).max(1000).optional(),
  dryRun: z.boolean().optional(),
});

// POST /currency/recalculate — values from a rate worked out again with the stored rates
// (after correcting a rate); typed-in values and reconciled transactions stay
currencyRouter.post('/recalculate', (req, res) => {
  const parsed = recalculateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const changed = recalculateMainAmounts(parsed.data);
  res.json({ changed, missing: missingRateSummary() });
});

// POST /currency/difference — "Record currency difference": an account in another currency
// is worth more or less in the budget's than it was counted as (the rate moved). Recording it
// adds a correction worth that difference, in a category the user picks (a gain as income, a
// loss as spending), so the budget follows. Never done on its own.
currencyRouter.post('/difference', (req, res) => {
  const parsed = z
    .object({ accountId: z.string().min(1).max(64), categoryId: z.string().max(64).nullable() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const account = db.select().from(accounts).where(eq(accounts.id, parsed.data.accountId)).get();
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const ctx = currencyContext();
  const currency = account.currency ?? ctx.budget;
  if (!isForeign(currency, ctx.budget)) {
    return res.status(400).json({ error: "This account is in the budget's currency" });
  }
  const balance = account.startingBalance + accountTransactionSum(account.id);
  const now = valueToday(balance, currency, ctx).mainBalance;
  const booked = bookedValue(account, ctx);
  if (now === null || booked === null) {
    return res.status(422).json({ error: 'Some of its rates are missing: add them first' });
  }
  const difference = now - booked;
  if (difference === 0) return res.status(400).json({ error: 'There is no difference to record' });
  const { transaction } = insertNewTransaction({
    accountId: account.id,
    date: todayIso(),
    amount: 0,
    payeeId: null,
    payeeName: 'Currency difference',
    importedPayee: null,
    notes: `${currency} rate change`,
    categoryId: parsed.data.categoryId,
    importedId: null,
    isAdjustment: true,
  });
  db.update(transactions)
    .set({ mainAmount: difference, mainAmountSource: 'manual' })
    .where(eq(transactions.id, transaction.id))
    .run();
  res.status(201).json({
    ...db.select().from(transactions).where(eq(transactions.id, transaction.id)).get(),
  });
});

// GET /currency/missing — transactions waiting for a rate, for the warning banners
currencyRouter.get('/missing', (_req, res) => {
  const missing = missingRateSummary();
  const oldest = missing.count
    ? (db
        .select({ date: sql<string>`min(${transactions.date})` })
        .from(transactions)
        .where(eq(transactions.mainAmountSource, 'missing'))
        .get()?.date ?? null)
    : null;
  res.json({ ...missing, oldest });
});
