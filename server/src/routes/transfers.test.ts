import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { categories, categoryGroups, transactions } from '../db/schema.js';
import { accountsRouter } from './accounts.js';
import { transactionsRouter } from './transactions.js';
import { syncedTransferChange } from '../services/transferService.js';

// Existing transactions as transfers (issue #89): a bank import brings in both sides of a
// credit card payment or a move to savings as ordinary transactions. Its own file, so the
// database holds only this test's data.

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', accountsRouter);
  app.use('/api/transactions', transactionsRouter);
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  db.insert(categoryGroups).values({ id: 'g-bills', name: 'Bills', isIncome: 0 }).run();
  db.insert(categories).values({ id: 'c-card', groupId: 'g-bills', name: 'Card payment' }).run();
});
afterAll(() => server.close());

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

let n = 0;
async function account(name: string, type = 'checking') {
  const { body } = await call('POST', '/accounts', { name, type, startingBalance: 0 });
  return body.id as string;
}
async function imported(accountId: string, date: string, amount: number, payeeName: string) {
  const rows = [{ date, amount, payeeName, importedId: `bank-${n++}` }];
  await call('POST', '/transactions/import/confirm', { accountId, rows });
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.importedId, rows[0].importedId))
    .get()!;
}
const row = (id: string) => db.select().from(transactions).where(eq(transactions.id, id)).get()!;
const balance = async (id: string) =>
  ((await call('GET', '/accounts')).body as { id: string; balance: number }[]).find(
    (a) => a.id === id,
  )!.balance;
const suggestions = async (accountId?: string) =>
  (
    await call(
      'GET',
      `/transactions/transfers/suggestions${accountId ? `?account_id=${accountId}` : ''}`,
    )
  ).body as { outflow: { id: string }; inflow: { id: string }; days: number }[];

describe('transfers between existing transactions', () => {
  it('suggests an imported payment and its other side, then links them', async () => {
    const checking = await account('Checking A');
    const card = await account('Card A', 'credit');
    const out = await imported(checking, '2096-01-10', -12_345, 'PAYMENT TO CARD');
    const into = await imported(card, '2096-01-12', 12_345, 'PAYMENT THANK YOU');
    // Not a match: same account, and too far apart
    await imported(checking, '2096-01-11', 12_345, 'REFUND');
    await imported(card, '2096-02-20', 12_345, 'LATE CREDIT');
    await call('PUT', `/transactions/${out.id}`, { categoryId: 'c-card' });

    const found = (await suggestions(checking)).filter((s) => s.outflow.id === out.id);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ inflow: { id: into.id }, days: 2 });

    const before = [await balance(checking), await balance(card)];
    const linked = await call('POST', '/transactions/transfers/link', {
      transactionId: out.id,
      otherTransactionId: into.id,
    });
    expect(linked.status).toBe(200);
    expect(linked.body.created).toBe(false);
    expect(row(out.id)).toMatchObject({
      transferTransactionId: into.id,
      categoryId: null,
      payeeName: 'Transfer: Card A',
      importedPayee: 'PAYMENT TO CARD',
    });
    expect(row(into.id)).toMatchObject({
      transferTransactionId: out.id,
      payeeName: 'Transfer: Checking A',
    });
    // Linking moves no money: both sides were already in their accounts
    expect([await balance(checking), await balance(card)]).toEqual(before);
    expect((await suggestions()).some((s) => s.outflow.id === out.id)).toBe(false);
  });

  it('"Transfer: account" on one transaction links the matching one already there', async () => {
    const checking = await account('Checking B');
    const savings = await account('Savings B', 'savings');
    const out = await imported(checking, '2096-03-01', -50_000, 'ONLINE TRANSFER');
    const into = await imported(savings, '2096-03-03', 50_000, 'DEPOSIT');

    const res = await call('POST', `/transactions/${into.id}/transfer`, { accountId: checking });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(row(into.id).transferTransactionId).toBe(out.id);
    expect(row(out.id).transferTransactionId).toBe(into.id);
  });

  it('creates the other side when there is no match, moving the money', async () => {
    const checking = await account('Checking C');
    const savings = await account('Savings C', 'savings');
    const out = await imported(checking, '2096-04-01', -7_500, 'TO SAVINGS');

    const res = await call('POST', `/transactions/${out.id}/transfer`, { accountId: savings });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    const otherId = row(out.id).transferTransactionId!;
    expect(row(otherId)).toMatchObject({
      accountId: savings,
      amount: 7_500,
      date: '2096-04-01',
      transferTransactionId: out.id,
    });
    expect(await balance(savings)).toBe(7_500);
  });

  it('"Not a transfer" restores the bank text and stops suggesting the pair', async () => {
    const checking = await account('Checking D');
    const savings = await account('Savings D', 'savings');
    const out = await imported(checking, '2096-05-01', -2_000, 'VENMO');
    const into = await imported(savings, '2096-05-01', 2_000, 'INTEREST');
    await call('POST', '/transactions/transfers/link', {
      transactionId: out.id,
      otherTransactionId: into.id,
    });

    const res = await call('POST', `/transactions/${out.id}/unlink-transfer`);
    expect(res.status).toBe(200);
    expect(row(out.id)).toMatchObject({
      transferTransactionId: null,
      payeeName: 'VENMO',
      payeeId: out.payeeId,
    });
    expect(out.payeeId).not.toBeNull();
    expect(row(into.id)).toMatchObject({ transferTransactionId: null, payeeName: 'INTEREST' });
    expect((await suggestions(checking)).some((s) => s.outflow.id === out.id)).toBe(false);
    // Linking them by hand still works (and forgets the dismissal)
    const again = await call('POST', '/transactions/transfers/link', {
      transactionId: into.id,
      otherTransactionId: out.id,
    });
    expect(again.status).toBe(200);
  });

  it('a dismissed suggestion stays dismissed', async () => {
    const checking = await account('Checking E');
    const savings = await account('Savings E', 'savings');
    const out = await imported(checking, '2096-06-01', -3_300, 'STORE');
    const into = await imported(savings, '2096-06-02', 3_300, 'FRIEND');
    expect((await suggestions(checking)).some((s) => s.inflow.id === into.id)).toBe(true);
    await call('POST', '/transactions/transfers/dismiss', {
      transactionId: into.id,
      otherTransactionId: out.id,
    });
    expect((await suggestions(checking)).some((s) => s.inflow.id === into.id)).toBe(false);
    // Choosing "Transfer: account" on it later links the real row instead of adding a copy
    const res = await call('POST', `/transactions/${into.id}/transfer`, { accountId: checking });
    expect(res.body.created).toBe(false);
    expect(row(into.id).transferTransactionId).toBe(out.id);
  });

  it('refuses pairs that cannot be a transfer', async () => {
    const checking = await account('Checking F');
    const savings = await account('Savings F', 'savings');
    const a = await imported(checking, '2096-07-01', -1_000, 'A');
    const b = await imported(checking, '2096-07-01', 1_000, 'B');
    const c = await imported(savings, '2096-07-01', 999, 'C');
    const d = await imported(savings, '2096-07-01', 1_000, 'D');
    const link = (x: string, y: string) =>
      call('POST', '/transactions/transfers/link', { transactionId: x, otherTransactionId: y });

    expect((await link(a.id, b.id)).status).toBe(400); // same account
    expect((await link(a.id, c.id)).status).toBe(400); // amounts differ
    expect(
      (await call('POST', `/transactions/${a.id}/transfer`, { accountId: checking })).status,
    ).toBe(400);
    db.update(transactions).set({ reconciled: 1 }).where(eq(transactions.id, d.id)).run();
    expect((await link(a.id, d.id)).status).toBe(403);
    expect(
      (await call('POST', `/transactions/${a.id}/transfer`, { accountId: 'nope' })).status,
    ).toBe(404);
    expect(row(a.id).transferTransactionId).toBeNull();
  });
});

describe('when one side of a transfer changes on its own', () => {
  async function linkedPair(name: string, date: string, amount: number) {
    const checking = await account(`Checking ${name}`);
    const card = await account(`Card ${name}`, 'credit');
    const out = await imported(checking, date, -amount, 'PAYMENT TO CARD');
    const into = await imported(card, date, amount, 'PAYMENT THANK YOU');
    await call('POST', '/transactions/transfers/link', {
      transactionId: out.id,
      otherTransactionId: into.id,
    });
    return { checking, card, out: row(out.id), into: row(into.id) };
  }

  it('deleting one side gives the other its bank text back', async () => {
    const { out, into } = await linkedPair('G', '2096-08-01', 4_000);
    expect((await call('DELETE', `/transactions/${out.id}`)).status).toBe(204);
    expect(row(into.id)).toMatchObject({
      transferTransactionId: null,
      payeeName: 'PAYMENT THANK YOU',
    });
  });

  it('a side FlyBudget created keeps its name when the other is deleted', async () => {
    const checking = await account('Checking H');
    const savings = await account('Savings H', 'savings');
    const out = await imported(checking, '2096-08-05', -900, 'TO SAVINGS');
    await call('POST', `/transactions/${out.id}/transfer`, { accountId: savings });
    const otherId = row(out.id).transferTransactionId!;
    await call('DELETE', `/transactions/${out.id}`);
    expect(row(otherId)).toMatchObject({
      transferTransactionId: null,
      payeeName: 'Transfer: Checking H',
    });
  });

  it('a bank sync changing the date alone keeps the link', async () => {
    const { out, into } = await linkedPair('I', '2096-08-10', 2_500);
    expect(
      syncedTransferChange(out, { date: '2096-08-11', amount: out.amount, importedPayee: 'X' }),
    ).toBe('linked');
    expect(row(into.id).transferTransactionId).toBe(out.id);
  });

  it('a new amount from the bank unlinks two imported sides', async () => {
    const { out, into } = await linkedPair('J', '2096-08-15', 2_500);
    expect(
      syncedTransferChange(out, { date: out.date, amount: -2_600, importedPayee: 'PAYMENT 2' }),
    ).toBe('unlinked');
    // Named after the bank's new text
    expect(row(out.id)).toMatchObject({ transferTransactionId: null, payeeName: 'PAYMENT 2' });
    expect(row(into.id)).toMatchObject({
      transferTransactionId: null,
      payeeName: 'PAYMENT THANK YOU',
      amount: 2_500,
    });
  });

  it('a new amount from the bank is followed by the side FlyBudget created', async () => {
    const checking = await account('Checking K');
    const savings = await account('Savings K', 'savings');
    const out = await imported(checking, '2096-08-20', -1_200, 'TO SAVINGS');
    await call('POST', `/transactions/${out.id}/transfer`, { accountId: savings });
    const otherId = row(out.id).transferTransactionId!;
    expect(
      syncedTransferChange(row(out.id), {
        date: '2096-08-21',
        amount: -1_300,
        importedPayee: 'TO SAVINGS',
      }),
    ).toBe('linked');
    expect(row(otherId)).toMatchObject({
      amount: 1_300,
      date: '2096-08-21',
      transferTransactionId: out.id,
    });
  });

  it('a reconciled other side keeps the pair together', async () => {
    const { out, into } = await linkedPair('L', '2096-08-25', 3_000);
    db.update(transactions).set({ reconciled: 1 }).where(eq(transactions.id, into.id)).run();
    expect(syncedTransferChange(out, { date: out.date, amount: -3_100, importedPayee: 'X' })).toBe(
      'locked',
    );
    expect(row(out.id).transferTransactionId).toBe(into.id);
  });

  it('a side you entered follows a date change from the bank', async () => {
    const checking = await account('Checking M');
    const savings = await account('Savings M', 'savings');
    const out = await imported(checking, '2096-09-01', -800, 'TO SAVINGS');
    await call('POST', `/transactions/${out.id}/transfer`, { accountId: savings });
    const otherId = row(out.id).transferTransactionId!;
    syncedTransferChange(row(out.id), { date: '2096-09-03', amount: -800, importedPayee: 'X' });
    expect(row(otherId).date).toBe('2096-09-03');
  });
});
