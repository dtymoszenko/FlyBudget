import { afterAll, beforeAll, it, expect } from 'vitest';
import express from 'express';
import fc from 'fast-check';
import { inArray } from 'drizzle-orm';
import { reportsRouter } from './reports.js';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db/index.js';
import { accounts, categories, categoryGroups, transactions } from '../db/schema.js';
import { transactionsRouter } from './transactions.js';
let server: Server;
let url: string;
beforeAll(async () => {
  migrate(db, { migrationsFolder: './src/db/migrations' });
  db.insert(accounts).values({ id: 'bank', name: 'Bank', type: 'checking' }).run();
  db.insert(categoryGroups).values({ id: 'food', name: 'Food' }).run();
  db.insert(categories)
    .values([
      { id: 'groceries', name: 'Groceries', groupId: 'food' },
      { id: 'dining', name: 'Dining', groupId: 'food' },
    ])
    .run();
  db.insert(transactions)
    .values([
      { id: 'g', accountId: 'bank', date: '2026-10-03', amount: -100, categoryId: 'groceries' },
      { id: 'd', accountId: 'bank', date: '2026-10-03', amount: -200, categoryId: 'dining' },
      { id: 'refund', accountId: 'bank', date: '2026-10-03', amount: 100 },
      { id: 'u', accountId: 'bank', date: '2026-10-03', amount: -300 },
      { id: 'old', accountId: 'bank', date: '2026-09-03', amount: -400 },
      { id: 'adjust', accountId: 'bank', date: '2026-10-03', amount: -500, isAdjustment: 1 },
      {
        id: 'transfer',
        accountId: 'bank',
        date: '2026-10-03',
        amount: -600,
        transferTransactionId: 'other-side',
      },
      { id: 'parent', accountId: 'bank', date: '2026-10-03', amount: -700, isParent: 1 },
      {
        id: 'child',
        accountId: 'bank',
        date: '2026-10-03',
        amount: -700,
        categoryId: 'groceries',
        parentTransactionId: 'parent',
      },
      { id: 'upart', accountId: 'bank', date: '2026-10-03', amount: -800, isParent: 1 },
      {
        id: 'uchild',
        accountId: 'bank',
        date: '2026-10-03',
        amount: -800,
        parentTransactionId: 'upart',
      },
    ])
    .run();
  const app = express();
  app.use('/transactions', transactionsRouter);
  app.use('/reports', reportsRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/transactions`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
async function ids(query: string) {
  const response = await fetch(`${url}?from=2026-10-01&to=2026-10-31&${query}`);
  expect(response.status).toBe(200);
  const rows = (await response.json()) as { id: string }[];
  return rows.map((r) => r.id).sort();
}
it('filters category and group selections, including splits', async () => {
  expect(await ids('category_id=groceries')).toEqual(['g', 'parent']);
  expect(await ids('category_group_id=food')).toEqual(['d', 'g', 'parent']);
});
it('uncategorized selection excludes categorized entries, other dates, transfers, adjustments and categorized-only splits', async () => {
  expect(await ids('uncategorized=1')).toEqual(['refund', 'u', 'upart']);
});

it('keeps positive uncategorized rows because the chart nets them against spending', async () => {
  const response = await fetch(
    url.replace('/transactions', '/reports/spending-by-category') + '?from=2026-10&to=2026-10',
  );
  expect(response.status).toBe(200);
  const report = (await response.json()) as { categoryId: string | null; totalSpent: number }[];
  const drilldownResponse = await fetch(url + '?from=2026-10-01&to=2026-10-31&uncategorized=1');
  const rows = (await drilldownResponse.json()) as { amount: number }[];
  expect(report.find((r) => r.categoryId === null)?.totalSpent).toBe(1000);
  expect(-rows.reduce((sum, r) => sum + r.amount, 0)).toBe(1000);
});

it('selects exactly matching rows across generated dates, attributes and mixed splits', async () => {
  const generated = fc.array(
    fc.record({
      day: fc.integer({ min: -3, max: 34 }),
      amount: fc.integer({ min: -10000, max: 10000 }),
      category: fc.constantFrom(null, 'groceries', 'dining'),
      adjustment: fc.boolean(),
      transfer: fc.boolean(),
      split: fc.boolean(),
    }),
    { minLength: 1, maxLength: 20 },
  );
  await fc.assert(
    fc.asyncProperty(generated, async (entries) => {
      const inserted: string[] = [];
      const expectedUncategorized: string[] = [];
      const expectedCategory: string[] = [];
      const expectedGroup: string[] = [];
      try {
        for (const [i, entry] of entries.entries()) {
          const id = `property-${i}`;
          const date = new Date(Date.UTC(2026, 9, 1 + entry.day)).toISOString().slice(0, 10);
          const inRange = date >= '2026-10-01' && date <= '2026-10-31';
          inserted.push(id);
          db.insert(transactions)
            .values({
              id,
              accountId: 'bank',
              date,
              amount: entry.amount,
              categoryId: entry.split ? null : entry.category,
              isParent: entry.split ? 1 : 0,
              isAdjustment: !entry.split && entry.adjustment ? 1 : 0,
              transferTransactionId: !entry.split && entry.transfer ? 'counterpart' : null,
            })
            .run();
          if (entry.split) {
            inserted.push(`${id}-a`, `${id}-b`);
            db.insert(transactions)
              .values([
                {
                  id: `${id}-a`,
                  accountId: 'bank',
                  date,
                  amount: entry.amount - 17,
                  categoryId: 'groceries',
                  parentTransactionId: id,
                },
                {
                  id: `${id}-b`,
                  accountId: 'bank',
                  date,
                  amount: 17,
                  categoryId: entry.category,
                  parentTransactionId: id,
                },
              ])
              .run();
          }
          if (!inRange) continue;
          if (entry.split || entry.category === 'groceries') expectedCategory.push(id);
          if (entry.split || entry.category !== null) expectedGroup.push(id);
          if (entry.category === null && (entry.split || (!entry.adjustment && !entry.transfer)))
            expectedUncategorized.push(id);
        }
        const propertyIds = (ids: string[]) => ids.filter((id) => id.startsWith('property-'));
        expect(propertyIds(await ids('uncategorized=1'))).toEqual(expectedUncategorized.sort());
        expect(propertyIds(await ids('category_id=groceries'))).toEqual(expectedCategory.sort());
        expect(propertyIds(await ids('category_group_id=food'))).toEqual(expectedGroup.sort());
      } finally {
        db.delete(transactions).where(inArray(transactions.id, inserted)).run();
      }
    }),
    { numRuns: 50 },
  );
});
