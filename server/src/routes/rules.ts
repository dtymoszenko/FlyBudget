import { Router } from 'express';
import { db } from '../db/index.js';
import { rules } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { AMOUNT_OPS, DATE_OPS, EMPTY_OPS, ID_FIELDS, ID_OPS, LIST_OPS, TEXT_FIELDS, TEXT_OPS } from '../services/rulesEngine.js';
import { applyRules, loadRules, parseRuleRow, planRules, testConditions } from '../services/ruleService.js';

export const rulesRouter = Router();

// Regexes run against every transaction; keep them short to limit catastrophic backtracking
const regexSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(isValidRegex, 'Invalid regular expression');

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch {
    return false;
  }
}

const id = z.string().min(1).max(64);
const text = z.string().max(500);
const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).min(1).max(200);
const cents = z.number().int().min(0).max(1_000_000_000_00);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const conditionSchema = z.union([
  z.object({ field: z.enum(TEXT_FIELDS), op: z.literal('regex'), value: regexSchema }),
  z.object({ field: z.enum(TEXT_FIELDS), op: z.enum(TEXT_OPS).exclude(['regex']), value: text }),
  z.object({ field: z.enum(TEXT_FIELDS), op: z.enum(LIST_OPS), value: list(text) }),
  z.object({ field: z.enum(ID_FIELDS), op: z.enum(ID_OPS), value: id }),
  z.object({ field: z.enum(ID_FIELDS), op: z.enum(LIST_OPS), value: list(id) }),
  z.object({ field: z.enum([...TEXT_FIELDS, ...ID_FIELDS]), op: z.enum(EMPTY_OPS) }),
  z.object({ field: z.literal('amount'), op: z.enum(AMOUNT_OPS), value: cents }),
  z.object({ field: z.literal('amount'), op: z.literal('between'), value: z.tuple([cents, cents]) }),
  z.object({ field: z.literal('direction'), op: z.literal('is'), value: z.enum(['inflow', 'outflow']) }),
  z.object({ field: z.literal('date'), op: z.enum(DATE_OPS), value: date }),
  z.object({ field: z.literal('date'), op: z.literal('between'), value: z.tuple([date, date]) }),
]);

const splitPartSchema = z
  .object({
    kind: z.enum(['fixed', 'percent', 'remainder']),
    value: z.number().min(0).max(1_000_000_000_00),
    categoryId: id.nullable(),
    notes: z.string().max(5_000).nullable(),
  })
  .refine((p) => p.kind !== 'percent' || p.value <= 100, 'Percent must be 0–100');

const actionSchema = z.union([
  z.object({ type: z.enum(['set_category', 'set_payee']), value: id }),
  z.object({ type: z.enum(['set_notes', 'prepend_notes', 'append_notes']), value: z.string().max(5_000) }),
  z.object({ type: z.literal('split'), parts: z.array(splitPartSchema).min(1).max(20) }),
]);

const conditionsOp = z.enum(['and', 'or']);
const conditions = z.array(conditionSchema).max(50);

const ruleSchema = z.object({
  conditionsOp: conditionsOp.default('and'),
  conditions,
  actions: z.array(actionSchema).min(1).max(50),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const planSchema = z.object({
  ruleIds: z.array(id).max(1_000).optional(),
  scope: z.enum(['uncategorized', 'all']),
});

function serialize(data: Partial<z.infer<typeof ruleSchema>>) {
  const row: Partial<typeof rules.$inferInsert> = {};
  if (data.conditionsOp !== undefined) row.conditionsOp = data.conditionsOp;
  if (data.conditions !== undefined) row.conditions = JSON.stringify(data.conditions);
  if (data.actions !== undefined) row.actions = JSON.stringify(data.actions);
  if (data.enabled !== undefined) row.enabled = data.enabled ? 1 : 0;
  if (data.sortOrder !== undefined) row.sortOrder = data.sortOrder;
  return row;
}

rulesRouter.get('/', (_req, res) => {
  res.json(loadRules());
});

// Transactions a set of conditions matches (live preview in the rule editor)
rulesRouter.post('/test', (req, res) => {
  const parsed = z.object({ conditionsOp, conditions }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(testConditions(parsed.data.conditionsOp, parsed.data.conditions));
});

// Dry run over existing transactions: every enabled rule, or just `ruleIds`
rulesRouter.post('/preview', (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(planRules(parsed.data));
});

// Apply the preview to the transactions the user kept ticked
rulesRouter.post('/apply', (req, res) => {
  const parsed = planSchema.extend({ transactionIds: z.array(id).max(100_000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json({ updated: applyRules(parsed.data) });
});

// Reorder rules — body: { ids: string[] } in desired order.
rulesRouter.put('/reorder', (req, res) => {
  const parsed = z.object({ ids: z.array(id).max(10_000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  db.transaction(() => {
    parsed.data.ids.forEach((ruleId, i) => {
      db.update(rules).set({ sortOrder: i }).where(eq(rules.id, ruleId)).run();
    });
  });
  res.json({ ok: true });
});

rulesRouter.post('/', (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { conditionsOp, conditions, actions, enabled, sortOrder } = parsed.data;
  const row = {
    id: nanoid(),
    conditionsOp,
    conditions: JSON.stringify(conditions),
    actions: JSON.stringify(actions),
    enabled: enabled ? 1 : 0,
    sortOrder,
    createdAt: new Date().toISOString(),
  };
  db.insert(rules).values(row).run();
  res.status(201).json(parseRuleRow(row));
});

rulesRouter.put('/:id', (req, res) => {
  const parsed = ruleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const update = serialize(parsed.data);
  if (Object.keys(update).length) {
    db.update(rules).set(update).where(eq(rules.id, req.params.id)).run();
  }
  const updated = db.select().from(rules).where(eq(rules.id, req.params.id)).get();
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(parseRuleRow(updated));
});

rulesRouter.delete('/:id', (req, res) => {
  db.delete(rules).where(eq(rules.id, req.params.id)).run();
  res.status(204).send();
});
