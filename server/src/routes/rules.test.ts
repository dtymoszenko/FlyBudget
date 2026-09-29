import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accounts, categories, categoryGroups, payees, rules, transactions } from '../db/schema.js';
import { rulesRouter } from './rules.js';
import { transactionsRouter } from './transactions.js';

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use(express.json());
  app.use('/api/rules', rulesRouter);
  app.use('/api/transactions', transactionsRouter);
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server.close());

const call = (method: string, path: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (method: string, path: string, body?: unknown) =>
  (await call(method, path, body)).json();

const ACCOUNT = 'acct';
const COFFEE = 'cat-coffee';
const GROCERIES = 'cat-groceries';
const HOUSEHOLD = 'cat-household';

beforeEach(() => {
  db.delete(transactions).run();
  db.delete(rules).run();
  db.delete(payees).run();
  db.delete(categories).run();
  db.delete(categoryGroups).run();
  db.delete(accounts).run();
  db.insert(accounts).values({ id: ACCOUNT, name: 'Checking', type: 'checking' }).run();
  db.insert(categoryGroups).values({ id: 'grp', name: 'Spending' }).run();
  for (const [id, name] of [
    [COFFEE, 'Coffee'],
    [GROCERIES, 'Groceries'],
    [HOUSEHOLD, 'Household'],
  ]) {
    db.insert(categories).values({ id, groupId: 'grp', name }).run();
  }
  db.insert(payees)
    .values({ id: 'blue-bottle', name: 'Blue Bottle', defaultCategoryId: null })
    .run();
  db.insert(payees).values({ id: 'target', name: 'Target', defaultCategoryId: HOUSEHOLD }).run();
});

const addRule = (rule: object) => json('POST', '/rules', rule);
const importRows = (rows: Array<{ payeeName: string; amount: number; notes?: string }>) =>
  json('POST', '/transactions/import/confirm', {
    accountId: ACCOUNT,
    rows: rows.map((r, i) => ({ date: '2026-09-01', importedId: `imp-${i}-${r.payeeName}`, ...r })),
  });
const tx = (payeeName: string) =>
  db.select().from(transactions).where(eq(transactions.importedPayee, payeeName)).get()!;

describe('rule validation', () => {
  it.each([
    [
      'a regex that does not compile',
      { conditions: [{ field: 'payee_name', op: 'regex', value: '(' }] },
    ],
    [
      'a regex over 200 characters',
      { conditions: [{ field: 'notes', op: 'regex', value: 'a'.repeat(201) }] },
    ],
    [
      'a date in another format',
      { conditions: [{ field: 'date', op: 'after', value: '09/01/2026' }] },
    ],
    ['a negative amount', { conditions: [{ field: 'amount', op: 'gt', value: -5 }] }],
    [
      'a text op on an id field',
      { conditions: [{ field: 'category', op: 'contains', value: 'x' }] },
    ],
    [
      'a split percent over 100',
      {
        actions: [
          {
            type: 'split',
            parts: [{ kind: 'percent', value: 150, categoryId: null, notes: null }],
          },
        ],
      },
    ],
    ['no actions', { actions: [] }],
  ])('rejects %s', async (_, patch) => {
    const res = await call('POST', '/rules', {
      conditions: [{ field: 'payee_name', op: 'contains', value: 'x' }],
      actions: [{ type: 'set_category', value: COFFEE }],
      ...patch,
    });
    expect(res.status).toBe(400);
  });

  it('returns rules saved in the original format converted to the new one', async () => {
    db.insert(rules)
      .values({
        id: 'legacy',
        conditions: JSON.stringify([{ field: 'payee_name', op: 'exact', value: 'Kroger' }]),
        actions: JSON.stringify([{ field: 'category_id', value: GROCERIES }]),
        sortOrder: 0,
      })
      .run();
    const [rule] = await json('GET', '/rules');
    expect(rule).toMatchObject({
      conditionsOp: 'and',
      enabled: true,
      conditions: [{ field: 'payee_name', op: 'is', value: 'Kroger' }],
      actions: [{ type: 'set_category', value: GROCERIES }],
    });
  });
});

describe('rules on new transactions', () => {
  it('renames an imported payee, categorizes the new name, and keeps the raw description', async () => {
    await addRule({
      conditions: [{ field: 'imported_payee', op: 'starts_with', value: 'sq *blue bottle' }],
      actions: [{ type: 'set_payee', value: 'blue-bottle' }],
      sortOrder: 0,
    });
    await addRule({
      conditions: [{ field: 'payee', op: 'is', value: 'blue-bottle' }],
      actions: [
        { type: 'set_category', value: COFFEE },
        { type: 'append_notes', value: ' #coffee' },
      ],
      sortOrder: 1,
    });
    await importRows([{ payeeName: 'SQ *BLUE BOTTLE 0042', amount: -650 }]);

    expect(tx('SQ *BLUE BOTTLE 0042')).toMatchObject({
      payeeId: 'blue-bottle',
      payeeName: 'Blue Bottle',
      categoryId: COFFEE,
      notes: ' #coffee',
    });
    // No junk payee was created for the raw description
    expect(
      db
        .select()
        .from(payees)
        .all()
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Blue Bottle', 'Target']);
  });

  it('matches "any" conditions and skips disabled rules', async () => {
    await addRule({
      conditionsOp: 'or',
      conditions: [
        { field: 'payee_name', op: 'contains', value: 'kroger' },
        { field: 'payee_name', op: 'one_of', value: ['aldi', 'publix'] },
      ],
      actions: [{ type: 'set_category', value: GROCERIES }],
    });
    await addRule({
      enabled: false,
      conditions: [],
      actions: [{ type: 'set_notes', value: 'never' }],
    });
    await importRows([
      { payeeName: 'KROGER #123', amount: -4200 },
      { payeeName: 'Publix', amount: -1800 },
      { payeeName: 'Shell', amount: -3000 },
    ]);

    expect(tx('KROGER #123').categoryId).toBe(GROCERIES);
    expect(tx('Publix').categoryId).toBe(GROCERIES);
    expect(tx('Shell').categoryId).toBeNull();
    expect(
      db
        .select()
        .from(transactions)
        .all()
        .every((t) => t.notes !== 'never'),
    ).toBe(true);
  });

  it('falls back to the payee default category when no rule sets one', async () => {
    await importRows([{ payeeName: 'Target', amount: -2500 }]);
    expect(tx('Target').categoryId).toBe(HOUSEHOLD);
  });

  it('splits a transaction into parts that add up to the total', async () => {
    await addRule({
      conditions: [
        { field: 'payee_name', op: 'is', value: 'Costco' },
        { field: 'direction', op: 'is', value: 'outflow' },
      ],
      actions: [
        {
          type: 'split',
          parts: [
            { kind: 'fixed', value: 1000, categoryId: COFFEE, notes: 'snacks' },
            { kind: 'percent', value: 50, categoryId: HOUSEHOLD, notes: null },
            { kind: 'remainder', value: 0, categoryId: GROCERIES, notes: null },
          ],
        },
      ],
    });
    await importRows([{ payeeName: 'Costco', amount: -10001 }]);

    const parent = tx('Costco');
    expect(parent).toMatchObject({ isParent: 1, categoryId: null, amount: -10001 });
    const children = db
      .select()
      .from(transactions)
      .where(eq(transactions.parentTransactionId, parent.id))
      .all();
    expect(children.map((c) => [c.categoryId, c.amount]).sort()).toEqual(
      [
        [COFFEE, -1000],
        [GROCERIES, -4000],
        [HOUSEHOLD, -5001],
      ].sort(),
    );
  });

  it('never replaces a category or notes the user entered by hand', async () => {
    await addRule({
      conditions: [],
      actions: [
        { type: 'set_category', value: COFFEE },
        { type: 'set_notes', value: 'rule' },
      ],
    });
    const mine = await json('POST', '/transactions', {
      accountId: ACCOUNT,
      date: '2026-09-02',
      amount: -500,
      payeeName: 'Corner Shop',
      categoryId: GROCERIES,
      notes: 'mine',
    });
    expect(mine).toMatchObject({ categoryId: GROCERIES, notes: 'mine' });
    const blank = await json('POST', '/transactions', {
      accountId: ACCOUNT,
      date: '2026-09-02',
      amount: -500,
      payeeName: 'Corner Shop',
    });
    expect(blank).toMatchObject({ categoryId: COFFEE, notes: 'rule' });
  });
});

describe('rules on existing transactions', () => {
  beforeEach(async () => {
    await importRows([
      { payeeName: 'Starbucks 1', amount: -500 },
      { payeeName: 'Starbucks 2', amount: -700 },
      { payeeName: 'Starbucks 3', amount: -900 },
    ]);
    // Reconciled and already-categorized transactions
    db.update(transactions)
      .set({ reconciled: 1 })
      .where(eq(transactions.importedPayee, 'Starbucks 3'))
      .run();
  });

  it('previews only what would change, then applies just the ticked transactions', async () => {
    await addRule({
      conditions: [{ field: 'payee_name', op: 'starts_with', value: 'starbucks' }],
      actions: [{ type: 'set_category', value: COFFEE }],
    });

    const preview = await json('POST', '/rules/preview', { scope: 'uncategorized' });
    expect(preview.map((p: { payeeName: string }) => p.payeeName).sort()).toEqual([
      'Starbucks 1',
      'Starbucks 2',
    ]);
    expect(preview[0].changes.category).toEqual({ from: null, to: COFFEE });

    const one = tx('Starbucks 1').id;
    expect(
      await json('POST', '/rules/apply', { scope: 'uncategorized', transactionIds: [one] }),
    ).toEqual({ updated: 1 });
    expect(tx('Starbucks 1').categoryId).toBe(COFFEE);
    expect(tx('Starbucks 2').categoryId).toBeNull();
    expect(tx('Starbucks 3').categoryId).toBeNull(); // reconciled: never touched

    const rest = await json('POST', '/rules/preview', { scope: 'uncategorized' });
    expect(rest.map((p: { payeeName: string }) => p.payeeName)).toEqual(['Starbucks 2']);
  });

  it('re-categorizes already categorized transactions only in "all" scope, and runs a single rule even if disabled', async () => {
    db.update(transactions)
      .set({ categoryId: GROCERIES })
      .where(isNull(transactions.categoryId))
      .run();
    const rule = await addRule({
      enabled: false,
      conditions: [{ field: 'amount', op: 'lte', value: 700 }],
      actions: [{ type: 'set_category', value: COFFEE }],
    });

    expect(await json('POST', '/rules/preview', { scope: 'all' })).toEqual([]);
    expect(
      await json('POST', '/rules/preview', { scope: 'uncategorized', ruleIds: [rule.id] }),
    ).toEqual([]);
    const preview = await json('POST', '/rules/preview', { scope: 'all', ruleIds: [rule.id] });
    expect(preview).toHaveLength(2);
    expect(preview[0].changes.category).toEqual({ from: GROCERIES, to: COFFEE });
  });

  it('splits an existing transaction into children', async () => {
    const rule = await addRule({
      conditions: [{ field: 'payee_name', op: 'is', value: 'starbucks 1' }],
      actions: [
        {
          type: 'split',
          parts: [
            { kind: 'percent', value: 50, categoryId: COFFEE, notes: null },
            { kind: 'remainder', value: 0, categoryId: GROCERIES, notes: null },
          ],
        },
      ],
    });
    const id = tx('Starbucks 1').id;
    await json('POST', '/rules/apply', { scope: 'all', ruleIds: [rule.id], transactionIds: [id] });

    expect(tx('Starbucks 1')).toMatchObject({ isParent: 1, categoryId: null });
    const children = db
      .select()
      .from(transactions)
      .where(eq(transactions.parentTransactionId, id))
      .all();
    expect(children.map((c) => c.amount)).toEqual([-250, -250]);
    // Split transactions are left alone afterwards
    expect(await json('POST', '/rules/preview', { scope: 'all', ruleIds: [rule.id] })).toEqual([]);
  });
});
