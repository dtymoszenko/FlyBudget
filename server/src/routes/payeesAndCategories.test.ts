import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db/index.js';
import { errorHandler } from '../middleware/security.js';
import { accountsRouter } from './accounts.js';
import { categoriesRouter } from './categories.js';
import { payeesRouter } from './payees.js';
import { transactionsRouter } from './transactions.js';

// Renaming a payee renames its transactions, category filters find split parts, and every
// budget type the app offers can be saved.

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', accountsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/payees', payeesRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use(errorHandler);
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
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

const newAccount = async () =>
  (await send('POST', '/accounts', { name: 'Checking', type: 'checking', startingBalance: 0 })).body
    .id as string;

async function newCategory(name: string) {
  const group = await send('POST', '/categories/groups', { name: `Group ${name}`, isIncome: 0 });
  const cat = await send('POST', '/categories', { name, groupId: group.body.id });
  return cat.body.id as string;
}

type Tx = { id: string; payeeName: string | null; children?: { categoryId: string | null }[] };
const list = async (query: string) => (await send('GET', `/transactions?${query}`)).body as Tx[];

describe('renaming a payee', () => {
  it('changes the name on every one of its transactions, and nothing else', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
        async (count, newName) => {
          const accountId = await newAccount();
          const unique = `Shop ${Math.random()}`;
          const other = `Other ${Math.random()}`;
          for (let i = 0; i < count; i++) {
            await send('POST', '/transactions', {
              accountId,
              date: '2025-04-01',
              amount: -100 * (i + 1),
              payeeName: unique,
            });
          }
          await send('POST', '/transactions', {
            accountId,
            date: '2025-04-02',
            amount: -500,
            payeeName: other,
          });
          const payee = (
            (await send('GET', '/payees')).body as { id: string; name: string }[]
          ).find((p) => p.name === unique)!;

          const res = await send('PUT', `/payees/${payee.id}`, { name: newName });
          expect(res.status).toBe(200);

          const names = (await list(`account_id=${accountId}`)).map((t) => t.payeeName);
          expect(names.filter((n) => n === newName.trim())).toHaveLength(count);
          expect(names).toContain(other);
          expect(names).not.toContain(unique);
        },
      ),
      { numRuns: 15 },
    );
  });

  it("doesn't touch transactions when only the logo or default category changes", async () => {
    const accountId = await newAccount();
    await send('POST', '/transactions', {
      accountId,
      date: '2025-04-01',
      amount: -100,
      payeeName: 'Keeps Its Name',
    });
    const payee = ((await send('GET', '/payees')).body as { id: string; name: string }[]).find(
      (p) => p.name === 'Keeps Its Name',
    )!;
    await send('PUT', `/payees/${payee.id}`, { defaultCategoryId: null });
    expect((await list(`account_id=${accountId}`))[0].payeeName).toBe('Keeps Its Name');
  });
});

describe('filtering by category', () => {
  it('finds split transactions with a part in the category', async () => {
    const accountId = await newAccount();
    const groceries = await newCategory('Groceries');
    const home = await newCategory('Home');
    const other = await newCategory('Other');

    const split = await send('POST', '/transactions', {
      accountId,
      date: '2025-05-10',
      amount: -3000,
      payeeName: 'Warehouse',
      splits: [
        { categoryId: groceries, amount: -2000 },
        { categoryId: home, amount: -1000 },
      ],
    });
    expect(split.status).toBe(201);
    await send('POST', '/transactions', {
      accountId,
      date: '2025-05-11',
      amount: -700,
      payeeName: 'Market',
      categoryId: groceries,
    });

    const inGroceries = await list(`category_id=${groceries}`);
    expect(inGroceries.map((t) => t.payeeName).sort()).toEqual(['Market', 'Warehouse']);
    // The split comes with its parts, as everywhere else
    expect(inGroceries.find((t) => t.payeeName === 'Warehouse')!.children).toHaveLength(2);

    expect((await list(`category_ids=${home},${other}`)).map((t) => t.payeeName)).toEqual([
      'Warehouse',
    ]);
    expect(await list(`category_id=${other}`)).toEqual([]);
    // Never the parts on their own
    expect((await list(`account_id=${accountId}`)).length).toBe(2);
  });
});

describe('budget types', () => {
  it('saves every budget type the category editor offers', async () => {
    const id = await newCategory('Retirement');
    for (const budgetType of ['fixed', 'flexible', 'non_monthly', 'savings', null]) {
      const res = await send('PUT', `/categories/${id}`, { budgetType });
      expect(res.status).toBe(200);
      expect(res.body.budgetType).toBe(budgetType);
    }
    expect((await send('PUT', `/categories/${id}`, { budgetType: 'other' })).status).toBe(400);
  });
});
