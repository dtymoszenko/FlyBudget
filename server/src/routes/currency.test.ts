import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { categories, categoryGroups, transactions } from '../db/schema.js';
import { accountsRouter } from './accounts.js';
import { transactionsRouter } from './transactions.js';
import { budgetRouter } from './budget.js';
import { reportsRouter } from './reports.js';
import { exportRouter } from './export.js';
import { currencyRouter } from './currency.js';

// Multiple currencies: a budget in euros with accounts in dollars and yen. Its own file, so
// the database holds only this test's data.

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use((req, res, next) =>
    req.path === '/api/export/restore' ? next() : express.json({ limit: '10mb' })(req, res, next),
  );
  app.use('/api/accounts', accountsRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/budget', budgetRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/export', exportRouter);
  app.use('/api/currency', currencyRouter);
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  db.insert(categoryGroups).values({ id: 'g-food', name: 'Food', isIncome: 0 }).run();
  db.insert(categories).values({ id: 'c-food', groupId: 'g-food', name: 'Groceries' }).run();
  db.insert(categoryGroups).values({ id: 'g-income', name: 'Income', isIncome: 1 }).run();
  db.insert(categories).values({ id: 'c-pay', groupId: 'g-income', name: 'Paycheck' }).run();
});
afterAll(() => server.close());

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // CSV
  }
  return { status: res.status, body: parsed as any };
};

const row = (id: string) => db.select().from(transactions).where(eq(transactions.id, id)).get()!;
async function account(name: string, currency?: string, startingBalance = 0) {
  const { status, body } = await call('POST', '/accounts', {
    name,
    type: 'checking',
    startingBalance,
    ...(currency ? { currency } : {}),
  });
  expect(status).toBe(201);
  return body as { id: string; currency: string | null };
}
const add = async (accountId: string, date: string, amount: number, categoryId = 'c-food') => {
  const { status, body } = await call('POST', '/transactions', {
    accountId,
    date,
    amount,
    payeeName: 'Shop',
    categoryId,
  });
  expect(status).toBe(201);
  return body as { id: string; mainAmount: number | null; mainAmountSource: string | null };
};
const rate = (date: string, base: string, quote: string, value: string) =>
  call('POST', '/currency/rates', { date, base, quote, rate: value });

describe('multiple currencies', () => {
  let euros: string;
  let dollars: string;
  let yen: string;

  it('takes the first account currency as the budget currency', async () => {
    expect((await call('GET', '/currency')).body.currency).toBeNull();
    const first = await account('Girokonto', 'EUR');
    euros = first.id;
    // Stored as "the budget's", shown as EUR
    expect(first.currency).toBe('EUR');
    expect((await call('GET', '/currency')).body.currency).toBe('EUR');
    dollars = (await account('US checking', 'USD')).id;
    yen = (await account('Tokyo cash', 'jpy')).id;
    const listed = (await call('GET', '/accounts')).body as { id: string; currency: string }[];
    expect(listed.find((a) => a.id === yen)!.currency).toBe('JPY');
    expect(
      (await call('POST', '/accounts', { name: 'X', type: 'cash', currency: 'XYZ' })).status,
    ).toBe(400);
  });

  it('keeps a value in the budget currency, and marks it missing (counted as 0) without a rate', async () => {
    const before = await add(dollars, '2025-03-10', -10_812);
    expect(before).toMatchObject({ mainAmount: null, mainAmountSource: 'missing' });
    const summary = (await call('GET', '/currency/missing')).body;
    expect(summary).toMatchObject({ count: 1, currencies: ['USD'] });
    expect((await call('GET', '/budget/2025-03')).body).toBeTruthy();

    // A rate typed in fills it in: 108.12 USD at 1.0812 USD per euro is 100 EUR
    expect((await rate('2025-03-07', 'EUR', 'USD', '1.0812')).status).toBe(201);
    expect(row(before.id)).toMatchObject({ mainAmount: -10_000, mainAmountSource: 'rate' });
    expect((await call('GET', '/currency/missing')).body.count).toBe(0);

    // The same day's euro transactions keep no value of their own
    const local = await add(euros, '2025-03-10', -500);
    expect(local).toMatchObject({ mainAmount: null, mainAmountSource: null });
  });

  it('converts yen (no decimals) through the euro rates', async () => {
    await rate('2025-03-01', 'EUR', 'JPY', '160');
    const t = await add(yen, '2025-03-12', -16_000);
    expect(row(t.id)).toMatchObject({ mainAmount: -10_000, mainAmountSource: 'rate' });
  });

  it('counts the values in the budget and in spending reports', async () => {
    const month = (await call('GET', '/budget/2025-03')).body;
    const food = JSON.stringify(month);
    expect(food).toBeTruthy();
    const spending = (await call('GET', '/reports/spending-by-category?from=2025-03&to=2025-03'))
      .body as { totalSpent: number }[];
    const total = spending.reduce((s, r) => s + r.totalSpent, 0);
    // 100 EUR (dollars) + 5 EUR + 100 EUR (yen)
    expect(total).toBe(20_500);
  });

  it('keeps a value typed in, until the amount changes', async () => {
    const t = await add(dollars, '2025-03-15', -2_000);
    const edited = await call('PUT', `/transactions/${t.id}`, { mainAmount: -1_900 });
    expect(edited.status).toBe(200);
    expect(row(t.id)).toMatchObject({ mainAmount: -1_900, mainAmountSource: 'manual' });
    await call('PUT', `/transactions/${t.id}`, { notes: 'card statement' });
    expect(row(t.id).mainAmountSource).toBe('manual');
    await call('PUT', `/transactions/${t.id}`, { amount: -3_000 });
    expect(row(t.id)).toMatchObject({ mainAmountSource: 'rate', mainAmount: -2_775 });
    // Not for a euro account: its amount is the value
    const local = await add(euros, '2025-03-15', -100);
    expect((await call('PUT', `/transactions/${local.id}`, { mainAmount: -90 })).status).toBe(400);
  });

  it('moves money between currencies with two amounts that add up to zero in euros', async () => {
    // Without what arrived: the day's rate
    const atRate = await call('POST', '/transactions/transfer', {
      fromAccountId: euros,
      toAccountId: dollars,
      date: '2025-03-20',
      amount: 10_000,
    });
    expect(atRate.status).toBe(201);
    expect(atRate.body[1]).toMatchObject({ amount: 10_812, mainAmount: 10_000 });
    const pounds = (await account('Pounds', 'GBP')).id;
    expect(
      (
        await call('POST', '/transactions/transfer', {
          fromAccountId: euros,
          toAccountId: pounds,
          date: '2025-03-20',
          amount: 10_000,
        })
      ).status,
    ).toBe(422);
    const { status, body } = await call('POST', '/transactions/transfer', {
      fromAccountId: euros,
      toAccountId: dollars,
      date: '2025-03-20',
      amount: 50_000,
      toAmount: 53_900,
    });
    expect(status).toBe(201);
    const [out, into] = body as { id: string }[];
    expect(row(out.id)).toMatchObject({ amount: -50_000, mainAmount: null });
    expect(row(into.id)).toMatchObject({
      amount: 53_900,
      mainAmount: 50_000,
      mainAmountSource: 'transfer',
    });

    // Editing what arrived doesn't change what left
    expect((await call('PUT', `/transactions/${into.id}`, { amount: 54_000 })).status).toBe(200);
    expect(row(out.id).amount).toBe(-50_000);
    expect(row(into.id)).toMatchObject({ amount: 54_000, mainAmount: 50_000 });
    // …and what left is the value of both
    await call('PUT', `/transactions/${out.id}`, { amount: -49_000 });
    expect(row(into.id)).toMatchObject({ amount: 54_000, mainAmount: 49_000 });
  });

  it('turns an existing transaction into a cross-currency transfer at the day rate', async () => {
    const t = await add(euros, '2025-03-21', -10_000);
    const { status, body } = await call('POST', `/transactions/${t.id}/transfer`, {
      accountId: dollars,
    });
    expect(status).toBe(200);
    const [, other] = body.transactions;
    expect(other.amount).toBe(10_812);
    expect(other.mainAmount).toBe(10_000);
    // No rate for a currency nobody entered: ask for what arrived
    const pounds = (await account('UK account', 'GBP')).id;
    expect(pounds).toBeTruthy();
    const u = await add(euros, '2025-03-22', -1_000);
    expect(
      (await call('POST', `/transactions/${u.id}/transfer`, { accountId: pounds })).status,
    ).toBe(422);
    const given = await call('POST', `/transactions/${u.id}/transfer`, {
      accountId: pounds,
      otherAmount: 850,
    });
    expect(given.body.transactions[1]).toMatchObject({ amount: 850, mainAmount: 1_000 });
  });

  it('suggests a transfer between currencies by its value', async () => {
    const swiss = (await account('Swiss account', 'CHF')).id;
    await rate('2025-04-01', 'EUR', 'CHF', '0.95');
    // Imported, so both are ordinary rows: 200 EUR out, 189.50 CHF in (0.25% off the ECB rate)
    await call('POST', '/transactions/import/confirm', {
      accountId: euros,
      rows: [{ date: '2025-04-02', amount: -20_000, payeeName: 'TO SWISS', importedId: 'x-1' }],
    });
    await call('POST', '/transactions/import/confirm', {
      accountId: swiss,
      rows: [{ date: '2025-04-03', amount: 18_950, payeeName: 'FROM GERMANY', importedId: 'x-2' }],
    });
    const suggestions = (await call('GET', '/transactions/transfers/suggestions')).body as {
      outflow: { importedId: string };
      inflow: { importedId: string };
    }[];
    expect(
      suggestions.some((s) => s.outflow.importedId === 'x-1' && s.inflow.importedId === 'x-2'),
    ).toBe(true);
  });

  it("refuses to change an account's currency once it has transactions", async () => {
    expect((await call('PUT', `/accounts/${dollars}`, { currency: 'CAD' })).status).toBe(409);
    const empty = await account('Empty', 'CAD');
    expect((await call('PUT', `/accounts/${empty.id}`, { currency: 'AUD' })).status).toBe(200);
  });

  it("can't relabel the budget currency while accounts in other currencies have history", async () => {
    expect((await call('PUT', '/currency', { currency: 'USD' })).status).toBe(409);
  });

  it('values net worth at the rate of the day', async () => {
    const points = (await call('GET', '/reports/net-worth?from=2025-03&to=2025-03')).body as {
      netWorth: number;
      unconverted?: string[];
    }[];
    expect(points).toHaveLength(1);
    // The GBP account has 850 GBP and no GBP rate: left out, and said so
    expect(points[0].unconverted).toEqual(['GBP']);
  });

  it('shows what a change in the rate did, and records it only when asked', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await rate(today, 'EUR', 'USD', '1.2');
    const listed = async () =>
      (
        (await call('GET', '/accounts')).body as { id: string; currencyDifference: number | null }[]
      ).find((a) => a.id === dollars)!;
    const before = await listed();
    expect(before.currencyDifference).not.toBeNull();
    expect(before.currencyDifference).toBeLessThan(0);
    const recorded = await call('POST', '/currency/difference', {
      accountId: dollars,
      categoryId: 'c-food',
    });
    expect(recorded.status).toBe(201);
    expect(recorded.body).toMatchObject({
      amount: 0,
      mainAmount: before.currencyDifference,
      isAdjustment: 1,
    });
    expect((await listed()).currencyDifference).toBe(0);
    expect(
      (await call('POST', '/currency/difference', { accountId: dollars, categoryId: null })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/currency/difference', { accountId: euros, categoryId: null })).status,
    ).toBe(400);
  });

  it('exports the currency and the value with each transaction', async () => {
    const csv = (await call('GET', '/export/transactions/csv')).body as string;
    const [header] = csv.split('\n');
    expect(header).toContain('Currency');
    expect(header).toContain('Amount (EUR)');
    expect(csv).toContain('JPY');
  });

  it('keeps currencies, rates and values through a backup, and an old backup keeps the currency', async () => {
    const backup = (await call('GET', '/export/backup')).body;
    expect(backup.version).toBe(3);
    expect(backup.budgetSettings[0]).toMatchObject({ currency: 'EUR' });
    expect(backup.exchangeRates.length).toBeGreaterThan(0);
    const before = db.select().from(transactions).all();

    expect((await call('POST', '/export/restore', backup)).status).toBe(200);
    expect(db.select().from(transactions).all()).toEqual(before);
    expect((await call('GET', '/currency')).body.currency).toBe('EUR');

    // From before currencies: no settings in it, and its amounts are all in the budget's
    const old = {
      format: 'flybudget-backup',
      version: 2,
      accounts: [{ id: 'old', name: 'Old checking', type: 'checking', startingBalance: 100 }],
    };
    expect((await call('POST', '/export/restore', old)).status).toBe(200);
    expect((await call('GET', '/currency')).body.currency).toBe('EUR');
    expect((await call('GET', '/accounts')).body[0]).toMatchObject({
      currency: 'EUR',
      balance: 100,
    });
  });
});
