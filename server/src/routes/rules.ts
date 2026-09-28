import { Router } from 'express';
import { db } from '../db/index.js';
import { rules } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { previewRules, runRules, testConditions } from '../services/rulesEngine.js';

export const rulesRouter = Router();

const conditionSchema = z
  .object({
    field: z.enum(['payee_name', 'amount', 'notes']),
    op: z.enum(['contains', 'starts_with', 'ends_with', 'exact', 'regex']),
    // Regexes run against every transaction; keep them short to limit catastrophic backtracking
    value: z.string().max(500),
  })
  .refine((c) => c.op !== 'regex' || (c.value.length <= 200 && isValidRegex(c.value)), {
    message: 'Invalid regular expression (max 200 characters)',
    path: ['value'],
  });

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

const actionSchema = z.object({
  field: z.enum(['category_id', 'payee_id', 'notes']),
  value: z.string().max(5_000),
});

const ruleSchema = z.object({
  conditions: z.array(conditionSchema).max(50),
  actions: z.array(actionSchema).max(50),
  sortOrder: z.number().int().default(0),
});

function parseRule(r: typeof rules.$inferSelect) {
  return { ...r, conditions: JSON.parse(r.conditions), actions: JSON.parse(r.actions) };
}

function loadAllRules() {
  return db.select().from(rules).orderBy(rules.sortOrder).all().map(parseRule);
}

rulesRouter.get('/', (_req, res) => {
  res.json(loadAllRules());
});

// Preview what running rules would change (dry-run, no writes).
rulesRouter.get('/preview', (_req, res) => {
  res.json(previewRules(loadAllRules()));
});

// Apply rules to all uncategorized transactions.
rulesRouter.post('/run', (_req, res) => {
  const count = runRules(loadAllRules());
  res.json({ updated: count });
});

// Test a set of conditions against all transactions (for AddRuleModal preview).
rulesRouter.post('/test', (req, res) => {
  const parsed = z.object({ conditions: z.array(conditionSchema) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(testConditions(parsed.data.conditions));
});

// Reorder rules — body: { ids: string[] } in desired order.
rulesRouter.put('/reorder', (req, res) => {
  const parsed = z.object({ ids: z.array(z.string()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  for (let i = 0; i < parsed.data.ids.length; i++) {
    db.update(rules).set({ sortOrder: i }).where(eq(rules.id, parsed.data.ids[i])).run();
  }
  res.json({ ok: true });
});

rulesRouter.post('/', (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const rule = {
    id: nanoid(),
    conditions: JSON.stringify(parsed.data.conditions),
    actions: JSON.stringify(parsed.data.actions),
    sortOrder: parsed.data.sortOrder,
    createdAt: new Date().toISOString(),
  };
  db.insert(rules).values(rule).run();
  res.status(201).json(parseRule(rule));
});

rulesRouter.put('/:id', (req, res) => {
  const parsed = ruleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const update: Record<string, unknown> = {};
  if (parsed.data.conditions) update.conditions = JSON.stringify(parsed.data.conditions);
  if (parsed.data.actions) update.actions = JSON.stringify(parsed.data.actions);
  if (parsed.data.sortOrder !== undefined) update.sortOrder = parsed.data.sortOrder;

  db.update(rules).set(update).where(eq(rules.id, req.params.id)).run();
  const updated = db.select().from(rules).where(eq(rules.id, req.params.id)).get();
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(parseRule(updated));
});

rulesRouter.delete('/:id', (req, res) => {
  db.delete(rules).where(eq(rules.id, req.params.id)).run();
  res.status(204).send();
});
