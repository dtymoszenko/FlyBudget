import { Router } from 'express';
import { db } from '../db/index.js';
import { payees, transactions } from '../db/schema.js';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { logoSchema } from '../utils/logo.js';

export const payeesRouter = Router();

const createSchema = z.object({
  name: z.string().min(1),
  defaultCategoryId: z.string().nullable().optional(),
});

const updateSchema = createSchema.partial().extend({ logo: logoSchema.optional() });

const mergeSchema = z.object({
  keepId: z.string(),
  mergeIds: z.array(z.string()).min(1),
});

payeesRouter.get('/', (_req, res) => {
  const rows = db.select().from(payees).all();

  const counts = db
    .select({
      payeeId: transactions.payeeId,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .groupBy(transactions.payeeId)
    .all();

  const countMap = new Map(counts.map((c) => [c.payeeId, c.count]));
  res.json(rows.map((p) => ({ ...p, transactionCount: countMap.get(p.id) ?? 0 })));
});

payeesRouter.post('/', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const payee = {
    id: nanoid(),
    ...parsed.data,
    defaultCategoryId: parsed.data.defaultCategoryId ?? null,
    logo: null,
    createdAt: new Date().toISOString(),
  };
  db.insert(payees).values(payee).run();
  res.status(201).json({ ...payee, transactionCount: 0 });
});

payeesRouter.post('/merge', (req, res) => {
  const parsed = mergeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { keepId, mergeIds } = parsed.data;

  const keeper = db.select().from(payees).where(eq(payees.id, keepId)).get();
  if (!keeper) return res.status(404).json({ error: 'Keeper payee not found' });

  // Re-point all transactions from merged payees to the keeper
  db.update(transactions)
    .set({ payeeId: keepId, payeeName: keeper.name })
    .where(inArray(transactions.payeeId, mergeIds))
    .run();

  // Keep a logo from one of the merged payees if the keeper has none
  if (!keeper.logo) {
    const withLogo = db
      .select({ logo: payees.logo })
      .from(payees)
      .where(and(inArray(payees.id, mergeIds), isNotNull(payees.logo)))
      .get();
    if (withLogo) db.update(payees).set({ logo: withLogo.logo }).where(eq(payees.id, keepId)).run();
  }

  // Delete the merged payees
  db.delete(payees).where(inArray(payees.id, mergeIds)).run();

  res.json({ merged: mergeIds.length });
});

payeesRouter.put('/:id', (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  db.update(payees).set(parsed.data).where(eq(payees.id, req.params.id)).run();
  const updated = db.select().from(payees).where(eq(payees.id, req.params.id)).get();
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

payeesRouter.delete('/:id', (req, res) => {
  db.update(transactions)
    .set({ payeeId: null })
    .where(eq(transactions.payeeId, req.params.id))
    .run();
  db.delete(payees).where(eq(payees.id, req.params.id)).run();
  res.status(204).send();
});
