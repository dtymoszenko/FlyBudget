import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db/index.js';
import { errorHandler } from '../middleware/security.js';
import { BACKUP_TABLES } from '../services/backupService.js';
import { accountsRouter } from './accounts.js';
import { dashboardsRouter } from './dashboards.js';
import { exportRouter } from './export.js';
import { goalsRouter } from './goals.js';
import { schedulesRouter } from './schedules.js';
import { transactionsRouter } from './transactions.js';

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use((req, res, next) =>
    req.path === '/api/export/restore' ? next() : express.json()(req, res, next),
  );
  app.use('/api/accounts', accountsRouter);
  app.use('/api/dashboards', dashboardsRouter);
  app.use('/api/export', exportRouter);
  app.use('/api/goals', goalsRouter);
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

const backup = async () => {
  const { body } = await send('GET', '/export/backup');
  delete body.exportedAt;
  return body;
};

describe('backup and restore', () => {
  it('backs up every table', async () => {
    const data = await backup();
    expect(data).toMatchObject({ format: 'flybudget-backup', version: 2 });
    for (const table of BACKUP_TABLES) expect(Array.isArray(data[table])).toBe(true);
  });

  it('restores exactly what was backed up (property-based)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            amount: fc.integer({ min: -100_000, max: 100_000 }).filter((a) => a !== 0),
            day: fc.integer({ min: 1, max: 28 }),
            split: fc.boolean(),
          }),
          { maxLength: 8 },
        ),
        async (entries) => {
          const { body: account } = await send('POST', '/accounts', {
            name: 'Checking',
            type: 'checking',
            startingBalance: 1000,
          });
          for (const e of entries) {
            const date = `2025-04-${String(e.day).padStart(2, '0')}`;
            await send('POST', '/transactions', {
              accountId: account.id,
              date,
              amount: e.amount,
              payeeName: 'Shop',
              ...(e.split ? { splits: [{ categoryId: null, amount: e.amount }] } : {}),
            });
          }
          await send('POST', '/schedules', {
            name: 'Rent',
            amount: -100_000,
            recurrenceType: 'monthly',
            startDate: '2025-01-01',
            accountId: account.id,
          });
          await send('POST', '/goals', {
            name: 'Trip',
            targetAmount: 50_000,
            accountId: account.id,
          });
          await send('GET', '/dashboards');

          const before = await backup();
          // Change things, then restore
          await send('POST', '/accounts', { name: 'Extra', type: 'savings' });
          await send('DELETE', `/transactions/${before.transactions[0]?.id ?? 'none'}`);
          const restore = await send('POST', '/export/restore', before);
          expect(restore.status).toBe(200);
          expect(await backup()).toEqual(before);
        },
      ),
      { numRuns: 10 },
    );
  });

  it.each([
    ['not a backup', { hello: 'world' }],
    ['a newer version', { format: 'flybudget-backup', version: 99 }],
    ['a table that is not a list', { format: 'flybudget-backup', version: 2, accounts: {} }],
    [
      'a wrongly typed column',
      {
        format: 'flybudget-backup',
        version: 2,
        accounts: [{ id: 'a', name: 'A', type: 'checking', startingBalance: 'lots' }],
      },
    ],
    [
      'a row pointing at a missing account',
      {
        format: 'flybudget-backup',
        version: 2,
        transactions: [{ id: 't', accountId: 'missing', date: '2025-01-01', amount: 5 }],
      },
    ],
  ])('rejects %s and changes nothing', async (_label, file) => {
    const before = await backup();
    const res = await send('POST', '/export/restore', file);
    expect(res.status).toBe(400);
    expect(await backup()).toEqual(before);
  });

  it('accepts backups made before the format was versioned', async () => {
    const res = await send('POST', '/export/restore', {
      exportedAt: '2025-01-01T00:00:00.000Z',
      accounts: [{ id: 'old', name: 'Old', type: 'checking', startingBalance: 5 }],
      categoryGroups: [],
      categories: [],
      payees: [],
      transactions: [],
      budgetMonths: [],
      rules: [],
    });
    expect(res.status).toBe(200);
    const { body } = await send('GET', '/accounts');
    expect(body.map((a: { id: string }) => a.id)).toEqual(['old']);
  });
});
