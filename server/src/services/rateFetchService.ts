// Downloading ECB reference rates, only when the user turned it on (Settings → Currencies):
// it's a request to another server. Frankfurter (https://frankfurter.dev, open source and
// self-hostable) serves the European Central Bank's daily rates against the euro, with
// history back to 1999. Node only: the demo can't download rates (see browser/app.ts).
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { accounts, exchangeRates, transactions } from '../db/schema.js';
import { isCurrencyCode, isForeign } from '../utils/currencies.js';
import { parseRate } from '../utils/money.js';
import { ECB_BASE } from './exchangeRates.js';
import {
  fillMissingMainAmounts,
  getBudgetSettings,
  ratesChanged,
  todayIso,
  updateBudgetSettings,
} from './mainAmountService.js';
import { fetch, type Response } from 'undici';
import { readTextLimited, safeFetch } from './safeFetch.js';

/** Frankfurter's public server */
export const DEFAULT_RATES_URL = 'https://api.frankfurter.dev/v1';

/** The first day the ECB published euro rates */
const ECB_FIRST_DAY = '1999-01-04';
const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Download again after this long (the ECB publishes once a working day, around 16:00 CET) */
export const RATES_REFRESH_MS = 12 * 60 * 60 * 1000;

/** A message safe to show the user */
export class RateFetchError extends Error {
  override name = 'RateFetchError';
}

const ratesResponse = z.object({
  base: z.string(),
  rates: z.record(z.string(), z.record(z.string(), z.number())),
});
const currenciesResponse = z.record(z.string(), z.string());

/**
 * Rows to store from a Frankfurter time series answer (`/2024-01-01..2024-01-31?base=EUR`):
 * every valid date, currency and positive rate. Pure, so it's tested without a network.
 */
export function ratesFromResponse(body: unknown) {
  const parsed = ratesResponse.safeParse(body);
  if (!parsed.success || parsed.data.base !== ECB_BASE) {
    throw new RateFetchError('The exchange rate server sent something unexpected');
  }
  const rows: Array<typeof exchangeRates.$inferInsert> = [];
  for (const [date, quotes] of Object.entries(parsed.data.rates)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const [quote, value] of Object.entries(quotes)) {
      if (!isCurrencyCode(quote) || !Number.isFinite(value) || value <= 0) continue;
      // Rates come as JSON numbers with a few digits ("1.0812"): kept as that text
      const text = String(value);
      if (!parseRate(text)) continue;
      rows.push({
        id: `ecb:${date}:${ECB_BASE}:${quote}`,
        date,
        base: ECB_BASE,
        quote,
        rate: text,
        source: 'ecb',
      });
    }
  }
  return rows;
}

/** Where to download from: the URL chosen in Settings, else the operator's, else Frankfurter's */
function source(): { url: string; trusted: boolean } {
  const chosen = getBudgetSettings().ratesUrl;
  if (chosen) return { url: chosen, trusted: false };
  // Set by whoever runs the server (a self-hosted Frankfurter on the same network, or the
  // tests' stand-in): fetched directly, since safeFetch refuses private addresses
  const operator = process.env.FLYBUDGET_EXCHANGE_RATES_URL;
  if (operator) return { url: operator, trusted: true };
  return { url: DEFAULT_RATES_URL, trusted: false };
}

async function getJson(url: string, trusted: boolean): Promise<unknown> {
  let response: Response;
  try {
    response = trusted
      ? await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      : await safeFetch(url, {}, { timeoutMs: TIMEOUT_MS });
  } catch {
    throw new RateFetchError("Couldn't reach the exchange rate server");
  }
  if (!response.ok) {
    throw new RateFetchError(`The exchange rate server answered ${response.status}`);
  }
  try {
    return JSON.parse(await readTextLimited(response, MAX_RESPONSE_BYTES));
  } catch {
    throw new RateFetchError('The exchange rate server sent something unexpected');
  }
}

/** The currencies whose rates are needed: every account's and the budget's, other than the euro */
function currenciesInUse(budget: string): string[] {
  const own = db
    .selectDistinct({ currency: accounts.currency })
    .from(accounts)
    .where(isNotNull(accounts.currency))
    .all()
    .map((r) => r.currency!)
    .filter((c) => isForeign(c, budget));
  if (!own.length) return [];
  return [...new Set([...own, budget])].filter((c) => c !== ECB_BASE).sort();
}

/** The earliest day a rate is needed: the oldest transaction in an account with another currency */
function earliestNeeded(budget: string): string {
  const row = db
    .select({ d: sql<string | null>`min(${transactions.date})` })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(isNotNull(accounts.currency), sql`${accounts.currency} <> ${budget}`))
    .get();
  return row?.d ?? todayIso();
}

const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The ranges to download: before the oldest stored rate (a week early, for weekends) and after the newest */
function rangesNeeded(quotes: string[], from: string, to: string): Array<[string, string]> {
  const stored = db
    .select({
      quote: exchangeRates.quote,
      first: sql<string>`min(${exchangeRates.date})`,
      last: sql<string>`max(${exchangeRates.date})`,
    })
    .from(exchangeRates)
    .where(and(eq(exchangeRates.source, 'ecb'), inArray(exchangeRates.quote, quotes)))
    .groupBy(exchangeRates.quote)
    .all();
  const early = addDaysIso(from, -7);
  const start = early < ECB_FIRST_DAY ? ECB_FIRST_DAY : early;
  const byQuote = new Map(stored.map((s) => [s.quote, s]));
  if (quotes.some((q) => !byQuote.has(q))) return [[start, to]];
  const ranges: Array<[string, string]> = [];
  // Older transactions than any stored rate (an import of last year's statements)
  const firstOfAll = stored.reduce((m, s) => (s.first > m ? s.first : m), stored[0].first);
  if (start < firstOfAll) ranges.push([start, firstOfAll]);
  // Days since the last download
  const lastOfAll = stored.reduce((m, s) => (s.last < m ? s.last : m), stored[0].last);
  if (addDaysIso(lastOfAll, 1) <= to) ranges.push([addDaysIso(lastOfAll, 1), to]);
  return ranges;
}

/** A range split into pieces of at most a year (one request each) */
function yearChunks([from, to]: [string, string]): Array<[string, string]> {
  const chunks: Array<[string, string]> = [];
  let start = from;
  while (start <= to) {
    const end = addDaysIso(start, 365) < to ? addDaysIso(start, 365) : to;
    chunks.push([start, end]);
    start = addDaysIso(end, 1);
  }
  return chunks;
}

export interface FetchResult {
  stored: number;
  /** Currencies the ECB doesn't publish: they need rates typed in */
  unsupported: string[];
}

let running: Promise<FetchResult> | null = null;

/** Downloads the rates the budget needs and fills in transactions that were waiting for one */
export function fetchRates(): Promise<FetchResult> {
  // One download at a time (startup, the timer and "Fetch now" can overlap)
  return (running ??= download().finally(() => (running = null)));
}

async function download(): Promise<FetchResult> {
  const settings = getBudgetSettings();
  const budget = settings.currency;
  try {
    if (!budget) return { stored: 0, unsupported: [] };
    const wanted = currenciesInUse(budget);
    if (!wanted.length) {
      updateBudgetSettings({ ratesLastFetchedAt: new Date().toISOString(), ratesLastError: null });
      return { stored: 0, unsupported: [] };
    }
    const { url, trusted } = source();
    const base = url.replace(/\/+$/, '');
    const offered = currenciesResponse.safeParse(await getJson(`${base}/currencies`, trusted));
    if (!offered.success)
      throw new RateFetchError('The exchange rate server sent something unexpected');
    const quotes = wanted.filter((c) => c in offered.data);
    const unsupported = wanted.filter((c) => !(c in offered.data));

    let stored = 0;
    if (quotes.length) {
      const today = todayIso();
      for (const range of rangesNeeded(quotes, earliestNeeded(budget), today)) {
        for (const [from, to] of yearChunks(range)) {
          const query = new URLSearchParams({ base: ECB_BASE, symbols: quotes.join(',') });
          const rows = ratesFromResponse(await getJson(`${base}/${from}..${to}?${query}`, trusted));
          db.transaction(() => {
            for (const row of rows) {
              db.insert(exchangeRates)
                .values(row)
                .onConflictDoUpdate({ target: exchangeRates.id, set: { rate: row.rate } })
                .run();
            }
          });
          stored += rows.length;
        }
      }
    }
    ratesChanged();
    fillMissingMainAmounts();
    updateBudgetSettings({ ratesLastFetchedAt: new Date().toISOString(), ratesLastError: null });
    return { stored, unsupported };
  } catch (err) {
    const message =
      err instanceof RateFetchError ? err.message : "Couldn't download exchange rates";
    if (!(err instanceof RateFetchError)) console.error('Exchange rate download failed:', err);
    updateBudgetSettings({ ratesLastError: message });
    throw new RateFetchError(message);
  }
}

/** On startup and every few hours: download if it's turned on and hasn't run lately */
export async function fetchRatesIfDue(now = Date.now()): Promise<void> {
  const settings = getBudgetSettings();
  if (!settings.ratesEnabled || !settings.currency) return;
  const last = settings.ratesLastFetchedAt ? Date.parse(settings.ratesLastFetchedAt) : 0;
  if (now - last < RATES_REFRESH_MS) return;
  try {
    await fetchRates();
  } catch {
    // Saved as ratesLastError and shown in Settings
  }
}
