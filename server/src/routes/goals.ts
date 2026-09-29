import { Router } from 'express';
import { db } from '../db/index.js';
import { goals } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { isoDate } from '../utils/validation.js';

export const goalsRouter = Router();

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  targetAmount: z.number().int().min(0).max(1e13),
  currentAmount: z.number().int().min(-1e13).max(1e13).optional(),
  targetDate: isoDate.nullable().optional(),
  accountId: z.string().max(64).nullable().optional(),
  icon: z.string().max(32).optional(),
  // Used in inline styles on the client
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

goalsRouter.get('/', (_req, res) => {
  const rows = db.select().from(goals).orderBy(goals.sortOrder).all();
  res.json(rows);
});

goalsRouter.post('/', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const now = new Date().toISOString();
  const row = {
    id: nanoid(),
    name: parsed.data.name,
    targetAmount: parsed.data.targetAmount,
    currentAmount: parsed.data.currentAmount ?? 0,
    targetDate: parsed.data.targetDate ?? null,
    accountId: parsed.data.accountId ?? null,
    icon: parsed.data.icon ?? '🎯',
    color: parsed.data.color ?? '#2563EB',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(goals).values(row).run();
  res.status(201).json(row);
});

goalsRouter.put('/:id', (req, res) => {
  const parsed = createSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.targetAmount !== undefined) update.targetAmount = parsed.data.targetAmount;
  if (parsed.data.currentAmount !== undefined) update.currentAmount = parsed.data.currentAmount;
  if (parsed.data.targetDate !== undefined) update.targetDate = parsed.data.targetDate;
  if (parsed.data.accountId !== undefined) update.accountId = parsed.data.accountId;
  if (parsed.data.icon !== undefined) update.icon = parsed.data.icon;
  if (parsed.data.color !== undefined) update.color = parsed.data.color;

  db.update(goals).set(update).where(eq(goals.id, req.params.id)).run();
  const updated = db.select().from(goals).where(eq(goals.id, req.params.id)).get();
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

goalsRouter.delete('/:id', (req, res) => {
  db.delete(goals).where(eq(goals.id, req.params.id)).run();
  res.status(204).send();
});
