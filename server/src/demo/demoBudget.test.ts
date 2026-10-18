import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { format, subMonths } from 'date-fns';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db/index.js';
import { logoSchema } from '../utils/logo.js';
import { budgetRouter } from '../routes/budget.js';
import { schedulesRouter } from '../routes/schedules.js';
import { buildDemoBudget } from './demoBudget.js';
import { loadDemoBudget } from './loadDemoBudget.js';
import { listTransferSuggestions } from '../services/transferService.js';

// The website demo's budget (see ../browser/README.md) has to look finished whatever day
// someone opens it: these check it for any "today".

const anyDay = fc.date({
  min: new Date('2024-01-01'),
  max: new Date('2035-12-31'),
  noInvalidDate: true,
});
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

describe('the demo budget (property-based)', () => {
  it('is the same every time for the same day', () => {
    fc.assert(
      fc.property(anyDay, (today) => {
        expect(buildDemoBudget(today)).toEqual(buildDemoBudget(today));
      }),
      { numRuns: 20 },
    );
  });

  it('only has transactions from its history, up to today', () => {
    fc.assert(
      fc.property(anyDay, (today) => {
        const { transactions } = buildDemoBudget(today);
        const first = format(subMonths(today, 17), 'yyyy-MM');
        // The trip's flights were booked two months before the trip, still in the history
        for (const t of transactions) {
          expect(t.date <= ymd(today)).toBe(true);
          expect(t.date.slice(0, 7) >= first).toBe(true);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('keeps transfers paired and splits adding up, with nothing pointing nowhere', () => {
    fc.assert(
      fc.property(anyDay, (today) => {
        const demo = buildDemoBudget(today);
        const byId = new Map(demo.transactions.map((t) => [t.id, t]));
        expect(byId.size).toBe(demo.transactions.length);
        const accountIds = new Set(demo.accounts.map((a) => a.id));
        const payeeIds = new Set(demo.payees.map((p) => p.id));
        const categoryIds = new Set(demo.categories.map((c) => c.id));

        for (const t of demo.transactions) {
          expect(accountIds.has(t.accountId)).toBe(true);
          if (t.payeeId) expect(payeeIds.has(t.payeeId)).toBe(true);
          if (t.categoryId) expect(categoryIds.has(t.categoryId)).toBe(true);
          if (t.transferTransactionId) {
            const other = byId.get(t.transferTransactionId)!;
            expect(other.transferTransactionId).toBe(t.id);
            // In dollars, the two sides cancel out (between currencies the amounts differ)
            expect((other.mainAmount ?? other.amount) + (t.mainAmount ?? t.amount)).toBe(0);
            expect(other.date).toBe(t.date);
          }
          if (t.isParent) {
            const parts = demo.transactions.filter((c) => c.parentTransactionId === t.id);
            expect(parts.length).toBeGreaterThan(1);
            expect(parts.reduce((s, c) => s + c.amount, 0)).toBe(t.amount);
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  it('values every euro transaction in dollars, at a rate it has', () => {
    fc.assert(
      fc.property(anyDay, (today) => {
        const demo = buildDemoBudget(today);
        const euro = demo.accounts.find((a) => a.currency === 'EUR')!;
        const rows = demo.transactions.filter((t) => t.accountId === euro.id);
        expect(rows.length).toBeGreaterThan(0);
        for (const t of rows) {
          expect(t.mainAmount).toEqual(expect.any(Number));
          expect(['rate', 'transfer']).toContain(t.mainAmountSource);
          expect(Math.sign(t.mainAmount!)).toBe(Math.sign(t.amount));
        }
        // Euros for every working day back to the first transaction
        const first = demo.transactions.map((t) => t.date).sort()[0];
        expect(demo.exchangeRates[0].date <= first).toBe(true);
        expect(demo.exchangeRates.every((r) => r.base === 'EUR' && r.quote === 'USD')).toBe(true);
      }),
      { numRuns: 30 },
    );
  });

  it('gives every account and payee a logo the app accepts', () => {
    const demo = buildDemoBudget(new Date());
    for (const row of [...demo.accounts, ...demo.payees]) {
      expect(row.logo, row.name).toBeTruthy();
      expect(logoSchema.safeParse(row.logo).success, row.name).toBe(true);
    }
  });
});

describe('the demo budget, loaded', () => {
  let server: Server;
  let base: string;
  // Loaded once, into this file's own in-memory database. As of the real today: match
  // suggestions and "Find recurring" look around the current date
  const today = new Date();

  beforeAll(async () => {
    migrate(db, { migrationsFolder: 'src/db/migrations' });
    loadDemoBudget(today);
    const app = express();
    app.use(express.json());
    app.use('/api/budget', budgetRouter);
    app.use('/api/schedules', schedulesRouter);
    server = await new Promise<Server>((r) => {
      const s = app.listen(0, '127.0.0.1', () => r(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => server.close());

  const get = async (path: string) => (await fetch(base + path)).json();

  it('never has a month with more budgeted than it had', async () => {
    for (let i = 0; i < 18; i++) {
      const month = format(subMonths(today, i), 'yyyy-MM');
      const summary = await get(`/budget/${month}/summary`);
      expect(summary.toBeBudgeted, month).toBeGreaterThanOrEqual(0);
    }
  });

  it('pays its bills: every past occurrence is paid or skipped, except the one to review', async () => {
    const suggestions = await get('/schedules/match-suggestions');
    expect(suggestions.map((s: { scheduleId: string }) => s.scheduleId)).toEqual([
      'demo-schedule-donation',
    ]);
  });

  it('leaves the latest card payment for the transfer suggestions', () => {
    expect(listTransferSuggestions().map((s) => [s.outflow.payeeName, s.inflow.payeeName])).toEqual(
      [['ONLINE PAYMENT - CREDIT CARD', 'PAYMENT RECEIVED - THANK YOU']],
    );
  });

  it('leaves one subscription for "Find recurring" to spot', async () => {
    const found = await get('/schedules/discover');
    expect(found.map((f: { payeeId: string }) => f.payeeId)).toContain('demo-payee-tuneful');
  });
});
