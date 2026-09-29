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
