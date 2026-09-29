import { Router } from 'express';
import { db } from '../db/index.js';
import { transactions, payees, accounts, categories } from '../db/schema.js';
import { eq, and, like, gte, lte, sql, isNull, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { deleteTransactionRow, resolvePayee } from '../services/transactionHelpers.js';
import { buildRuleContext, insertNewTransaction, loadRules } from '../services/ruleService.js';
import { isoDate } from '../utils/validation.js';

export const transactionsRouter = Router();

const id = z.string().min(1).max(64);
// Amounts are integer cents; the cap keeps sums far inside Number.MAX_SAFE_INTEGER
const cents = z.number().int().min(-1e13).max(1e13);

// A transaction saved on a device while offline carries its own random id. Sending it again
// (the connection dropped before the answer arrived, or two tabs sent it) returns the saved one
// instead of creating a duplicate.
const clientId = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

const createSchema = z.object({
  id: clientId.optional(),
  accountId: id,
  date: isoDate,
  amount: cents,
  payeeId: id.nullable().optional(),
  payeeName: z.string().max(500).nullable().optional(),
  categoryId: id.nullable().optional(),
  notes: z.string().max(5_000).nullable().optional(),
  /** A balance correction (reconciliation, "Update value"), left out of income and spending */
  adjustment: z.boolean().optional(),
  splits: z
    .array(
      z.object({
        categoryId: id.nullable(),
        amount: cents,
        notes: z.string().max(5_000).nullable().optional(),
      }),
    )
    .max(100)
    .optional(),
});

const updateSchema = createSchema.omit({ id: true, splits: true, adjustment: true }).partial();

const transferSchema = z
  .object({
    id: clientId.optional(),
    fromAccountId: id,
    toAccountId: id,
    date: isoDate,
    amount: cents.positive(),
    notes: z.string().max(5_000).nullable().optional(),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, 'Choose two different accounts');

// Imported files are untrusted: validate dates and cap sizes
const importRowSchema = z.object({
  date: isoDate,
  amount: cents,
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

  const page = z
    .object({
      limit: z.coerce.number().int().min(1).max(1000).default(200),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .safeParse({ limit: req.query.limit, offset: req.query.offset });
  if (!page.success) return res.status(400).json({ error: page.error.flatten() });
  const { limit, offset } = page.data;

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

/** A transaction created earlier with this id, shaped like the create response (null if none) */
function alreadyCreated(txId: string) {
  const row = db.select().from(transactions).where(eq(transactions.id, txId)).get();
  if (!row) return null;
  if (row.transferTransactionId) {
    const other = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, row.transferTransactionId))
      .get();
    return other ? [row, other] : [row];
  }
  const children = db
    .select()
    .from(transactions)
    .where(eq(transactions.parentTransactionId, txId))
    .all();
  return children.length ? { ...row, children } : row;
}

// POST /transactions — supports optional splits array
transactionsRouter.post('/', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { id: txId, payeeName, payeeId, splits, adjustment, ...rest } = parsed.data;
  const existing = txId && alreadyCreated(txId);
  if (existing) return res.status(200).json(existing);

  if (splits && splits.length > 0) {
    const payee = resolvePayee(payeeName, payeeId);
    const finalPayeeId = payee.payeeId;
    const splitSum = splits.reduce((sum, s) => sum + s.amount, 0);
    if (splitSum !== rest.amount) {
      return res.status(400).json({ error: 'Split amounts must equal transaction total' });
    }

    const parentId = txId ?? nanoid();
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
    db.transaction((tx) => {
      tx.insert(transactions).values(parent).run();
      for (const child of childRows) tx.insert(transactions).values(child).run();
    });

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
      id: txId,
      isAdjustment: adjustment,
    },
    { keepUserCategory: true, keepUserNotes: true },
  );
  res.status(201).json(children.length ? { ...transaction, children } : transaction);
});

// POST /transactions/transfer — creates linked pair in two accounts
transactionsRouter.post('/transfer', (req, res) => {
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { id: txId, fromAccountId, toAccountId, date, amount, notes } = parsed.data;
  const existing = txId && alreadyCreated(txId);
  if (existing) return res.status(200).json(existing);
  const fromAcct = db.select().from(accounts).where(eq(accounts.id, fromAccountId)).get();
  const toAcct = db.select().from(accounts).where(eq(accounts.id, toAccountId)).get();
  if (!fromAcct || !toAcct) return res.status(404).json({ error: 'Account not found' });

  const fromId = txId ?? nanoid();
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

  db.transaction((tx) => {
    tx.insert(transactions).values(fromTx).run();
    tx.insert(transactions).values(toTx).run();
  });
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
  if (!db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get()) {
    return res.status(404).json({ error: 'Account not found' });
  }
  let imported = 0;
  const ruleOpts = { rules: loadRules(), ctx: buildRuleContext() };

  // One transaction: all rows or none, and far faster than a commit per row
  db.transaction(() => {
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
  });

  res.json({ imported, skipped: rows.length - imported });
});

// PUT /transactions/:id
// A split's parts and a transfer's other side are separate rows: keep them in step with
// the row being edited, so budgets and both accounts agree on dates and amounts.
transactionsRouter.put('/:id', (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = db.select().from(transactions).where(eq(transactions.id, req.params.id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.reconciled === 1)
    return res.status(403).json({ error: 'Cannot modify a reconciled transaction' });

  const data = parsed.data;
  const changes = (key: keyof typeof data) =>
    data[key] !== undefined && data[key] !== existing[key];
  if (
    existing.parentTransactionId &&
    (changes('accountId') || changes('date') || changes('amount'))
  ) {
    return res
      .status(400)
      .json({ error: "Change the split transaction's account, date or amount instead of a part" });
  }
  if (existing.isParent === 1 && (changes('amount') || data.categoryId)) {
    return res.status(400).json({ error: 'Edit the parts of a split transaction instead' });
  }
  if (existing.transferTransactionId && (changes('accountId') || data.categoryId)) {
    return res.status(400).json({ error: 'Transfers have no category and stay in their accounts' });
  }

  db.transaction((tx) => {
    if (Object.keys(data).length) {
      tx.update(transactions).set(data).where(eq(transactions.id, existing.id)).run();
    }
    if (existing.isParent === 1) {
      const shared = {
        accountId: data.accountId,
        date: data.date,
        payeeId: data.payeeId,
        payeeName: data.payeeName,
      };
      if (Object.values(shared).some((v) => v !== undefined)) {
        tx.update(transactions)
          .set(shared)
          .where(eq(transactions.parentTransactionId, existing.id))
          .run();
      }
    }
    if (existing.transferTransactionId && (data.date !== undefined || data.amount !== undefined)) {
      tx.update(transactions)
        .set({ date: data.date, amount: data.amount === undefined ? undefined : -data.amount })
        .where(eq(transactions.id, existing.transferTransactionId))
        .run();
    }
  });
  const updated = db.select().from(transactions).where(eq(transactions.id, req.params.id)).get();
  res.json(updated);
});

// DELETE /transactions/:id — handles transfer unlinking and split cascade
transactionsRouter.delete('/:id', (req, res) => {
  const existing = db.select().from(transactions).where(eq(transactions.id, req.params.id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.reconciled === 1)
    return res.status(403).json({ error: 'Cannot modify a reconciled transaction' });

  deleteTransactionRow(existing);
  res.status(204).send();
});
