import { afterAll, beforeAll, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db/index.js';
import { categories, categoryGroups } from '../db/schema.js';
import { accountsRouter } from './accounts.js';
import { reportsRouter } from './reports.js';
import { rulesRouter } from './rules.js';
import { transactionsRouter } from './transactions.js';

// Balance corrections (reconciliation, "Update value") change a balance, but they aren't
// money earned or spent. Its own file, so the database holds only this test's data.

let server: Server;
let base: string;
const month = '2096-05';

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', accountsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/rules', rulesRouter);
  app.use('/api/transactions', transactionsRouter);
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server.close());

const send = (method: string, path: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => r.json());

it('an uncategorized adjustment changes the balance but is neither income nor spending', async () => {
  db.insert(categoryGroups).values({ id: 'g-inc', name: 'Income', isIncome: 1 }).run();
  db.insert(categories).values({ id: 'c-pay', groupId: 'g-inc', name: 'Paychecks' }).run();
  db.insert(categoryGroups).values({ id: 'g-exp', name: 'Other', isIncome: 0 }).run();
  db.insert(categories).values({ id: 'c-misc', groupId: 'g-exp', name: 'Miscellaneous' }).run();
  // A rule that would otherwise make every inflow a paycheck
  await send('POST', '/rules', {
    conditions: [{ field: 'direction', op: 'is', value: 'inflow' }],
    actions: [{ type: 'set_category', value: 'c-pay' }],
  });

  const account = await send('POST', '/accounts', {
    name: 'Checking',
    type: 'checking',
    startingBalance: 50_000,
  });
  const adjustment = await send('POST', '/transactions', {
    accountId: account.id,
    date: `${month}-10`,
    amount: 25_000,
    notes: 'Reconciliation adjustment',
    adjustment: true,
  });
  expect(adjustment).toMatchObject({ isAdjustment: 1, categoryId: null });

  // Balance and net worth include it...
  const accounts = await send('GET', '/accounts');
  expect(accounts[0].balance).toBe(75_000);
  const worth = await send('GET', `/reports/net-worth?from=${month}&to=${month}`);
  expect(worth.at(-1).netWorth).toBe(75_000);

  // ...income and spending don't
  const [flow] = await send('GET', `/reports/income-vs-expenses?from=${month}&to=${month}`);
  expect(flow).toMatchObject({ income: 0, expenses: 0, expenseNet: 0 });
  expect(await send('GET', `/reports/spending-by-category?from=${month}&to=${month}`)).toEqual([]);
  const [cash] = await send('GET', `/reports/cash-flow?from=${month}&to=${month}`);
  expect(cash.net).toBe(0);

  // Given a category on purpose, it counts like any other transaction
  await send('PUT', `/transactions/${adjustment.id}`, { categoryId: 'c-misc' });
  const [after] = await send('GET', `/reports/income-vs-expenses?from=${month}&to=${month}`);
  expect(after.expenseNet).toBe(25_000);
});

it('an ordinary inflow is still categorized by rules and counted', async () => {
  const [account] = await send('GET', '/accounts');
  const paycheck = await send('POST', '/transactions', {
    accountId: account.id,
    date: `${month}-15`,
    amount: 300_000,
    payeeName: 'Employer',
  });
  expect(paycheck).toMatchObject({ isAdjustment: 0, categoryId: 'c-pay' });
  const [flow] = await send('GET', `/reports/income-vs-expenses?from=${month}&to=${month}`);
  expect(flow.income).toBe(300_000);
});
