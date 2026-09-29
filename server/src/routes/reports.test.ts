import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { accounts, categories, categoryGroups, transactions } from '../db/schema.js';
import { dayRange, reportsRouter } from './reports.js';

// yyyy-MM-dd from a UTC day number, independent of the machine's time zone
const ymd = (dayNum: number) => new Date(dayNum * 86_400_000).toISOString().slice(0, 10);
// 1990-01-01 .. 2089-12-31, as days since the epoch
const arbDay = fc.integer({ min: 7305, max: 43829 });

describe('dayRange (property-based)', () => {
  it('lists every day from `from` to `to` exactly once, in order, in any time zone', () => {
    fc.assert(
      fc.property(arbDay, fc.integer({ min: 0, max: 400 }), (start, length) => {
        const days = dayRange(ymd(start), ymd(start + length));
        expect(days).toEqual(Array.from({ length: length + 1 }, (_, i) => ymd(start + i)));
      }),
      { numRuns: 200 },
    );
  });

  it('is empty when `to` is before `from`', () => {
    fc.assert(
      fc.property(arbDay, fc.integer({ min: 1, max: 100 }), (start, back) => {
        expect(dayRange(ymd(start), ymd(start - back))).toEqual([]);
      }),
    );
  });
});

describe('report endpoints (property-based)', () => {
  let server: Server;
  let base: string;
  const accountIds = [nanoid(), nanoid()];
  const offBudgetId = nanoid();
  const expenseIds = [nanoid(), nanoid(), nanoid()];
  const incomeId = nanoid();

  beforeAll(async () => {
    migrate(db, { migrationsFolder: 'src/db/migrations' });
    const expenseGroup = nanoid();
    const incomeGroup = nanoid();
    db.insert(accounts)
      .values([
        ...accountIds.map((id, i) => ({ id, name: `Account ${i}`, type: 'checking' })),
        { id: offBudgetId, name: 'Brokerage', type: 'investment', isOffBudget: 1 },
      ])
      .run();
    db.insert(categoryGroups)
      .values([
        { id: expenseGroup, name: 'Spending', isIncome: 0 },
        { id: incomeGroup, name: 'Income', isIncome: 1 },
      ])
      .run();
    db.insert(categories)
      .values([
        ...expenseIds.map((id, i) => ({ id, groupId: expenseGroup, name: `Expense ${i}` })),
        { id: incomeId, groupId: incomeGroup, name: 'Paycheck' },
      ])
      .run();
    const app = express();
    app.use('/api/reports', reportsRouter);
    server = await new Promise<Server>((r) => {
      const s = app.listen(0, '127.0.0.1', () => r(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/reports`;
  });
  afterAll(() => server.close());

  const amount = fc.integer({ min: -50_000, max: 50_000 }).filter((a) => a !== 0);
  // null = uncategorized, which is real spending too
  const expenseCategory = fc.constantFrom<string | null>(...expenseIds, null);
  const entry = fc.oneof(
    fc.record({ kind: fc.constant('plain' as const), amount, categoryId: expenseCategory }),
    fc.record({ kind: fc.constant('income' as const), amount }),
    fc.record({ kind: fc.constant('transfer' as const), amount }),
    fc.record({
      kind: fc.constant('split' as const),
      parts: fc.array(fc.record({ amount, categoryId: expenseCategory }), {
        minLength: 2,
        maxLength: 4,
      }),
    }),
  );

  it('counts each split once, by its parts, and leaves out transfers and income (spending by category, income & expenses)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(entry, { maxLength: 12 }), async (entries) => {
        db.delete(transactions).run();
        const expected = new Map<string | null, number>();
        const spend = (categoryId: string | null, cents: number) =>
          expected.set(categoryId, (expected.get(categoryId) ?? 0) + cents);
        const row = (amount: number, extra: Partial<typeof transactions.$inferInsert> = {}) => ({
          id: nanoid(),
          accountId: accountIds[0],
          date: '2026-05-15',
          amount,
          ...extra,
        });

        for (const e of entries) {
          if (e.kind === 'plain') {
            db.insert(transactions)
              .values(row(e.amount, { categoryId: e.categoryId }))
              .run();
            spend(e.categoryId, e.amount);
          } else if (e.kind === 'income') {
            db.insert(transactions)
              .values(row(e.amount, { categoryId: incomeId }))
              .run();
          } else if (e.kind === 'transfer') {
            const [a, b] = [nanoid(), nanoid()];
            db.insert(transactions)
              .values([
                row(-e.amount, { id: a, transferTransactionId: b }),
                row(e.amount, { id: b, accountId: accountIds[1], transferTransactionId: a }),
              ])
              .run();
          } else {
            const parentId = nanoid();
            const total = e.parts.reduce((s, p) => s + p.amount, 0);
            db.insert(transactions)
              .values([
                row(total, { id: parentId, isParent: 1 }),
                ...e.parts.map((p) =>
                  row(p.amount, { categoryId: p.categoryId, parentTransactionId: parentId }),
                ),
              ])
              .run();
            for (const p of e.parts) spend(p.categoryId, p.amount);
          }
        }

        const res = await fetch(`${base}/spending-by-category?from=2026-05&to=2026-05`);
        const rows: { categoryId: string | null; totalSpent: number }[] = await res.json();
        const actual = new Map(rows.map((r) => [r.categoryId, r.totalSpent]));
        const want = new Map(
          [...expected].filter(([, net]) => net < 0).map(([id, net]) => [id, -net]),
        );
        expect(actual).toEqual(want);

        // Income & Expenses agrees: the same spending (uncategorized included), same income
        const income = entries.reduce((s, e) => s + (e.kind === 'income' ? e.amount : 0), 0);
        const net = [...expected.values()].reduce((s, v) => s + v, 0);
        const [month] = await (
          await fetch(`${base}/income-vs-expenses?from=2026-05&to=2026-05`)
        ).json();
        expect(month).toMatchObject({ income, expenseNet: net, expenses: Math.max(-net, 0) });
      }),
      { numRuns: 100 },
    );
  });

  it('/daily-flow totals money in and out per day on budget accounts, without transfers', async () => {
    const day = fc.integer({ min: 1, max: 31 }).map((d) => `2026-05-${String(d).padStart(2, '0')}`);
    const account = fc.constantFrom(accountIds[0], accountIds[1], offBudgetId);
    const flowEntry = fc.oneof(
      fc.record({ kind: fc.constant('plain' as const), amount, day, account }),
      fc.record({ kind: fc.constant('transfer' as const), amount, day }),
      fc.record({
        kind: fc.constant('split' as const),
        day,
        account,
        parts: fc.array(amount, { minLength: 2, maxLength: 4 }),
      }),
    );

    await fc.assert(
      fc.asyncProperty(fc.array(flowEntry, { maxLength: 15 }), async (entries) => {
        db.delete(transactions).run();
        const expected = new Map<string, { income: number; expenses: number; count: number }>();
        const add = (date: string, amounts: number[]) => {
          const d = expected.get(date) ?? { income: 0, expenses: 0, count: 0 };
          for (const a of amounts) {
            if (a > 0) d.income += a;
            else d.expenses -= a;
          }
          d.count += 1;
          expected.set(date, d);
        };

        for (const e of entries) {
          if (e.kind === 'plain') {
            db.insert(transactions)
              .values({ id: nanoid(), accountId: e.account, date: e.day, amount: e.amount })
              .run();
            if (e.account !== offBudgetId) add(e.day, [e.amount]);
          } else if (e.kind === 'transfer') {
            const [a, b] = [nanoid(), nanoid()];
            db.insert(transactions)
              .values([
                {
                  id: a,
                  accountId: accountIds[0],
                  date: e.day,
                  amount: -e.amount,
                  transferTransactionId: b,
                },
                {
                  id: b,
                  accountId: accountIds[1],
                  date: e.day,
                  amount: e.amount,
                  transferTransactionId: a,
                },
              ])
              .run();
          } else {
            const parentId = nanoid();
            const total = e.parts.reduce((s, p) => s + p, 0);
            db.insert(transactions)
              .values([
                { id: parentId, accountId: e.account, date: e.day, amount: total, isParent: 1 },
                ...e.parts.map((p) => ({
                  id: nanoid(),
                  accountId: e.account,
                  date: e.day,
                  amount: p,
                  parentTransactionId: parentId,
                })),
              ])
              .run();
            if (e.account !== offBudgetId) add(e.day, e.parts);
          }
        }

        const res = await fetch(`${base}/daily-flow?from=2026-05&to=2026-05`);
        const rows: { date: string; income: number; expenses: number; count: number }[] =
          await res.json();
        expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort());
        expect(new Map(rows.map(({ date, ...d }) => [date, d]))).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('/daily-flow rejects anything but a YYYY-MM range', async () => {
    for (const q of ['', 'from=2026-05', 'from=2026-13&to=2026-12', 'from=2026-06&to=2026-05']) {
      expect((await fetch(`${base}/daily-flow?${q}`)).status).toBe(400);
    }
  });
});
