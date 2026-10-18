import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db/index.js';
import { accounts, budgetSettings, goals, schedules } from '../db/schema.js';
import { currencyRouter } from './currency.js';

// Correcting the budget's currency only relabels: nothing is converted. Amounts are stored in
// minor units, so a currency with other decimals would change what every stored amount means
// (a $500.00 goal would be ¥50,000). Its own file: the database holds only this test's data.

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use(express.json());
  app.use('/api/currency', currencyRouter);
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server.close());

beforeEach(() => {
  db.delete(goals).run();
  db.delete(schedules).run();
  db.delete(accounts).run();
  db.delete(budgetSettings).run();
  db.insert(budgetSettings).values({ id: 'budget', currency: 'USD' }).run();
});

const relabel = async (currency: string) => {
  const res = await fetch(`${base}/currency`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currency }),
  });
  return { status: res.status, body: await res.json() };
};

const schedule = (id: string, accountId: string | null, amount = -1_500) => ({
  id,
  name: 'Rent',
  amount,
  recurrenceType: 'monthly',
  startDate: '2026-01-01',
  accountId,
});

describe('correcting the budget currency', () => {
  it('is fine with nothing that has an amount', async () => {
    db.insert(goals).values({ id: 'g', name: 'Someday', targetAmount: 0 }).run();
    expect((await relabel('JPY')).status).toBe(200);
  });

  it('keeps goals from changing meaning', async () => {
    db.insert(goals).values({ id: 'g', name: 'Trip', targetAmount: 50_000 }).run();
    const res = await relabel('JPY');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/different number of decimals/);
    // Same decimals: nothing changes meaning
    expect((await relabel('EUR')).status).toBe(200);
  });

  it('keeps recurring items in the budget currency from changing meaning', async () => {
    db.insert(schedules).values(schedule('no-account', null)).run();
    expect((await relabel('KWD')).status).toBe(409);
    db.delete(schedules).run();
    db.insert(accounts).values({ id: 'home', name: 'Checking', type: 'checking' }).run();
    db.insert(schedules).values(schedule('on-home', 'home')).run();
    expect((await relabel('JPY')).status).toBe(409);
  });

  it('ignores recurring items in an account with its own currency', async () => {
    db.insert(accounts)
      .values({ id: 'pln', name: 'Konto', type: 'checking', currency: 'PLN' })
      .run();
    db.insert(schedules).values(schedule('rent', 'pln')).run();
    // The account has no transactions or balance yet, so nothing ends up in another currency
    expect((await relabel('JPY')).status).toBe(200);
  });
});
