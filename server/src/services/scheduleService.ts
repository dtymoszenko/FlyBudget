import { db } from '../db/index.js';
import { schedules, scheduleOccurrences, transactions, payees } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { format, parseISO, addDays } from 'date-fns';
import {
  computeOccurrenceDates,
  buildRecurrenceRule,
  type RecurrenceType,
  type RecurrenceRule,
  type RecurrenceDefinition,
  type WeekendAdjust,
} from '../utils/recurrence.js';
import { linkOccurrenceToTransaction } from './matchingEngine.js';

export function ensureOccurrences(scheduleId: string, throughDate: string): number {
  const schedule = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
  if (!schedule) return 0;
  if (schedule.status === 'canceled') return 0;

  const rule: RecurrenceRule = JSON.parse(schedule.recurrenceRule);
  const rangeStart = schedule.occurrenceHorizon
    ? format(addDays(parseISO(schedule.occurrenceHorizon), 1), 'yyyy-MM-dd')
    : schedule.startDate;

  if (rangeStart > throughDate) return 0;

  const def: RecurrenceDefinition = {
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    recurrenceType: schedule.recurrenceType as RecurrenceType,
    recurrenceRule: rule,
    weekendAdjust: (schedule.weekendAdjust as WeekendAdjust) || 'none',
  };

  const pairs = computeOccurrenceDates(def, rangeStart, throughDate);
  let created = 0;

  for (const pair of pairs) {
    try {
      db.insert(scheduleOccurrences)
        .values({
          id: nanoid(),
          scheduleId,
          scheduledDate: pair.scheduledDate,
          expectedDate: pair.expectedDate,
          expectedAmount: schedule.amount,
          status: 'pending',
        })
        .run();
      created++;
    } catch (e: any) {
      if (e.message?.includes('UNIQUE constraint failed')) continue;
      throw e;
    }
  }

  db.update(schedules)
    .set({ occurrenceHorizon: throughDate })
    .where(eq(schedules.id, scheduleId))
    .run();

  return created;
}

export function ensureOccurrencesForAll(throughDate: string): number {
  const activeSchedules = db
    .select({ id: schedules.id })
    .from(schedules)
    .where(eq(schedules.status, 'active'))
    .all();

  let total = 0;
  for (const s of activeSchedules) {
    total += ensureOccurrences(s.id, throughDate);
  }
  return total;
}

export function regenerateFutureOccurrences(scheduleId: string): void {
  const schedule = db.select().from(schedules).where(eq(schedules.id, scheduleId)).get();
  if (!schedule) return;

  const today = format(new Date(), 'yyyy-MM-dd');
  const previousHorizon = schedule.occurrenceHorizon || today;

  const futureOccs = db
    .select()
    .from(scheduleOccurrences)
    .where(
      and(
        eq(scheduleOccurrences.scheduleId, scheduleId),
        eq(scheduleOccurrences.status, 'pending'),
      ),
    )
    .all()
    .filter((o) => o.scheduledDate > today);

  for (const occ of futureOccs) {
    db.delete(scheduleOccurrences).where(eq(scheduleOccurrences.id, occ.id)).run();
  }

  db.update(schedules).set({ occurrenceHorizon: today }).where(eq(schedules.id, scheduleId)).run();

  ensureOccurrences(scheduleId, previousHorizon);
}

export function autoCreateDueScheduled(): number {
  const today = format(new Date(), 'yyyy-MM-dd');
  const activeSchedules = db
    .select()
    .from(schedules)
    .where(and(eq(schedules.status, 'active'), eq(schedules.autoCreate, 1)))
    .all();

  let created = 0;

  for (const schedule of activeSchedules) {
    if (!schedule.accountId) continue;

    const pendingOccs = db
      .select()
      .from(scheduleOccurrences)
      .where(
        and(
          eq(scheduleOccurrences.scheduleId, schedule.id),
          eq(scheduleOccurrences.status, 'pending'),
        ),
      )
      .all()
      .filter((o) => {
        if (o.expectedDate > today) return false;
        if (schedule.autoCreateFrom && o.expectedDate < schedule.autoCreateFrom) return false;
        return true;
      });

    for (const occ of pendingOccs) {
      let payeeName = schedule.name;
      if (schedule.payeeId) {
        const p = db.select().from(payees).where(eq(payees.id, schedule.payeeId)).get();
        if (p) payeeName = p.name;
      }

      const txId = nanoid();
      const importedId = `schedule:${schedule.id}:${occ.id}`;

      db.insert(transactions)
        .values({
          id: txId,
          accountId: schedule.accountId,
          date: occ.expectedDate,
          amount: occ.expectedAmount,
          payeeId: schedule.payeeId,
          payeeName,
          categoryId: schedule.categoryId,
          notes: schedule.notes,
          reconciled: 0,
          transferTransactionId: null,
          isParent: 0,
          parentTransactionId: null,
          importedId,
          scheduleId: schedule.id,
          createdAt: new Date().toISOString(),
        })
        .run();

      linkOccurrenceToTransaction(occ.id, txId, 'automatic', 100);
      created++;
    }
  }

  return created;
}

export function migrateRecurrenceRules(): number {
  const toMigrate = db.select().from(schedules).where(eq(schedules.recurrenceRule, '{}')).all();

  if (toMigrate.length === 0) return 0;

  let migrated = 0;
  for (const s of toMigrate) {
    const rule = buildRecurrenceRule(s.recurrenceType as RecurrenceType, s.startDate);
    db.update(schedules)
      .set({ recurrenceRule: JSON.stringify(rule) })
      .where(eq(schedules.id, s.id))
      .run();
    migrated++;
  }

  return migrated;
}

export function migrateOccurrencesFromLegacy(): number {
  const toMigrate = db.select().from(schedules).where(isNull(schedules.occurrenceHorizon)).all();

  if (toMigrate.length === 0) return 0;

  const horizon = format(addDays(new Date(), 90), 'yyyy-MM-dd');
  let totalCreated = 0;

  for (const schedule of toMigrate) {
    const rule: RecurrenceRule = JSON.parse(schedule.recurrenceRule);
    const def: RecurrenceDefinition = {
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      recurrenceType: schedule.recurrenceType as RecurrenceType,
      recurrenceRule: rule,
      weekendAdjust: (schedule.weekendAdjust as WeekendAdjust) || 'none',
    };

    const pairs = computeOccurrenceDates(def, schedule.startDate, horizon);

    const linkedTxns = db
      .select()
      .from(transactions)
      .where(eq(transactions.scheduleId, schedule.id))
      .all()
      .sort((a, b) => a.date.localeCompare(b.date));

    const usedTxnIds = new Set<string>();
    const flexibility = schedule.dateFlexibility || 3;

    for (const pair of pairs) {
      let bestTx: (typeof linkedTxns)[0] | null = null;
      let bestDist = Infinity;

      for (const tx of linkedTxns) {
        if (usedTxnIds.has(tx.id)) continue;
        const occDate = parseISO(pair.scheduledDate);
        const txDate = parseISO(tx.date);
        const dist = Math.abs(occDate.getTime() - txDate.getTime()) / (24 * 60 * 60 * 1000);
        if (dist <= flexibility && dist < bestDist) {
          bestDist = dist;
          bestTx = tx;
        }
      }

      const occId = nanoid();
      if (bestTx) {
        usedTxnIds.add(bestTx.id);
        db.insert(scheduleOccurrences)
          .values({
            id: occId,
            scheduleId: schedule.id,
            scheduledDate: pair.scheduledDate,
            expectedDate: pair.expectedDate,
            expectedAmount: schedule.amount,
            status: 'paid',
            matchedTransactionId: bestTx.id,
            matchType: 'automatic',
            matchConfidence: 100,
            paidAt: bestTx.date,
          })
          .run();
      } else {
        db.insert(scheduleOccurrences)
          .values({
            id: occId,
            scheduleId: schedule.id,
            scheduledDate: pair.scheduledDate,
            expectedDate: pair.expectedDate,
            expectedAmount: schedule.amount,
            status: 'pending',
          })
          .run();
      }
      totalCreated++;
    }

    db.update(schedules)
      .set({ occurrenceHorizon: horizon })
      .where(eq(schedules.id, schedule.id))
      .run();
  }

  return totalCreated;
}
