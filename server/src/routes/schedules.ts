import { Router } from 'express';
import { db } from '../db/index.js';
import { schedules, scheduleOccurrences, transactions, payees } from '../db/schema.js';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { format, addDays } from 'date-fns';
import { buildRecurrenceRule, type RecurrenceType } from '../utils/recurrence.js';
import { isMonth, isoDate, isRealDate } from '../utils/validation.js';
import { findSchedules, createDiscoveredSchedules } from '../services/scheduleDiscovery.js';
import {
  ensureOccurrences,
  regenerateFutureOccurrences,
  autoCreateDueScheduled,
} from '../services/scheduleService.js';
import {
  linkOccurrenceToTransaction,
  unlinkOccurrence,
  unlinkOccurrenceByTransactionId,
  dismissMatchSuggestion,
  getMatchSuggestions,
} from '../services/matchingEngine.js';

export const schedulesRouter = Router();

const recurrenceTypeEnum = z.enum([
  'once',
  'weekly',
  'biweekly',
  'semimonthly',
  'monthly',
  'quarterly',
  'semiannually',
  'yearly',
]);
const amountTypeEnum = z.enum(['exact', 'approximate', 'variable']);
const statusEnum = z.enum(['active', 'paused', 'canceled']);
const weekendAdjustEnum = z.enum(['none', 'before', 'after', 'closest']);
const id = z.string().min(1).max(64);
const weekday = z.number().int().min(0).max(6);
const monthDay = z.number().int().min(1).max(31);

// Stored and used to generate occurrences, so it must be well-formed: a zero or missing
// interval would make occurrence generation loop forever
const recurrenceRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('once') }),
  z.object({
    type: z.literal('weekly'),
    interval: z.number().int().min(1).max(52),
    anchorDay: weekday,
  }),
  z.object({ type: z.literal('biweekly'), anchorDay: weekday }),
  z.object({ type: z.literal('semimonthly'), day1: monthDay, day2: monthDay }),
  z.object({
    type: z.literal('monthly'),
    interval: z.number().int().min(1).max(120),
    anchorDay: monthDay,
  }),
  z.object({ type: z.literal('quarterly'), anchorDay: monthDay }),
  z.object({ type: z.literal('semiannually'), anchorDay: monthDay }),
  z.object({
    type: z.literal('yearly'),
    anchorMonth: z.number().int().min(0).max(11),
    anchorDay: monthDay,
  }),
]);

const scheduleFields = {
  name: z.string().trim().min(1).max(200),
  amount: z.number().int().min(-1e13).max(1e13),
  amountType: amountTypeEnum,
  recurrenceType: recurrenceTypeEnum,
  recurrenceRule: recurrenceRuleSchema.optional(),
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
  weekendAdjust: weekendAdjustEnum,
  dateFlexibility: z.number().int().min(0).max(14),
  accountId: id.nullable().optional(),
  transferAccountId: id.nullable().optional(),
  categoryId: id.nullable().optional(),
  payeeId: id.nullable().optional(),
  notes: z.string().max(5_000).nullable().optional(),
  status: statusEnum,
  autoCreate: z.number().int().min(0).max(1),
};

const ruleMatchesType = (s: { recurrenceType?: string; recurrenceRule?: { type: string } }) =>
  !s.recurrenceRule || !s.recurrenceType || s.recurrenceRule.type === s.recurrenceType;
const ruleTypeMessage = { message: 'recurrenceRule.type must match recurrenceType' };

const createSchema = z
  .object({
    ...scheduleFields,
    amountType: amountTypeEnum.default('exact'),
    weekendAdjust: weekendAdjustEnum.default('none'),
    dateFlexibility: scheduleFields.dateFlexibility.default(3),
    status: statusEnum.default('active'),
    autoCreate: scheduleFields.autoCreate.default(0),
  })
  .refine(ruleMatchesType, ruleTypeMessage);

// Without defaults: Zod applies `.default()` inside `.partial()`, so pausing a schedule
// (`{ status }`) would otherwise reset its amount type, weekend rule and auto-create
const updateSchema = z.object(scheduleFields).partial().refine(ruleMatchesType, ruleTypeMessage);

function deriveDisplayStatus(dbStatus: string, expectedDate: string): string {
  if (dbStatus !== 'pending') return dbStatus;
  const today = format(new Date(), 'yyyy-MM-dd');
  if (expectedDate > today) return 'upcoming';
  if (expectedDate === today) return 'due';
  return 'waiting';
}

// --- Static routes FIRST (before /:id) ---

// GET /discover — find likely recurring transactions not yet covered by a schedule
schedulesRouter.get('/discover', (_req, res) => {
  res.json(findSchedules());
});

const discoveredItemSchema = z
  .object({
    id: z.string().max(200),
    accountId: id,
    accountName: z.string().max(200),
    payeeId: id.nullable(),
    payeeName: z.string().min(1).max(500),
    amount: z.number().int().min(-1e13).max(1e13),
    amountType: z.enum(['exact', 'approximate']),
    recurrenceType: z.enum(['weekly', 'biweekly', 'monthly']),
    recurrenceRule: recurrenceRuleSchema,
    startDate: isoDate,
    exactDate: z.boolean(),
    categoryId: id.nullable(),
    transactionIds: z.array(id).max(10_000),
  })
  .refine(ruleMatchesType, ruleTypeMessage);

// POST /discover/create — create schedules from discovered items and link their transactions
schedulesRouter.post('/discover/create', (req, res) => {
  const parsed = z
    .object({ items: z.array(discoveredItemSchema).min(1).max(1_000) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const ids = createDiscoveredSchedules(parsed.data.items);
  res.status(201).json({ created: ids.length, ids });
});

// GET /occurrences — all occurrences in a date range
schedulesRouter.get('/occurrences', (req, res) => {
  const { from, to } = req.query;
  if (typeof from !== 'string' || typeof to !== 'string' || !isRealDate(from) || !isRealDate(to)) {
    return res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
  }

  const rows = db
    .select({
      occ: scheduleOccurrences,
      schedule: schedules,
    })
    .from(scheduleOccurrences)
    .innerJoin(schedules, eq(scheduleOccurrences.scheduleId, schedules.id))
    .where(
      and(gte(scheduleOccurrences.expectedDate, from), lte(scheduleOccurrences.expectedDate, to)),
    )
    .all();

  const matchedTxIds = rows
    .filter((r) => r.occ.matchedTransactionId)
    .map((r) => r.occ.matchedTransactionId!);

  const matchedTxMap = new Map<string, { amount: number; date: string }>();
  if (matchedTxIds.length > 0) {
    for (const txId of matchedTxIds) {
      const tx = db
        .select({ amount: transactions.amount, date: transactions.date })
        .from(transactions)
        .where(eq(transactions.id, txId))
        .get();
      if (tx) matchedTxMap.set(txId, tx);
    }
  }

  const result = rows.map(({ occ, schedule }) => {
    const matchedTx = occ.matchedTransactionId ? matchedTxMap.get(occ.matchedTransactionId) : null;
    return {
      ...occ,
      displayStatus: deriveDisplayStatus(occ.status, occ.expectedDate),
      scheduleName: schedule.name,
      recurrenceType: schedule.recurrenceType,
      amountType: schedule.amountType,
      scheduleAccountId: schedule.accountId,
      scheduleCategoryId: schedule.categoryId,
      schedulePayeeId: schedule.payeeId,
      matchedAmount: matchedTx?.amount ?? null,
      matchedDate: matchedTx?.date ?? null,
    };
  });

  result.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  res.json(result);
});

// GET /summary — income/expense totals for a month
schedulesRouter.get('/summary', (req, res) => {
  const { month } = req.query;
  if (!isMonth(month))
    return res.status(400).json({ error: 'month query param required (YYYY-MM)' });

  const from = `${month}-01`;
  const to = `${month}-31`;

  const rows = db
    .select({
      expectedAmount: scheduleOccurrences.expectedAmount,
    })
    .from(scheduleOccurrences)
    .innerJoin(schedules, eq(scheduleOccurrences.scheduleId, schedules.id))
    .where(
      and(
        eq(schedules.status, 'active'),
        gte(scheduleOccurrences.expectedDate, from),
        lte(scheduleOccurrences.expectedDate, to),
      ),
    )
    .all();

  let income = 0;
  let expenses = 0;
  for (const row of rows) {
    if (row.expectedAmount > 0) income += row.expectedAmount;
    else expenses += row.expectedAmount;
  }

  res.json({ income, expenses });
});

// GET /match-suggestions — pending ambiguous matches
schedulesRouter.get('/match-suggestions', (_req, res) => {
  res.json(getMatchSuggestions());
});

// POST /auto-create — trigger auto-create
schedulesRouter.post('/auto-create', (_req, res) => {
  const created = autoCreateDueScheduled();
  res.json({ created });
});

// POST /unmatch-transaction — unlink by transaction ID
schedulesRouter.post('/unmatch-transaction', (req, res) => {
  const bodySchema = z.object({ transactionId: z.string() });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  unlinkOccurrenceByTransactionId(parsed.data.transactionId);
  res.json({ ok: true });
});

// --- Parameterized routes ---

// GET / — list schedules
schedulesRouter.get('/', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const conditions = status ? [eq(schedules.status, status)] : [];
  const rows = db
    .select()
    .from(schedules)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(schedules.name)
    .all();
  res.json(rows);
});

// POST / — create schedule
schedulesRouter.post('/', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = parsed.data;
  const rule = data.recurrenceRule
    ? JSON.stringify(data.recurrenceRule)
    : JSON.stringify(buildRecurrenceRule(data.recurrenceType as RecurrenceType, data.startDate));

  const now = new Date().toISOString();
  const today = format(new Date(), 'yyyy-MM-dd');

  const row = {
    id: nanoid(),
    name: data.name,
    amount: data.amount,
    amountType: data.amountType,
    recurrenceType: data.recurrenceType,
    recurrenceRule: rule,
    startDate: data.startDate,
    endDate: data.endDate ?? null,
    weekendAdjust: data.weekendAdjust,
    dateFlexibility: data.dateFlexibility,
    accountId: data.accountId ?? null,
    transferAccountId: data.transferAccountId ?? null,
    categoryId: data.categoryId ?? null,
    payeeId: data.payeeId ?? null,
    notes: data.notes ?? null,
    status: data.status,
    autoCreate: data.autoCreate,
    autoCreateFrom: data.autoCreate ? today : null,
    source: 'manual' as const,
    occurrenceHorizon: null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(schedules).values(row).run();

  const horizon = format(addDays(new Date(), 90), 'yyyy-MM-dd');
  ensureOccurrences(row.id, horizon);

  const created = db.select().from(schedules).where(eq(schedules.id, row.id)).get();
  res.status(201).json(created);
});

// GET /:id — single schedule with recent occurrences
schedulesRouter.get('/:id', (req, res) => {
  const schedule = db.select().from(schedules).where(eq(schedules.id, req.params.id)).get();
  if (!schedule) return res.status(404).json({ error: 'Not found' });

  const recentOccs = db
    .select()
    .from(scheduleOccurrences)
    .where(eq(scheduleOccurrences.scheduleId, schedule.id))
    .orderBy(desc(scheduleOccurrences.scheduledDate))
    .limit(20)
    .all()
    .map((o) => ({ ...o, displayStatus: deriveDisplayStatus(o.status, o.expectedDate) }));

  res.json({ ...schedule, occurrences: recentOccs });
});

// PUT /:id — update schedule
schedulesRouter.put('/:id', (req, res) => {
  const existing = db.select().from(schedules).where(eq(schedules.id, req.params.id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = parsed.data;
  if (
    data.recurrenceRule &&
    data.recurrenceRule.type !== (data.recurrenceType ?? existing.recurrenceType)
  ) {
    return res.status(400).json({ error: ruleTypeMessage.message });
  }
  const updates: Record<string, any> = { ...data, updatedAt: new Date().toISOString() };

  if (data.recurrenceRule) {
    updates.recurrenceRule = JSON.stringify(data.recurrenceRule);
  } else if (data.recurrenceType && data.recurrenceType !== existing.recurrenceType) {
    const startDate = data.startDate || existing.startDate;
    updates.recurrenceRule = JSON.stringify(
      buildRecurrenceRule(data.recurrenceType as RecurrenceType, startDate),
    );
  }

  if (data.autoCreate === 1 && existing.autoCreate === 0) {
    updates.autoCreateFrom = format(new Date(), 'yyyy-MM-dd');
  }

  db.update(schedules).set(updates).where(eq(schedules.id, req.params.id)).run();

  const patternChanged =
    (data.recurrenceType !== undefined && data.recurrenceType !== existing.recurrenceType) ||
    updates.recurrenceRule !== undefined ||
    (data.startDate !== undefined && data.startDate !== existing.startDate) ||
    (data.endDate !== undefined && data.endDate !== existing.endDate) ||
    (data.weekendAdjust !== undefined && data.weekendAdjust !== existing.weekendAdjust);
  if (patternChanged) {
    regenerateFutureOccurrences(req.params.id);
  }

  if (data.amount !== undefined && data.amount !== existing.amount) {
    const today = format(new Date(), 'yyyy-MM-dd');
    const futureOccs = db
      .select()
      .from(scheduleOccurrences)
      .where(
        and(
          eq(scheduleOccurrences.scheduleId, req.params.id),
          eq(scheduleOccurrences.status, 'pending'),
        ),
      )
      .all()
      .filter((o) => o.scheduledDate > today);

    for (const occ of futureOccs) {
      db.update(scheduleOccurrences)
        .set({ expectedAmount: data.amount })
        .where(eq(scheduleOccurrences.id, occ.id))
        .run();
    }
  }

  const updated = db.select().from(schedules).where(eq(schedules.id, req.params.id)).get();
  res.json(updated);
});

// DELETE /:id — soft cancel or hard delete
schedulesRouter.delete('/:id', (req, res) => {
  const existing = db.select().from(schedules).where(eq(schedules.id, req.params.id)).get();
  if (!existing) return res.status(404).json({ error: 'Not found' });

  if (req.query.hard === '1') {
    db.delete(schedules).where(eq(schedules.id, req.params.id)).run();
  } else {
    db.update(schedules)
      .set({ status: 'canceled', updatedAt: new Date().toISOString() })
      .where(eq(schedules.id, req.params.id))
      .run();

    const today = format(new Date(), 'yyyy-MM-dd');
    const futureOccs = db
      .select()
      .from(scheduleOccurrences)
      .where(
        and(
          eq(scheduleOccurrences.scheduleId, req.params.id),
          eq(scheduleOccurrences.status, 'pending'),
        ),
      )
      .all()
      .filter((o) => o.scheduledDate >= today);

    for (const occ of futureOccs) {
      db.update(scheduleOccurrences)
        .set({ status: 'cancelled' })
        .where(eq(scheduleOccurrences.id, occ.id))
        .run();
    }
  }

  res.status(204).end();
});

// POST /:id/mark-paid — create a real transaction for an occurrence
schedulesRouter.post('/:id/mark-paid', (req, res) => {
  const schedule = db.select().from(schedules).where(eq(schedules.id, req.params.id)).get();
  if (!schedule) return res.status(404).json({ error: 'Not found' });
  if (!schedule.accountId)
    return res.status(400).json({ error: 'Schedule has no account assigned' });

  const bodySchema = z.object({
    date: isoDate,
    amount: z.number().int().min(-1e13).max(1e13).optional(),
    occurrenceId: id.optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let occId = parsed.data.occurrenceId;
  if (!occId) {
    const nearestOcc = db
      .select()
      .from(scheduleOccurrences)
      .where(
        and(
          eq(scheduleOccurrences.scheduleId, schedule.id),
          eq(scheduleOccurrences.status, 'pending'),
        ),
      )
      .orderBy(scheduleOccurrences.expectedDate)
      .all()
      .sort((a, b) => {
        const aDiff = Math.abs(
          new Date(a.expectedDate).getTime() - new Date(parsed.data.date).getTime(),
        );
        const bDiff = Math.abs(
          new Date(b.expectedDate).getTime() - new Date(parsed.data.date).getTime(),
        );
        return aDiff - bDiff;
      })[0];

    if (!nearestOcc) return res.status(400).json({ error: 'No pending occurrence found' });
    occId = nearestOcc.id;
  }

  let payeeName = schedule.name;
  if (schedule.payeeId) {
    const p = db.select().from(payees).where(eq(payees.id, schedule.payeeId)).get();
    if (p) payeeName = p.name;
  }

  const txId = nanoid();
  const tx = {
    id: txId,
    accountId: schedule.accountId,
    date: parsed.data.date,
    amount: parsed.data.amount ?? schedule.amount,
    payeeId: schedule.payeeId,
    payeeName,
    categoryId: schedule.categoryId,
    notes: schedule.notes,
    reconciled: 0,
    transferTransactionId: null,
    isParent: 0,
    parentTransactionId: null,
    importedId: null,
    scheduleId: schedule.id,
    createdAt: new Date().toISOString(),
  };

  db.insert(transactions).values(tx).run();
  linkOccurrenceToTransaction(occId, txId, 'manual', 100);

  res.status(201).json(tx);
});

// POST /occurrences/:occId/skip
schedulesRouter.post('/occurrences/:occId/skip', (req, res) => {
  const occ = db
    .select()
    .from(scheduleOccurrences)
    .where(eq(scheduleOccurrences.id, req.params.occId))
    .get();
  if (!occ) return res.status(404).json({ error: 'Occurrence not found' });

  db.update(scheduleOccurrences)
    .set({ status: 'skipped', skippedAt: format(new Date(), 'yyyy-MM-dd') })
    .where(eq(scheduleOccurrences.id, req.params.occId))
    .run();

  res.json({ ok: true });
});

// POST /occurrences/:occId/match — manually link to a transaction
schedulesRouter.post('/occurrences/:occId/match', (req, res) => {
  const bodySchema = z.object({ transactionId: z.string() });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const occ = db
    .select()
    .from(scheduleOccurrences)
    .where(eq(scheduleOccurrences.id, req.params.occId))
    .get();
  if (!occ) return res.status(404).json({ error: 'Occurrence not found' });

  linkOccurrenceToTransaction(req.params.occId, parsed.data.transactionId, 'manual', 100);
  res.json({ ok: true });
});

// POST /occurrences/:occId/unmatch — unlink from transaction
schedulesRouter.post('/occurrences/:occId/unmatch', (_req, res) => {
  const occ = db
    .select()
    .from(scheduleOccurrences)
    .where(eq(scheduleOccurrences.id, _req.params.occId))
    .get();
  if (!occ) return res.status(404).json({ error: 'Occurrence not found' });

  unlinkOccurrence(_req.params.occId);
  res.json({ ok: true });
});

// POST /occurrences/:occId/dismiss — dismiss a match suggestion
schedulesRouter.post('/occurrences/:occId/dismiss', (req, res) => {
  const bodySchema = z.object({ transactionId: z.string() });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  dismissMatchSuggestion(req.params.occId, parsed.data.transactionId);
  res.json({ ok: true });
});

// GET /:id/occurrences — occurrences for one schedule
schedulesRouter.get('/:id/occurrences', (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;

  let conditions = [eq(scheduleOccurrences.scheduleId, req.params.id)];
  if (from) conditions.push(gte(scheduleOccurrences.expectedDate, from));
  if (to) conditions.push(lte(scheduleOccurrences.expectedDate, to));

  const rows = db
    .select()
    .from(scheduleOccurrences)
    .where(and(...conditions))
    .orderBy(scheduleOccurrences.scheduledDate)
    .all()
    .map((o) => ({ ...o, displayStatus: deriveDisplayStatus(o.status, o.expectedDate) }));

  res.json(rows);
});
