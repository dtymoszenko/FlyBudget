import { Router } from 'express';
import { db } from '../db/index.js';
import { transactions, payees, accounts, categories } from '../db/schema.js';
import { eq, and, like, gte, lte, sql, isNull, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { resolvePayee } from '../services/transactionHelpers.js';
import { buildRuleContext, insertNewTransaction, loadRules } from '../services/ruleService.js';

export const transactionsRouter = Router();

const createSchema = z.object({
  accountId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int(),
  payeeId: z.string().nullable().optional(),
  payeeName: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  splits: z
    .array(
      z.object({
        categoryId: z.string().nullable(),
        amount: z.number().int(),
        notes: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

const updateSchema = createSchema.omit({ splits: true }).partial();

const transferSchema = z.object({
  fromAccountId: z.string(),
  toAccountId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int().positive(),
  notes: z.string().nullable().optional(),
});

// Imported files are untrusted: validate dates and cap sizes
const importRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int(),
  payeeName: z.string().max(500).nullable().optional(),
  notes: z.string().max(5_000).nullable().optional(),
  importedId: z.string().max(500),
});
const importRowsSchema = z.array(importRowSchema).max(100_000);

// GET /transactions — excludes split children; attaches children array to parents
transactionsRouter.get('/', (req, res) => {
  const {
    account_id,
    month,
    from,
    to,
    category_id,
    category_ids,
    category_group_id,
    search,
    reconciled,
  } = req.query as Record<string, string>;

  let query = db.select().from(transactions).$dynamic();

  const conditions: ReturnType<typeof eq>[] = [isNull(transactions.parentTransactionId)];
  if (account_id) conditions.push(eq(transactions.accountId, account_id));
  if (month) {
    conditions.push(gte(transactions.date, `${month}-01`));
    conditions.push(lte(transactions.date, `${month}-31`));
  }
  if (from) conditions.push(gte(transactions.date, from));
  if (to) conditions.push(lte(transactions.date, to));
  if (category_ids) {
    const ids = category_ids.split(',').filter(Boolean);
    if (ids.length) conditions.push(inArray(transactions.categoryId, ids));
  } else if (category_id) {
    conditions.push(eq(transactions.categoryId, category_id));
  }
  if (category_group_id) {
    const catIds = db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.groupId, category_group_id))
      .all()
      .map((r) => r.id);
    if (catIds.length) conditions.push(inArray(transactions.categoryId, catIds));
  }
  if (search) conditions.push(like(transactions.payeeName, `%${search}%`));
  if (reconciled === '0' || reconciled === '1')
    conditions.push(eq(transactions.reconciled, Number(reconciled)));

  query = query.where(and(...conditions));

  const limit = Math.min(Number(req.query.limit ?? 200), 1000);
  const offset = Number(req.query.offset ?? 0);

  const rows = query
    .orderBy(sql`${transactions.date} desc`)
    .limit(limit)
    .offset(offset)
    .all();

  const parentIds = rows.filter((r) => r.isParent === 1).map((r) => r.id);
  const childrenMap = new Map<string, typeof rows>();
  if (parentIds.length) {
    const children = db
      .select()
      .from(transactions)
      .where(inArray(transactions.parentTransactionId, parentIds))
      .all();
    for (const child of children) {
      const pid = child.parentTransactionId!;
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid)!.push(child);
    }
  }

  const result = rows.map((r) => ({
    ...r,
    ...(r.isParent === 1 ? { children: childrenMap.get(r.id) ?? [] } : {}),
  }));

  res.json(result);
});

// POST /transactions — supports optional splits array
transactionsRouter.post('/', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { payeeName, payeeId, splits, ...rest } = parsed.data;

  if (splits && splits.length > 0) {
    const payee = resolvePayee(payeeName, payeeId);
    const finalPayeeId = payee.payeeId;
    const splitSum = splits.reduce((sum, s) => sum + s.amount, 0);
    if (splitSum !== rest.amount) {
      return res.status(400).json({ error: 'Split amounts must equal transaction total' });
    }

    const parentId = nanoid();
    const parent = {
      id: parentId,
      ...rest,
      categoryId: null,
      payeeId: finalPayeeId,
      payeeName: payee.payeeName,
      reconciled: 0,
      isParent: 1,
      transferTransactionId: null,
      parentTransactionId: null,
      importedId: null,
      createdAt: new Date().toISOString(),
    };
    db.insert(transactions).values(parent).run();

    const childRows = splits.map((s) => ({
      id: nanoid(),
      accountId: rest.accountId,
      date: rest.date,
      amount: s.amount,
      payeeId: finalPayeeId,
      payeeName: payee.payeeName,
      categoryId: s.categoryId,
      notes: s.notes ?? null,
      reconciled: 0,
      isParent: 0,
      transferTransactionId: null,
      parentTransactionId: parentId,
      importedId: null,
      createdAt: new Date().toISOString(),
    }));
    for (const child of childRows) db.insert(transactions).values(child).run();

    return res.status(201).json({ ...parent, children: childRows });
  }

  // Rules run on manual entries too, but never replace a category or notes the user entered
  const name =
    payeeName ??
    (payeeId ? (db.select().from(payees).where(eq(payees.id, payeeId)).get()?.name ?? null) : null);
  const { transaction, children } = insertNewTransaction(
    {
      accountId: rest.accountId,
      date: rest.date,
      amount: rest.amount,
      payeeId: payeeId ?? null,
      payeeName: name,
      importedPayee: null,
      notes: rest.notes ?? null,
      categoryId: rest.categoryId ?? null,
      importedId: null,
    },
    { keepUserCategory: true, keepUserNotes: true },
  );
  res.status(201).json(children.length ? { ...transaction, children } : transaction);
});

// POST /transactions/transfer — creates linked pair in two accounts
transactionsRouter.post('/transfer', (req, res) => {
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { fromAccountId, toAccountId, date, amount, notes } = parsed.data;
  const fromAcct = db.select().from(accounts).where(eq(accounts.id, fromAccountId)).get();
  const toAcct = db.select().from(accounts).where(eq(accounts.id, toAccountId)).get();
  if (!fromAcct || !toAcct) return res.status(404).json({ error: 'Account not found' });

  const fromId = nanoid();
  const toId = nanoid();
  const now = new Date().toISOString();

  const base = {
    reconciled: 0,
    isParent: 0,
    parentTransactionId: null,
    importedId: null,
    createdAt: now,
  };
  const fromTx = {
    id: fromId,
    accountId: fromAccountId,
    date,
    amount: -amount,
    payeeId: null,
    payeeName: `Transfer: ${toAcct.name}`,
    categoryId: null,
    notes: notes ?? null,
    transferTransactionId: toId,
    ...base,
  };
  const toTx = {
    id: toId,
    accountId: toAccountId,
    date,
    amount,
    payeeId: null,
    payeeName: `Transfer: ${fromAcct.name}`,
    categoryId: null,
    notes: notes ?? null,
    transferTransactionId: fromId,
    ...base,
  };

  db.insert(transactions).values(fromTx).run();
  db.insert(transactions).values(toTx).run();
  res.status(201).json([fromTx, toTx]);
});

// POST /transactions/import/preview — check for duplicates before importing
transactionsRouter.post('/import/preview', (req, res) => {
  const parsed = z
    .object({ accountId: z.string().max(64), rows: importRowsSchema })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { accountId, rows } = parsed.data;
  const importedIds = rows.map((r) => r.importedId);
  const existingSet = new Set<string | null>();

  if (importedIds.length) {
    const existing = db
      .select({ importedId: transactions.importedId })
      .from(transactions)
      .where(
        and(eq(transactions.accountId, accountId), inArray(transactions.importedId, importedIds)),
      )
      .all();
    for (const e of existing) existingSet.add(e.importedId);
  }

  res.json(rows.map((row) => ({ ...row, isDuplicate: existingSet.has(row.importedId) })));
});

// POST /transactions/import/confirm — insert non-duplicate rows
transactionsRouter.post('/import/confirm', (req, res) => {
  const parsed = z
    .object({ accountId: z.string().max(64), rows: importRowsSchema })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { accountId, rows } = parsed.data;
  let imported = 0;
  const ruleOpts = { rules: loadRules(), ctx: buildRuleContext() };

  for (const row of rows) {
    const dup = db
      .select()
      .from(transactions)
      .where(
        and(eq(transactions.accountId, accountId), eq(transactions.importedId, row.importedId)),
      )
      .get();
    if (dup) continue;

    insertNewTransaction(
      {
        accountId,
        date: row.date,
        amount: row.amount,
        payeeId: null,
        payeeName: row.payeeName || null,
        importedPayee: row.payeeName || null,
        notes: row.notes ?? null,
        categoryId: null,
        importedId: row.importedId,
      },
      ruleOpts,
    );
    imported++;
  }

  res.json({ imported, skipped: rows.length - imported });
});

// PUT /transactions/:id
transactionsRouter.put('/:id', (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = db.select().from(transactions).where(eq(transactions.id, req.params.id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.reconciled === 1)
    return res.status(403).json({ error: 'Cannot modify a reconciled transaction' });

  db.update(transactions).set(parsed.data).where(eq(transactions.id, req.params.id)).run();
  const updated = db.select().from(transactions).where(eq(transactions.id, req.params.id)).get();
  res.json(updated);
});

// DELETE /transactions/:id — handles transfer unlinking and split cascade
transactionsRouter.delete('/:id', (req, res) => {
  const existing = db.select().from(transactions).where(eq(transactions.id, req.params.id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.reconciled === 1)
    return res.status(403).json({ error: 'Cannot modify a reconciled transaction' });

  if (existing.transferTransactionId) {
    db.update(transactions)
      .set({ transferTransactionId: null })
      .where(eq(transactions.id, existing.transferTransactionId))
      .run();
  }

  if (existing.isParent === 1) {
    db.delete(transactions).where(eq(transactions.parentTransactionId, existing.id)).run();
  }

  db.delete(transactions).where(eq(transactions.id, req.params.id)).run();
  res.status(204).send();
});
