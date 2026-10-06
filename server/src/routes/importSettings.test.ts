import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db/index.js';
import { accounts } from '../db/schema.js';
import { accountsRouter } from './accounts.js';
import { CSV_ENCODINGS, type ImportSettings } from '../utils/importSettings.js';

// Each account remembers how its bank writes CSV files, so the next import needs no choices

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', accountsRouter);
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
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const newAccount = async () =>
  (await send('POST', '/accounts', { name: 'Girokonto', type: 'checking' })).body.id as string;

const settings = fc.record<ImportSettings>({
  delimiter: fc.constantFrom(',', ';', '\t'),
  encoding: fc.constantFrom(...CSV_ENCODINGS),
  skipRows: fc.integer({ min: 0, max: 1000 }),
  columns: fc.dictionary(
    fc.string({ maxLength: 200 }),
    fc.constantFrom('date', 'payee', 'amount', 'inflow', 'outflow', 'direction', 'notes', 'skip'),
    { maxKeys: 20 },
  ),
  dateFormat: fc.constantFrom('mdy', 'dmy', 'ymd', null),
  numberFormat: fc.constantFrom('dot', 'comma', null),
  outWord: fc.option(
    fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim() === s && s !== ''),
  ),
});

describe('account import settings', () => {
  it('starts with none', async () => {
    const id = await newAccount();
    expect(await send('GET', `/accounts/${id}/import-settings`)).toEqual({
      status: 200,
      body: { settings: null },
    });
  });

  it('gives back whatever was saved', async () => {
    const id = await newAccount();
    await fc.assert(
      fc.asyncProperty(settings, async (s) => {
        expect((await send('PUT', `/accounts/${id}/import-settings`, s)).status).toBe(200);
        expect((await send('GET', `/accounts/${id}/import-settings`)).body.settings).toEqual(s);
      }),
      { numRuns: 30 },
    );
  });

  it('refuses settings it does not understand, and keeps the old ones', async () => {
    const id = await newAccount();
    const good: ImportSettings = {
      delimiter: ';',
      encoding: 'windows-1252',
      skipRows: 4,
      columns: { Buchungstag: 'date', Betrag: 'amount' },
      dateFormat: 'dmy',
      numberFormat: 'comma',
      outWord: null,
    };
    await send('PUT', `/accounts/${id}/import-settings`, good);
    for (const bad of [
      { ...good, delimiter: '|' },
      { ...good, encoding: 'ebcdic' },
      { ...good, skipRows: -1 },
      { ...good, columns: { Betrag: 'balance' } },
      { ...good, outWord: 'x'.repeat(51) },
    ]) {
      expect((await send('PUT', `/accounts/${id}/import-settings`, bad)).status).toBe(400);
    }
    expect((await send('GET', `/accounts/${id}/import-settings`)).body.settings).toEqual(good);
  });

  it('ignores stored settings in an old or broken shape (from a restored backup)', async () => {
    const id = await newAccount();
    db.update(accounts)
      .set({ importSettings: '{"delimiter":"|"' })
      .where(eq(accounts.id, id))
      .run();
    expect((await send('GET', `/accounts/${id}/import-settings`)).body.settings).toBeNull();
  });

  it('answers 404 for an account that does not exist', async () => {
    expect((await send('GET', '/accounts/nope/import-settings')).status).toBe(404);
    const put = await send('PUT', '/accounts/nope/import-settings', {
      delimiter: ',',
      encoding: 'auto',
      skipRows: 0,
      columns: {},
      dateFormat: null,
      numberFormat: null,
      outWord: null,
    });
    expect(put.status).toBe(404);
  });
});
