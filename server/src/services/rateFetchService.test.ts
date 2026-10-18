import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accounts, exchangeRates, transactions } from '../db/schema.js';
import {
  fetchRates,
  fetchRatesIfDue,
  ratesFromResponse,
  RateFetchError,
} from './rateFetchService.js';
import { getBudgetSettings, updateBudgetSettings } from './mainAmountService.js';

// Downloading ECB rates from a stand-in for Frankfurter (FLYBUDGET_EXCHANGE_RATES_URL)

let server: http.Server;
const requests: string[] = [];

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  server = http.createServer((req, res) => {
    requests.push(req.url!);
    const url = new URL(req.url!, 'http://x');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/v1/currencies') {
      return res.end(JSON.stringify({ EUR: 'Euro', USD: 'US Dollar', GBP: 'British Pound' }));
    }
    const range = /^\/v1\/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(url.pathname);
    if (range) {
      const symbols = url.searchParams.get('symbols')!.split(',');
      const rates: Record<string, Record<string, number>> = {};
      for (const day of ['2025-01-02', '2025-01-03']) {
        if (day >= range[1] && day <= range[2]) {
          rates[day] = Object.fromEntries(symbols.map((s) => [s, s === 'USD' ? 1.04 : 0.83]));
        }
      }
      return res.end(JSON.stringify({ amount: 1, base: 'EUR', rates }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  process.env.FLYBUDGET_EXCHANGE_RATES_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => {
  delete process.env.FLYBUDGET_EXCHANGE_RATES_URL;
  server.close();
});

describe('ratesFromResponse', () => {
  it('keeps valid rates as text and drops the rest', () => {
    const rows = ratesFromResponse({
      base: 'EUR',
      rates: { '2025-01-02': { USD: 1.0812, XYZ: 2, GBP: -1 }, nonsense: { USD: 1 } },
    });
    expect(rows).toEqual([
      {
        id: 'ecb:2025-01-02:EUR:USD',
        date: '2025-01-02',
        base: 'EUR',
        quote: 'USD',
        rate: '1.0812',
        source: 'ecb',
      },
    ]);
    expect(() => ratesFromResponse({ base: 'USD', rates: {} })).toThrow(RateFetchError);
    expect(() => ratesFromResponse('<html>')).toThrow(RateFetchError);
  });
});

describe('fetchRates', () => {
  it('downloads the currencies in use and fills in transactions waiting for a rate', async () => {
    updateBudgetSettings({ currency: 'EUR', ratesEnabled: 1 });
    db.insert(accounts).values({ id: 'usd', name: 'US', type: 'checking', currency: 'USD' }).run();
    db.insert(accounts)
      .values({ id: 'aed', name: 'Dubai', type: 'checking', currency: 'AED' })
      .run();
    db.insert(transactions)
      .values({
        id: 't1',
        accountId: 'usd',
        date: '2025-01-03',
        amount: -10_400,
        mainAmountSource: 'missing',
      })
      .run();

    const result = await fetchRates();
    expect(result.unsupported).toEqual(['AED']);
    expect(result.stored).toBe(2);
    // Only the currencies the budget uses, from a week before its oldest transaction
    expect(
      requests.some((r) => r.startsWith('/v1/2024-12-27..') && r.includes('symbols=USD')),
    ).toBe(true);
    expect(
      db
        .select()
        .from(exchangeRates)
        .all()
        .map((r) => r.id)
        .sort(),
    ).toEqual(['ecb:2025-01-02:EUR:USD', 'ecb:2025-01-03:EUR:USD']);
    expect(db.select().from(transactions).where(eq(transactions.id, 't1')).get()).toMatchObject({
      mainAmount: -10_000,
      mainAmountSource: 'rate',
    });
    expect(getBudgetSettings()).toMatchObject({ ratesLastError: null });
    expect(getBudgetSettings().ratesLastFetchedAt).not.toBeNull();
  });

  it("doesn't download again within a few hours, nor when it's turned off", async () => {
    const before = requests.length;
    await fetchRatesIfDue();
    expect(requests.length).toBe(before);
    updateBudgetSettings({ ratesEnabled: 0, ratesLastFetchedAt: null });
    await fetchRatesIfDue();
    expect(requests.length).toBe(before);
  });

  it('saves a message to show when the server answers with an error', async () => {
    const real = process.env.FLYBUDGET_EXCHANGE_RATES_URL!;
    process.env.FLYBUDGET_EXCHANGE_RATES_URL = `${real}/missing`;
    await expect(fetchRates()).rejects.toThrow('The exchange rate server answered 404');
    expect(getBudgetSettings().ratesLastError).toBe('The exchange rate server answered 404');
    process.env.FLYBUDGET_EXCHANGE_RATES_URL = real;
  });
});
