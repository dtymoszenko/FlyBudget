import { afterAll, beforeAll, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db/index.js';
import { accountsRouter } from './accounts.js';
import { reportsRouter } from './reports.js';
import { transactionsRouter } from './transactions.js';

// Its own file, so the database holds only this test's transactions

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', accountsRouter);
  app.use('/api/reports', reportsRouter);
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

it('reports starting balances even when every transaction is dated after the range', async () => {
  const account = await send('POST', '/accounts', {
    name: 'Checking',
    type: 'checking',
    startingBalance: 70_000,
  });
  await send('POST', '/transactions', { accountId: account.id, date: '2099-01-01', amount: -5 });
  const points = await send(
    'GET',
    '/reports/net-worth?granularity=daily&from=2098-12-01&to=2098-12-31',
  );
  expect(points.at(-1)).toMatchObject({ month: '2098-12-31', netWorth: 70_000 });
});

it('draws a daily range in full: flat at the starting balances until the first transaction', async () => {
  // Alongside the 70_000 Checking above (whose only transaction is after this range)
  const savings = await send('POST', '/accounts', {
    name: 'Savings',
    type: 'savings',
    startingBalance: 30_000,
  });
  await send('POST', '/transactions', {
    accountId: savings.id,
    date: '2097-03-15',
    amount: 10_000,
  });
  const points = await send(
    'GET',
    '/reports/net-worth?granularity=daily&from=2097-03-01&to=2097-03-31',
  );
  expect(points).toHaveLength(31);
  expect(points[0]).toMatchObject({ month: '2097-03-01', netWorth: 100_000 });
  expect(points[13]).toMatchObject({ month: '2097-03-14', netWorth: 100_000 });
  expect(points[14]).toMatchObject({ month: '2097-03-15', netWorth: 110_000 });
  expect(points.at(-1)).toMatchObject({ month: '2097-03-31', netWorth: 110_000 });
});

it('"All time" keeps only the 12 months up to the first transaction', async () => {
  // The first transaction is now 2097-03-15 (above)
  const points = await send('GET', '/reports/net-worth?from=2000-01&to=2097-06');
  expect(points[0].month).toBe('2096-04');
  expect(points.at(-1).month).toBe('2097-06');
  expect(points).toHaveLength(15);
});
