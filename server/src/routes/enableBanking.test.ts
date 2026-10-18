import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { generateKeyPairSync, verify } from 'crypto';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  accounts,
  enableBankingConfig,
  enableBankingConnections,
  transactions,
} from '../db/schema.js';
import { accountsRouter } from './accounts.js';
import { enableBankingCallback, enableBankingRouter, RELAY_REDIRECT_URL } from './enableBanking.js';
import { apiTokenGuard, BANK_CALLBACK_PATH, originGuard } from '../middleware/security.js';
import { restoreBackup, BACKUP_TABLES } from '../services/backupService.js';
import { psuContext } from '../services/enableBankingService.js';
import { syncAllEnableBankingConnections } from '../services/enableBankingSyncService.js';

// The whole Enable Banking flow against a mock of its API: set up the application, log in
// at a bank (the bank's redirect arrives without a session or API token), map accounts,
// sync, sync again, the session ending, reconnecting and disconnecting. Its own file, so
// the database holds only this test's data.

const TOKEN = 'test-api-token';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const APP_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const IBAN_CHECKING = 'FI2112345600000785';
const IBAN_SAVINGS = 'FI5542345670000081';

// --- Mock Enable Banking ---

interface MockState {
  states: string[];
  usedCodes: Set<string>;
  sessionCount: number;
  queries: Record<string, Record<string, string>[]>;
  deleted: string[];
  expired: boolean;
  down: boolean;
  transactions: Record<string, unknown[]>;
  /** The bank changes how it identifies the checking account (after a new consent) */
  checkingHash: string;
  checkingIban: string | null;
  /** The savings account resends its page under a new key each time */
  rotateKeys: boolean;
  /** Answer as Enable Banking does to a key it doesn't know */
  rejectKey: boolean;
  /** Enable Banking asks to wait before ending a session */
  limitDelete: boolean;
  /** Every Authorization header received, checked at the end */
  authorizations: (string | undefined)[];
}
const mock: MockState = {
  states: [],
  usedCodes: new Set(),
  sessionCount: 0,
  queries: {},
  deleted: [],
  expired: false,
  down: false,
  transactions: {},
  checkingHash: 'hash-checking',
  checkingIban: IBAN_CHECKING,
  rotateKeys: false,
  rejectKey: false,
  limitDelete: false,
  authorizations: [],
};

/** A request's JWT, decoded, and whether its signature is the application key's */
function decodeJwt(header: string | undefined) {
  const [h = '', p = '', sig = ''] = (header ?? '').replace('Bearer ', '').split('.');
  return {
    head: JSON.parse(Buffer.from(h, 'base64url').toString() || 'null'),
    body: JSON.parse(Buffer.from(p, 'base64url').toString() || 'null'),
    signedByApp: verify(
      'RSA-SHA256',
      Buffer.from(`${h}.${p}`),
      publicKey,
      Buffer.from(sig, 'base64url'),
    ),
  };
}

/** Both accounts, with uids that change on every session (as Enable Banking's do) */
const sessionAccounts = (n: number) => [
  {
    uid: `uid-checking-${n}`,
    account_id: { iban: mock.checkingIban },
    identification_hash: mock.checkingHash,
    name: 'Everyday',
    currency: 'EUR',
    cash_account_type: 'CACC',
  },
  {
    uid: `uid-savings-${n}`,
    account_id: { iban: IBAN_SAVINGS },
    identification_hash: 'hash-savings',
    name: 'Savings',
    currency: 'EUR',
    cash_account_type: 'SVGS',
  },
];

const ebApp = express();
ebApp.use(express.json());
ebApp.use((req, res, next) => {
  if (mock.down) return void res.socket?.destroy();
  mock.authorizations.push(req.headers.authorization);
  if (mock.rejectKey) return void res.status(401).json({ error: 'UNAUTHORIZED_ACCESS' });
  next();
});
ebApp.get('/application', (_req, res) =>
  res.json({
    name: 'My FlyBudget',
    environment: 'PRODUCTION',
    redirect_urls: [RELAY_REDIRECT_URL],
  }),
);
ebApp.get('/aspsps', (req, res) =>
  res.json({
    aspsps:
      req.query.country === 'FI'
        ? [
            {
              name: 'Nordea',
              country: 'FI',
              maximum_consent_validity: 180 * 86_400,
              psu_types: ['personal'],
            },
            { name: 'Business Bank', country: 'FI', psu_types: ['business'] },
          ]
        : [],
  }),
);
ebApp.post('/auth', (req, res) => {
  expect(req.body.psu_type).toBe('personal');
  expect(req.body.redirect_url).toBe(RELAY_REDIRECT_URL);
  mock.states.push(req.body.state);
  res.json({ url: `https://bank.example/login?state=${req.body.state}`, authorization_id: 'a1' });
});
ebApp.post('/sessions', (req, res) => {
  if (mock.usedCodes.has(req.body.code))
    return void res.status(422).json({ error: 'EXPIRED_AUTHORIZATION_CODE' });
  mock.usedCodes.add(req.body.code);
  const n = ++mock.sessionCount;
  res.json({
    session_id: `session-${n}`,
    accounts: sessionAccounts(n),
    aspsp: { name: 'Nordea', country: 'FI' },
    access: { valid_until: new Date(Date.now() + 179 * 86_400_000).toISOString() },
  });
});
ebApp.delete('/sessions/:id', (req, res) => {
  if (mock.limitDelete) return void res.status(429).json({ error: 'ASPSP_RATE_LIMIT_EXCEEDED' });
  mock.deleted.push(req.params.id);
  res.json({ message: 'OK' });
});
ebApp.get('/accounts/:uid/transactions', (req, res) => {
  if (mock.expired) return void res.status(401).json({ error: 'EXPIRED_SESSION' });
  const kind = req.params.uid.includes('checking') ? 'checking' : 'savings';
  (mock.queries[kind] ??= []).push(req.query as Record<string, string>);
  expect(req.query.transaction_status).toBe('BOOK');
  if (kind === 'savings') {
    // A bank that sends the same page forever, under the same key or a new one each time
    return void res.json({
      transactions: mock.transactions.savings ?? [],
      continuation_key: mock.rotateKeys ? `key-${mock.queries.savings.length}` : 'again',
    });
  }
  res.json({ transactions: mock.transactions.checking ?? [] });
});
ebApp.get('/accounts/:uid/balances', (req, res) => {
  if (req.params.uid.includes('savings'))
    return void res.status(500).json({ error: 'ASPSP_ERROR' });
  res.json({
    balances: [
      { balance_type: 'CLAV', balance_amount: { amount: '99999.00', currency: 'EUR' } },
      { balance_type: 'ITBD', balance_amount: { amount: '1000.00', currency: 'EUR' } },
    ],
  });
});

// --- FlyBudget ---

let ebServer: Server;
let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  ebServer = await new Promise<Server>((r) => {
    const s = ebApp.listen(0, '127.0.0.1', () => r(s));
  });
  process.env.FLYBUDGET_ENABLE_BANKING_API = `http://127.0.0.1:${(ebServer.address() as AddressInfo).port}`;

  const app = express();
  // Generous, like the real server's limits on these routes
  app.use(rateLimit({ windowMs: 60_000, limit: 1_000 }));
  app.use(originGuard);
  app.use(apiTokenGuard(TOKEN));
  app.use(express.json());
  app.get(BANK_CALLBACK_PATH, enableBankingCallback);
  app.use('/api/accounts', accountsRouter);
  app.use('/api/enable-banking', enableBankingRouter);
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  ebServer.close();
  delete process.env.FLYBUDGET_ENABLE_BANKING_API;
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: `flybudget_token=${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

/** The bank sending the user's browser back: cross-site, without the API token cookie */
const bankRedirect = (query: string) =>
  fetch(`${base}${BANK_CALLBACK_PATH}?${query}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });

const rowsIn = (accountId: string) =>
  db.select().from(transactions).where(eq(transactions.accountId, accountId)).all();

const bankTx = (ref: string, date: string, amount: string, dir: 'DBIT' | 'CRDT', name: string) => ({
  entry_reference: ref,
  booking_date: date,
  transaction_amount: { amount, currency: 'EUR' },
  credit_debit_indicator: dir,
  status: 'BOOK',
  [dir === 'DBIT' ? 'creditor' : 'debtor']: { name },
});

let checkingId: string;
let connectionId: string;
let mappings: {
  mappingId: string;
  iban: string;
  suggestedAccountId: string | null;
  accountId: string | null;
}[];

describe('Enable Banking', () => {
  it('refuses a key that is not a private key, and checks the application before saving it', async () => {
    expect(
      (
        await call('POST', '/enable-banking/configure', {
          applicationId: APP_ID,
          privateKey: 'nope',
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('POST', '/enable-banking/configure', { applicationId: 'abc', privateKey: PEM }))
        .status,
    ).toBe(400);
    const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    });
    mock.rejectKey = true;
    const refused = await call('POST', '/enable-banking/configure', {
      applicationId: APP_ID,
      privateKey: wrongKey,
    });
    mock.rejectKey = false;
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatch(/didn't accept/);
    expect(db.select().from(enableBankingConfig).all()).toHaveLength(0);

    const ok = await call('POST', '/enable-banking/configure', {
      applicationId: APP_ID,
      privateKey: PEM,
    });
    expect(ok.body).toEqual({
      applicationName: 'My FlyBudget',
      environment: 'PRODUCTION',
      redirectUrlRegistered: true,
    });
    // The key is encrypted at rest and never sent back
    const raw = db.$client.prepare('select private_key from enable_banking_config').get() as {
      private_key: string;
    };
    expect(raw.private_key.startsWith('enc:v1:')).toBe(true);
    const status = await call('GET', '/enable-banking/status');
    expect(JSON.stringify(status.body)).not.toContain('PRIVATE KEY');
    expect(status.body).toMatchObject({ configured: true, redirectUrl: RELAY_REDIRECT_URL });
  });

  it('lists personal banks by country', async () => {
    const { body } = await call('GET', '/enable-banking/aspsps?country=fi');
    expect(body).toEqual([{ name: 'Nordea', country: 'FI', maximumConsentDays: 180, beta: false }]);
  });

  it('connects a bank through its redirect, which needs no session or token, only its state', async () => {
    // An account that already has this IBAN's history from CAMT statements and by hand
    const created = await call('POST', '/accounts', {
      name: 'Nordea checking',
      type: 'checking',
      startingBalance: 0,
    });
    checkingId = created.body.id;
    await call('PUT', `/accounts/${checkingId}/statement-account`, { account: IBAN_CHECKING });
    const now = new Date().toISOString();
    const row = (id: string, date: string, amount: number, importedId: string | null) => ({
      id,
      accountId: checkingId,
      date,
      amount,
      payeeName: 'Old',
      importedId,
      createdAt: now,
    });
    db.insert(transactions)
      .values([
        row('camt-1', '2026-09-01', -1250, 'camt:2026-09-01|-1250|REF-1'),
        row('manual-1', '2026-09-03', -899, null),
        row('csv-old', '2026-08-01', -500, '2026-08-01|-500|shop'),
      ])
      .run();

    const start = await call('POST', '/enable-banking/auth', {
      aspspName: 'Nordea',
      country: 'FI',
    });
    expect(start.status).toBe(200);
    expect(start.body.url).toContain('bank.example');
    const state = mock.states.at(-1)!;
    expect(state).toMatch(new RegExp(`^fb1\\.${new URL(base).port}\\.`));
    expect((await call('GET', `/enable-banking/auth/${start.body.authId}`)).body).toEqual({
      status: 'pending',
    });

    // Other cross-site requests are still refused
    const forged = await fetch(`${base}/api/enable-banking/status`, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(forged.status).toBe(403);
    const forgedPost = await fetch(`${base}${BANK_CALLBACK_PATH}?state=${state}&code=x`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(forgedPost.status).toBe(403);
    // A state FlyBudget didn't make is refused
    expect((await bankRedirect('state=fb1.1.' + 'a'.repeat(43) + '&code=c1')).status).toBe(400);

    const back = await bankRedirect(`state=${state}&code=code-1`);
    expect(back.status).toBe(200);
    expect(await back.text()).toContain('Bank connected');
    // Used once only
    const replay = await bankRedirect(`state=${state}&code=code-1`);
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain('Already done');

    const poll = await call('GET', `/enable-banking/auth/${start.body.authId}`);
    expect(poll.body.status).toBe('success');
    connectionId = poll.body.result.connectionId;
    mappings = poll.body.result.accounts;
    expect(mappings).toHaveLength(2);
    const checking = mappings.find((m) => m.iban === IBAN_CHECKING)!;
    expect(checking.suggestedAccountId).toBe(checkingId);
    expect(mappings.find((m) => m.iban === IBAN_SAVINGS)!.suggestedAccountId).toBeNull();
    // The session id is stored encrypted
    const raw = db.$client.prepare('select session_id from enable_banking_connections').get() as {
      session_id: string;
    };
    expect(raw.session_id.startsWith('enc:v1:')).toBe(true);
  });

  it('syncs booked transactions, recognising ones already imported from files or typed in', async () => {
    const checking = mappings.find((m) => m.iban === IBAN_CHECKING)!;
    const savings = mappings.find((m) => m.iban === IBAN_SAVINGS)!;
    const mapped = await call('POST', `/enable-banking/connections/${connectionId}/map-accounts`, {
      mappings: [
        { mappingId: checking.mappingId, action: 'link', accountId: checkingId },
        {
          mappingId: savings.mappingId,
          action: 'create',
          accountName: 'Savings',
          accountType: 'savings',
        },
      ],
    });
    expect(mapped.body).toEqual({ mapped: 1, created: 1, skipped: 0 });

    mock.transactions.checking = [
      bankTx('REF-1', '2026-09-01', '12.50', 'DBIT', 'Grocer'), // the CAMT row
      bankTx('REF-2', '2026-09-04', '8.99', 'DBIT', 'Cafe'), // the hand-typed one, a day later
      bankTx('REF-3', '2026-09-10', '2500.00', 'CRDT', 'Employer'),
      { booking_date: '2026-09-11', transaction_amount: { amount: 'n/a' } },
    ];
    mock.transactions.savings = [bankTx('S-1', '2026-09-05', '100.00', 'CRDT', 'Me')];
    const sync = await call('POST', `/enable-banking/connections/${connectionId}/sync`, {});
    expect(sync.body).toMatchObject({
      added: 2,
      adopted: 2,
      skipped: { noDate: 0, badAmount: 1, otherCurrency: 0 },
    });
    expect(sync.body.errors).toEqual([]);

    // Linked with history: carries on from a week before its latest transaction
    expect(mock.queries.checking[0].date_from).toBe('2026-08-27');
    // A new account gets everything the bank has
    expect(mock.queries.savings[0].strategy).toBe('longest');
    expect(mock.queries.savings).toHaveLength(2); // the repeated continuation key stopped it

    const rows = rowsIn(checkingId);
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.id === 'camt-1')!.importedId).toBe(`eb:${checking.mappingId}:REF-1`);
    expect(rows.find((r) => r.id === 'manual-1')!.importedId).toBe(
      `eb:${checking.mappingId}:REF-2`,
    );
    expect(rows.find((r) => r.amount === 250000)!.payeeName).toBe('Employer');
    // Balance follows the booked balance, not the available one
    const acct = db.select().from(accounts).where(eq(accounts.id, checkingId)).get()!;
    expect(acct.startingBalance + rows.reduce((s, r) => s + r.amount, 0)).toBe(100000);

    const second = await call('POST', `/enable-banking/connections/${connectionId}/sync`, {});
    expect(second.body).toMatchObject({ added: 0, adopted: 0 });
    expect(rowsIn(checkingId)).toHaveLength(4);
    // Later syncs ask for two weeks before the latest booking
    expect(mock.queries.checking[1].date_from).toBe('2026-08-27');
  });

  it('skips startup syncs for banks synced in the last few hours (banks allow only a few a day)', async () => {
    const before = mock.queries.checking.length;
    expect(await syncAllEnableBankingConnections({ unattended: true })).toEqual([]);
    expect(mock.queries.checking.length).toBe(before);
  });

  it('a sync cut off by quitting FlyBudget no longer shows as running after a restart', async () => {
    db.update(enableBankingConnections).set({ syncStatus: 'syncing' }).run();
    await syncAllEnableBankingConnections({ unattended: true });
    const [conn] = (await call('GET', '/enable-banking/connections')).body;
    expect(conn.syncStatus).toBe('error');
    expect(conn.syncError).toMatch(/interrupted/);
  });

  it('counts a page the bank repeats under a new key once, even without references', async () => {
    const savings = mappings.find((m) => m.iban === IBAN_SAVINGS)!;
    const before = db.select().from(transactions).all().length;
    mock.rotateKeys = true;
    mock.transactions.savings = [
      {
        booking_date: '2026-09-20',
        transaction_amount: { amount: '5.00' },
        credit_debit_indicator: 'DBIT',
      },
      {
        booking_date: '2026-09-20',
        transaction_amount: { amount: '5.00' },
        credit_debit_indicator: 'DBIT',
      },
    ];
    await call('POST', `/enable-banking/connections/${connectionId}/sync`, {});
    mock.rotateKeys = false;
    const added = db
      .select()
      .from(transactions)
      .all()
      .filter((t) => t.importedId?.startsWith(`eb:${savings.mappingId}:h:`));
    // Two identical coffees on one page are two transactions; the repeated page adds none
    expect(added).toHaveLength(2);
    expect(db.select().from(transactions).all().length).toBe(before + 2);
  });

  it('asks to reconnect when the session ends, and a reconnect keeps the mappings and history', async () => {
    mock.expired = true;
    const sync = await call('POST', `/enable-banking/connections/${connectionId}/sync`, {});
    expect(sync.body.errors[0]).toMatch(/Reconnect/);
    const [conn] = (await call('GET', '/enable-banking/connections')).body;
    expect(conn.syncStatus).toBe('login_required');
    mock.expired = false;

    const start = await call('POST', '/enable-banking/auth', { connectionId });
    const state = mock.states.at(-1)!;
    // The paste fallback: the address the browser ended up on
    const wrong = await call('POST', `/enable-banking/auth/${start.body.authId}/complete`, {
      url: `${RELAY_REDIRECT_URL}?state=someone-else&code=x`,
    });
    expect(wrong.status).toBe(400);
    const pasted = await call('POST', `/enable-banking/auth/${start.body.authId}/complete`, {
      url: `${RELAY_REDIRECT_URL}?code=code-2&state=${state}`,
    });
    expect(pasted.body.status).toBe('success');
    expect(pasted.body.result.connectionId).toBe(connectionId);
    const again = pasted.body.result.accounts as typeof mappings;
    expect(again.map((m) => [m.mappingId, m.accountId]).sort()).toEqual(
      (await call('GET', '/enable-banking/connections')).body[0].accounts
        .map((m: (typeof mappings)[number]) => [m.mappingId, m.accountId])
        .sort(),
    );
    expect(again).toHaveLength(2);
    expect(again.every((m) => m.accountId)).toBe(true);
    // The previous session is left to expire: ending it can cut off the new one too
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.deleted).not.toContain('session-1');

    const sync2 = await call('POST', `/enable-banking/connections/${connectionId}/sync`, {});
    expect(sync2.body).toMatchObject({ added: 0, errors: [] });
    expect(rowsIn(checkingId)).toHaveLength(4);
    const [after] = (await call('GET', '/enable-banking/connections')).body;
    expect(after.syncStatus).toBe('good');
  });

  it('a reconnect still finds an account whose bank ids changed, and drops the stale one', async () => {
    mock.checkingHash = 'hash-changed';
    mock.checkingIban = null;
    const start = await call('POST', '/enable-banking/auth', { connectionId });
    await bankRedirect(`state=${mock.states.at(-1)}&code=code-changed`);
    const poll = await call('GET', `/enable-banking/auth/${start.body.authId}`);
    expect(poll.body.status).toBe('success');
    const accountsNow = poll.body.result.accounts as typeof mappings;
    expect(accountsNow).toHaveLength(2);
    expect(accountsNow.every((m) => m.accountId)).toBe(true);
    const sync = await call('POST', `/enable-banking/connections/${connectionId}/sync`, {});
    expect(sync.body).toMatchObject({ added: 0, errors: [] });
    mock.checkingHash = 'hash-checking';
    mock.checkingIban = IBAN_CHECKING;
  });

  it('a cancelled bank login says so', async () => {
    const start = await call('POST', '/enable-banking/auth', {
      aspspName: 'Nordea',
      country: 'FI',
    });
    const back = await bankRedirect(`state=${mock.states.at(-1)}&error=access_denied`);
    expect(back.status).toBe(400);
    const poll = await call('GET', `/enable-banking/auth/${start.body.authId}`);
    expect(poll.body).toEqual({ status: 'error', message: expect.stringMatching(/cancelled/) });
  });

  it('keeps bank links through a backup restore', async () => {
    const tables = Object.fromEntries(
      BACKUP_TABLES.map((name) => [name, [] as Record<string, unknown>[]]),
    ) as Parameters<typeof restoreBackup>[0];
    tables.accounts = db.select().from(accounts).all() as never;
    restoreBackup(tables);
    const [conn] = (await call('GET', '/enable-banking/connections')).body;
    expect(conn.accounts.every((m: { accountId: string | null }) => m.accountId)).toBe(true);
    // The restored budget has none of the bank's transactions: the next sync brings them
    // all back instead of carrying on from where it was before the restore
    expect(conn.accounts.every((m: { lastBookedDate: string | null }) => !m.lastBookedDate)).toBe(
      true,
    );
    const sync = await call('POST', `/enable-banking/connections/${connectionId}/sync`, {});
    expect(sync.body.errors).toEqual([]);
    expect(mock.queries.checking.at(-1)!.strategy).toBe('longest');
    expect(rowsIn(checkingId)).toHaveLength(3);
  });

  it("keeps the connection when Enable Banking can't be reached to end the access", async () => {
    mock.down = true;
    expect((await call('DELETE', `/enable-banking/connections/${connectionId}`)).status).toBe(422);
    expect(db.select().from(enableBankingConnections).all()).toHaveLength(1);
    mock.down = false;
    // Or when it asks to wait: the bank access would stay open with nothing left to end it
    mock.limitDelete = true;
    expect((await call('DELETE', `/enable-banking/connections/${connectionId}`)).status).toBe(422);
    expect(db.select().from(enableBankingConnections).all()).toHaveLength(1);
    mock.limitDelete = false;
    expect((await call('DELETE', `/enable-banking/connections/${connectionId}`)).status).toBe(204);
    // The current session (from the last reconnect) was ended at Enable Banking
    expect(mock.deleted.at(-1)).toBe(`session-${mock.sessionCount}`);
    expect(db.select().from(enableBankingConnections).all()).toHaveLength(0);
  });

  it('adding the same bank again later recognises everything it imported before', async () => {
    const start = await call('POST', '/enable-banking/auth', {
      aspspName: 'Nordea',
      country: 'FI',
    });
    await bankRedirect(`state=${mock.states.at(-1)}&code=code-again`);
    const poll = await call('GET', `/enable-banking/auth/${start.body.authId}`);
    const fresh = poll.body.result.accounts as typeof mappings;
    const checking = fresh.find((m) => m.iban === IBAN_CHECKING)!;
    expect(checking.suggestedAccountId).toBe(checkingId);
    await call(
      'POST',
      `/enable-banking/connections/${poll.body.result.connectionId}/map-accounts`,
      {
        mappings: [
          { mappingId: checking.mappingId, action: 'link', accountId: checkingId },
          { mappingId: fresh.find((m) => m.iban === IBAN_SAVINGS)!.mappingId, action: 'skip' },
        ],
      },
    );
    const sync = await call(
      'POST',
      `/enable-banking/connections/${poll.body.result.connectionId}/sync`,
      { fullHistory: [checking.mappingId] },
    );
    expect(sync.body).toMatchObject({ added: 0, adopted: 3, errors: [] });
    expect(rowsIn(checkingId)).toHaveLength(3);
  });

  it("disconnecting one of two connections to the same bank doesn't end the other's access", async () => {
    const start = await call('POST', '/enable-banking/auth', {
      aspspName: 'Nordea',
      country: 'FI',
    });
    await bankRedirect(`state=${mock.states.at(-1)}&code=code-third`);
    const poll = await call('GET', `/enable-banking/auth/${start.body.authId}`);
    const [first] = (await call('GET', '/enable-banking/connections')).body;
    expect(first.id).not.toBe(poll.body.result.connectionId);
    const deletedBefore = mock.deleted.length;
    expect((await call('DELETE', `/enable-banking/connections/${first.id}`)).status).toBe(204);
    // Forgotten locally only: ending its session could revoke the other connection's consent
    expect(mock.deleted).toHaveLength(deletedBefore);
    expect(db.select().from(enableBankingConnections).all()).toHaveLength(1);
  });
});

describe('requests to Enable Banking', () => {
  it('were all signed with the application key: RS256, its id as key id, valid for an hour', () => {
    const tokens = mock.authorizations.map(decodeJwt);
    expect(tokens.length).toBeGreaterThan(20);
    for (const { head, body } of tokens) {
      expect(head).toEqual({ typ: 'JWT', alg: 'RS256', kid: APP_ID });
      expect(body).toMatchObject({ iss: 'enablebanking.com', aud: 'api.enablebanking.com' });
      expect(body.exp - body.iat).toBe(3600);
    }
    // All but the configure test's wrong key, which Enable Banking would refuse
    expect(tokens.filter((t) => !t.signedByApp)).toHaveLength(1);
  });
});

describe('psuContext', () => {
  it('sends only public addresses, unwrapped from IPv6, and a clean user agent', () => {
    expect(psuContext('127.0.0.1', 'UA')).toEqual({ userAgent: 'UA' });
    expect(psuContext('192.168.1.5', undefined)).toEqual({});
    expect(psuContext('::ffff:8.8.8.8', 'A\nB')).toEqual({ ip: '8.8.8.8', userAgent: 'AB' });
  });
});
