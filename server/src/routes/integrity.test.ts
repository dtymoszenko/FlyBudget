import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db/index.js';
import { errorHandler } from '../middleware/security.js';
import { accountsRouter } from './accounts.js';
import { reportsRouter } from './reports.js';
import { rulesRouter } from './rules.js';
import { schedulesRouter } from './schedules.js';
import { transactionsRouter } from './transactions.js';

// Data integrity: splits, transfers and partial updates must never change money that
// the user didn't touch.

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', accountsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/rules', rulesRouter);
  app.use('/api/schedules', schedulesRouter);
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

const newAccount = async (startingBalance = 0) =>
  (await send('POST', '/accounts', { name: 'Checking', type: 'checking', startingBalance })).body
    .id as string;

const balanceOf = async (accountId: string) =>
  ((await send('GET', '/accounts')).body as { id: string; balance: number }[]).find(
    (a) => a.id === accountId,
  )!.balance;

// A total and its split into 1-5 parts that add up to it
const arbSplit = fc
  .array(fc.integer({ min: -100_000, max: 100_000 }), { minLength: 1, maxLength: 5 })
  .map((parts) => ({ total: parts.reduce((s, p) => s + p, 0), parts }));

describe('split transactions (property-based)', () => {
  it('count once in the account balance and in net worth', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.array(arbSplit, { minLength: 1, maxLength: 4 }),
        async (start, splits) => {
          const accountId = await newAccount(start);
          for (const { total, parts } of splits) {
            const res = await send('POST', '/transactions', {
              accountId,
              date: '2025-03-10',
              amount: total,
              payeeName: 'Store',
              splits: parts.map((amount) => ({ categoryId: null, amount })),
            });
            expect(res.status).toBe(201);
          }
          const expected = start + splits.reduce((s, x) => s + x.total, 0);
          expect(await balanceOf(accountId)).toBe(expected);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('move their parts along when the date changes', async () => {
    const accountId = await newAccount();
    const { body: parent } = await send('POST', '/transactions', {
      accountId,
      date: '2025-08-31',
      amount: -1000,
      splits: [
        { categoryId: null, amount: -600 },
        { categoryId: null, amount: -400 },
      ],
    });
    await send('PUT', `/transactions/${parent.id}`, { date: '2025-09-01' });
    const { body: rows } = await send('GET', `/transactions?account_id=${accountId}`);
    expect(rows[0].date).toBe('2025-09-01');
    expect(rows[0].children.map((c: { date: string }) => c.date)).toEqual([
      '2025-09-01',
      '2025-09-01',
    ]);
  });

  it("can't change the parent's amount out from under its parts", async () => {
    const accountId = await newAccount();
    const { body: parent } = await send('POST', '/transactions', {
      accountId,
      date: '2025-08-31',
      amount: -1000,
      splits: [{ categoryId: null, amount: -1000 }],
    });
    expect((await send('PUT', `/transactions/${parent.id}`, { amount: -5 })).status).toBe(400);
    expect(await balanceOf(accountId)).toBe(-1000);
  });
});

describe('transfers', () => {
  it('keep both sides in step when edited', async () => {
    const from = await newAccount();
    const to = await newAccount();
    const { body } = await send('POST', '/transactions/transfer', {
      fromAccountId: from,
      toAccountId: to,
      date: '2025-01-05',
      amount: 2500,
    });
    await send('PUT', `/transactions/${body[0].id}`, { amount: -4000, date: '2025-01-06' });
    expect(await balanceOf(from)).toBe(-4000);
    expect(await balanceOf(to)).toBe(4000);
    const { body: other } = await send('GET', `/transactions?account_id=${to}`);
    expect(other[0].date).toBe('2025-01-06');
  });

  it('need two different accounts', async () => {
    const a = await newAccount();
    const res = await send('POST', '/transactions/transfer', {
      fromAccountId: a,
      toAccountId: a,
      date: '2025-01-05',
      amount: 100,
    });
    expect(res.status).toBe(400);
  });
});

describe('partial updates only change the fields sent', () => {
  it('renaming an account keeps its starting balance', async () => {
    const accountId = await newAccount(12_345);
    await send('PUT', `/accounts/${accountId}`, { name: 'Renamed' });
    expect(await balanceOf(accountId)).toBe(12_345);
  });

  it('toggling a rule keeps its any/all setting and position', async () => {
    const { body: rule } = await send('POST', '/rules', {
      conditionsOp: 'or',
      conditions: [{ field: 'payee_name', op: 'contains', value: 'coffee' }],
      actions: [{ type: 'set_notes', value: 'Coffee' }],
      sortOrder: 7,
    });
    const { body: updated } = await send('PUT', `/rules/${rule.id}`, { enabled: false });
    expect(updated).toMatchObject({ conditionsOp: 'or', sortOrder: 7, enabled: false });
  });

  it('pausing a schedule keeps its settings', async () => {
    const { body: schedule } = await send('POST', '/schedules', {
      name: 'Rent',
      amount: -150_000,
      amountType: 'approximate',
      recurrenceType: 'monthly',
      startDate: '2025-01-01',
      weekendAdjust: 'before',
      dateFlexibility: 5,
      autoCreate: 1,
    });
    const { body: paused } = await send('PUT', `/schedules/${schedule.id}`, { status: 'paused' });
    expect(paused).toMatchObject({
      status: 'paused',
      amountType: 'approximate',
      weekendAdjust: 'before',
      dateFlexibility: 5,
      autoCreate: 1,
    });
  });
});

describe('schedules reject rules that could never finish generating dates', () => {
  const base = { name: 'Gym', amount: -3000, recurrenceType: 'weekly', startDate: '2025-01-01' };

  it.each([
    [{ recurrenceRule: { type: 'weekly', interval: 0, anchorDay: 3 } }],
    [{ recurrenceRule: { type: 'weekly', anchorDay: 3 } }],
    [{ recurrenceRule: { type: 'monthly', interval: 1, anchorDay: 3 } }],
    [{ startDate: '2025-13-45' }],
    [{ endDate: '2025-02-30' }],
  ])('%j', async (override) => {
    expect((await send('POST', '/schedules', { ...base, ...override })).status).toBe(400);
  });
});

describe('custom reports', () => {
  it('list month totals in date order, whatever the amounts', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Spending in 1-12 months of 2031, in any order and any size
        fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 12 }),
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 12, maxLength: 12 }),
        async (months, amounts) => {
          const accountId = await newAccount();
          for (const [i, m] of months.entries()) {
            const date = `2031-${String(m).padStart(2, '0')}-15`;
            await send('POST', '/transactions', { accountId, date, amount: -amounts[i] });
          }
          const { body } = await send(
            'GET',
            `/reports/custom?mode=total&group_by=month&balance_type=expense&from=2031-01&to=2031-12&account_ids=${accountId}`,
          );
          const names = (body.data as { name: string }[]).map((d) => d.name);
          expect(names).toEqual(
            [...months].sort((a, b) => a - b).map((m) => `2031-${String(m).padStart(2, '0')}`),
          );
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe('report ranges are validated', () => {
  it.each([
    '/reports/net-worth?from=2024-01&to=999999-12',
    '/reports/net-worth?from=0001-01&to=9999-12',
    '/reports/net-worth?granularity=daily&from=2000-01-01&to=2099-12-31',
    '/reports/income-vs-expenses?from=nope&to=2024-12',
    '/reports/cash-flow',
    '/reports/custom?from=2024-05&to=2024-01',
  ])('%s', async (path) => {
    expect((await send('GET', path)).status).toBe(400);
  });

  it('transaction paging rejects a negative limit (which SQLite treats as no limit)', async () => {
    expect((await send('GET', '/transactions?limit=-1')).status).toBe(400);
  });
});
