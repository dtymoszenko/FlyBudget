import { Router } from 'express';
import { db } from '../db/index.js';
import { categories, categoryGroups, transactions, budgetMonths } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

export const categoriesRouter = Router();

const groupSchema = z.object({
  name: z.string().trim().min(1).max(200),
  isIncome: z.number().int().min(0).max(1),
});

const categorySchema = z.object({
  groupId: z.string().max(64),
  name: z.string().trim().min(1).max(200),
  icon: z.string().max(32).optional(),
  budgetType: z.enum(['fixed', 'flexible', 'non_monthly']).nullable().optional(),
});

categoriesRouter.get('/', (_req, res) => {
  const groups = db.select().from(categoryGroups).orderBy(categoryGroups.sortOrder).all();
  const cats = db.select().from(categories).orderBy(categories.sortOrder).all();
  const result = groups.map((g) => ({
    ...g,
    categories: cats.filter((c) => c.groupId === g.id),
  }));
  res.json(result);
});

categoriesRouter.post('/groups', (req, res) => {
  const parsed = groupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const countRow = db
    .select({ count: sql<number>`count(*)` })
    .from(categoryGroups)
    .get();
  const group = {
    id: nanoid(),
    ...parsed.data,
    sortOrder: countRow?.count ?? 0,
    createdAt: new Date().toISOString(),
  };
  db.insert(categoryGroups).values(group).run();
  res.status(201).json({ ...group, categories: [] });
});

categoriesRouter.put('/groups/reorder', (req, res) => {
  const parsed = z.object({ ids: z.array(z.string()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  for (let i = 0; i < parsed.data.ids.length; i++) {
    db.update(categoryGroups)
      .set({ sortOrder: i })
      .where(eq(categoryGroups.id, parsed.data.ids[i]))
      .run();
  }
  res.json({ ok: true });
});

categoriesRouter.put('/groups/:id', (req, res) => {
  const parsed = groupSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (Object.keys(parsed.data).length) {
    db.update(categoryGroups).set(parsed.data).where(eq(categoryGroups.id, req.params.id)).run();
  }
  const updated = db
    .select()
    .from(categoryGroups)
    .where(eq(categoryGroups.id, req.params.id))
    .get();
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

categoriesRouter.delete('/groups/:id', (req, res) => {
  db.delete(categoryGroups).where(eq(categoryGroups.id, req.params.id)).run();
  res.status(204).send();
});

categoriesRouter.post('/', (req, res) => {
  const parsed = categorySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const countRow = db
    .select({ count: sql<number>`count(*)` })
    .from(categories)
    .where(eq(categories.groupId, parsed.data.groupId))
    .get();
  const category = {
    id: nanoid(),
    ...parsed.data,
    sortOrder: countRow?.count ?? 0,
    createdAt: new Date().toISOString(),
  };
  db.insert(categories).values(category).run();
  res.status(201).json(category);
});

categoriesRouter.put('/reorder', (req, res) => {
  const parsed = z.object({ ids: z.array(z.string()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  for (let i = 0; i < parsed.data.ids.length; i++) {
    db.update(categories).set({ sortOrder: i }).where(eq(categories.id, parsed.data.ids[i])).run();
  }
  res.json({ ok: true });
});

categoriesRouter.put('/:id', (req, res) => {
  const parsed = categorySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (Object.keys(parsed.data).length) {
    db.update(categories).set(parsed.data).where(eq(categories.id, req.params.id)).run();
  }
  const updated = db.select().from(categories).where(eq(categories.id, req.params.id)).get();
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

categoriesRouter.get('/:id/transaction-count', (req, res) => {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.categoryId, req.params.id))
    .get();
  res.json({ count: row?.count ?? 0 });
});

categoriesRouter.delete('/:id', (req, res) => {
  const reassignTo = typeof req.query.reassignTo === 'string' ? req.query.reassignTo : undefined;

  if (reassignTo === req.params.id) return res.status(400).json({ error: 'Pick another category' });
  if (reassignTo && !db.select().from(categories).where(eq(categories.id, reassignTo)).get()) {
    return res.status(400).json({ error: 'Unknown category' });
  }

  if (reassignTo) {
    db.update(transactions)
      .set({ categoryId: reassignTo })
      .where(eq(transactions.categoryId, req.params.id))
      .run();
    db.delete(budgetMonths).where(eq(budgetMonths.categoryId, req.params.id)).run();
  }

  db.delete(categories).where(eq(categories.id, req.params.id)).run();
  res.status(204).send();
});
