import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db/index.js';
import { accountsRouter } from './accounts.js';
import { budgetRouter } from './budget.js';
import { categoriesRouter } from './categories.js';
import { exportRouter } from './export.js';
import { transactionsRouter } from './transactions.js';

// Budget methods: zero-based (every category carries over, as before) and category budgeting
// (each month on its own unless the budget or a category carries over). Its own file, so the
// database holds only this test's data.

let server: Server;
let base: string;
let accountId: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use((req, res, next) =>
    req.path === '/api/export/restore' ? next() : express.json({ limit: '10mb' })(req, res, next),
  );
  app.use('/api/accounts', accountsRouter);
  app.use('/api/budget', budgetRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/export', exportRouter);
  app.use('/api/transactions', transactionsRouter);
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  accountId = (
    await send('POST', '/accounts', { name: 'Checking', type: 'checking', startingBalance: 0 })
  ).body.id;
});
afterAll(() => server.close());

const send = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

type BudgetCategory = { id: string; carryOver: number; carriesOver: boolean; balance: number };
const budgetCategory = async (month: string, id: string) =>
  ((await send('GET', `/budget/${month}`)).body as { categories: BudgetCategory[] }[])
    .flatMap((g) => g.categories)
    .find((c) => c.id === id)!;

async function newCategory(name: string, isIncome: 0 | 1, carryOver?: 0 | 1 | null) {
  const group = await send('POST', '/categories/groups', { name: `${name} group`, isIncome });
  const cat = await send('POST', '/categories', { name, groupId: group.body.id, carryOver });
  expect(cat.status).toBe(201);
  return cat.body.id as string;
}

describe('budget settings', () => {
  it('start as zero-based, as before there was a choice', async () => {
    expect((await send('GET', '/budget/settings')).body).toEqual({
      method: 'zero_based',
      carryOver: false,
    });
  });

  it('save what they are given and refuse anything else', async () => {
    for (const settings of [
      { method: 'category', carryOver: true },
      { method: 'category', carryOver: false },
      { method: 'zero_based', carryOver: false },
    ]) {
      expect((await send('PUT', '/budget/settings', settings)).body).toEqual(settings);
      expect((await send('GET', '/budget/settings')).body).toEqual(settings);
    }
    for (const bad of [
      {},
      { method: 'category' },
      { method: 'envelope', carryOver: true },
      { method: 'category', carryOver: 1 },
    ]) {
      expect((await send('PUT', '/budget/settings', bad)).status).toBe(400);
    }
    expect((await send('GET', '/budget/settings')).body.method).toBe('zero_based');
  });
});

describe('category carry-over setting', () => {
  it('is null until set, and takes 1, 0 or null only', async () => {
    const id = await newCategory('Clothes', 0);
    expect((await budgetCategory('2030-01', id)).carryOver).toBe(0);
    for (const carryOver of [1, 0, null]) {
      const res = await send('PUT', `/categories/${id}`, { carryOver });
      expect(res.status).toBe(200);
      expect(res.body.carryOver).toBe(carryOver);
    }
    for (const carryOver of [true, 2, -1, 'yes']) {
      expect((await send('PUT', `/categories/${id}`, { carryOver })).status).toBe(400);
    }
  });
});

describe('how months add up', () => {
  let year = 2000;
  const month = (y: number, i: number) => `${y}-${String(i + 1).padStart(2, '0')}`;

  it('carries over exactly when the method, the category or the budget says so', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            budgeted: fc.integer({ min: 0, max: 50_000 }),
            spent: fc.integer({ min: 0, max: 50_000 }),
            income: fc.integer({ min: 0, max: 100_000 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.boolean(),
        fc.constantFrom<0 | 1 | null>(0, 1, null),
        async (months, budgetCarries, override) => {
          // A year of its own, so the summary's month totals hold only this run's data
          const y = ++year;
          const spending = await newCategory(`Spending ${y}`, 0, override);
          const pay = await newCategory(`Pay ${y}`, 1);
          for (const [i, m] of months.entries()) {
            const date = `${month(y, i)}-15`;
            await send('PUT', `/budget/${month(y, i)}/${spending}`, { budgeted: m.budgeted });
            if (m.spent) {
              await send('POST', '/transactions', {
                accountId,
                date,
                amount: -m.spent,
                categoryId: spending,
              });
            }
            if (m.income) {
              await send('POST', '/transactions', {
                accountId,
                date,
                amount: m.income,
                categoryId: pay,
              });
            }
          }
          const last = months.length - 1;
          const now = months[last];
          const earlier = months.slice(0, last);
          const leftover = earlier.reduce((sum, m) => sum + m.budgeted - m.spent, 0);

          for (const method of ['zero_based', 'category'] as const) {
            await send('PUT', '/budget/settings', { method, carryOver: budgetCarries });
            const carries = method === 'zero_based' || (override ?? (budgetCarries ? 1 : 0)) === 1;

            const cat = await budgetCategory(month(y, last), spending);
            expect(cat.carriesOver).toBe(carries);
            // Overspending carries over too
            expect(cat.carryOver).toBe(carries ? leftover : 0);
            expect(cat.balance).toBe(cat.carryOver + now.budgeted - now.spent);

            const income = await budgetCategory(month(y, last), pay);
            expect(income.carriesOver).toBe(method === 'zero_based');
            if (method === 'category') expect(income.carryOver).toBe(0);

            const summary = (await send('GET', `/budget/${month(y, last)}/summary`)).body;
            expect(summary.method).toBe(method);
            if (method === 'category') {
              // No pool from earlier months
              expect(summary.carryOver).toBe(0);
              expect(summary.toBeBudgeted).toBe(now.income - now.budgeted);
            } else {
              expect(summary.toBeBudgeted).toBe(
                summary.income + summary.carryOver - summary.totalBudgeted,
              );
            }
          }
        },
      ),
      { numRuns: 30 },
    );
    await send('PUT', '/budget/settings', { method: 'zero_based', carryOver: false });
  });
});

describe('restoring a backup from before budget methods', () => {
  it('gives it the defaults', async () => {
    const id = await newCategory('Gifts', 0, 1);
    await send('PUT', '/budget/settings', { method: 'category', carryOver: true });
    const backup = (await send('GET', '/export/backup')).body;
    for (const row of backup.budgetSettings) {
      delete row.budgetMethod;
      delete row.carryOver;
    }
    for (const row of backup.categories) delete row.carryOver;

    expect((await send('POST', '/export/restore', backup)).status).toBe(200);
    expect((await send('GET', '/budget/settings')).body).toEqual({
      method: 'zero_based',
      carryOver: false,
    });
    const restored = ((await send('GET', '/categories')).body as { categories: unknown[] }[])
      .flatMap((g) => g.categories as { id: string; carryOver: number | null }[])
      .find((c) => c.id === id)!;
    expect(restored.carryOver).toBeNull();
  });
});
