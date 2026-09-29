import { db } from '../db/index.js';
import {
  schedules,
  scheduleOccurrences,
  scheduleMatchDismissals,
  transactions,
} from '../db/schema.js';
import { eq, and, gte, lte, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { format, parseISO, addDays, subDays } from 'date-fns';

export function linkOccurrenceToTransaction(
  occurrenceId: string,
  transactionId: string,
  matchType: 'automatic' | 'manual',
  confidence: number,
): void {
  const occ = db
    .select()
    .from(scheduleOccurrences)
    .where(eq(scheduleOccurrences.id, occurrenceId))
    .get();
  if (!occ) return;

  const now = format(new Date(), 'yyyy-MM-dd');

  db.update(scheduleOccurrences)
    .set({
      status: 'paid',
      matchedTransactionId: transactionId,
      matchType,
      matchConfidence: confidence,
      paidAt: now,
    })
    .where(eq(scheduleOccurrences.id, occurrenceId))
    .run();

  db.update(transactions)
    .set({ scheduleId: occ.scheduleId })
    .where(eq(transactions.id, transactionId))
    .run();
}

export function unlinkOccurrence(occurrenceId: string): void {
  const occ = db
    .select()
    .from(scheduleOccurrences)
    .where(eq(scheduleOccurrences.id, occurrenceId))
    .get();
  if (!occ) return;

  if (occ.matchedTransactionId) {
    db.update(transactions)
      .set({ scheduleId: null })
      .where(eq(transactions.id, occ.matchedTransactionId))
      .run();
  }

  db.update(scheduleOccurrences)
    .set({
      status: 'pending',
      matchedTransactionId: null,
      matchType: null,
      matchConfidence: null,
      paidAt: null,
    })
    .where(eq(scheduleOccurrences.id, occurrenceId))
    .run();
}

export function unlinkOccurrenceByTransactionId(transactionId: string): void {
  const occ = db
    .select()
    .from(scheduleOccurrences)
    .where(eq(scheduleOccurrences.matchedTransactionId, transactionId))
    .get();

  if (!occ) return;

  db.update(scheduleOccurrences)
    .set({
      status: 'pending',
      matchedTransactionId: null,
      matchType: null,
      matchConfidence: null,
      paidAt: null,
    })
    .where(eq(scheduleOccurrences.id, occ.id))
    .run();
}

function scoreMatch(
  tx: {
    date: string;
    amount: number;
    payeeId: string | null;
    payeeName: string | null;
    accountId: string;
  },
  occ: { expectedDate: string; expectedAmount: number },
  schedule: {
    amount: number;
    amountType: string;
    dateFlexibility: number;
    payeeId: string | null;
    accountId: string | null;
    name: string;
  },
): { score: number; payeeScore: number } {
  const txDate = parseISO(tx.date);
  const occDate = parseISO(occ.expectedDate);
  const daysDiff = Math.abs(txDate.getTime() - occDate.getTime()) / (24 * 60 * 60 * 1000);

  if (daysDiff > schedule.dateFlexibility) return { score: 0, payeeScore: 0 };

  let dateScore = Math.max(0, 30 - daysDiff * 5);

  let amountScore = 0;
  const amountDiff = Math.abs(tx.amount - occ.expectedAmount);
  const absExpected = Math.abs(occ.expectedAmount);

  switch (schedule.amountType) {
    case 'exact':
      amountScore = amountDiff === 0 ? 30 : 0;
      break;
    case 'approximate':
      if (amountDiff === 0) amountScore = 30;
      else if (absExpected > 0 && amountDiff / absExpected <= 0.1) amountScore = 20;
      else amountScore = 0;
      break;
    case 'variable':
      if (amountDiff === 0) amountScore = 30;
      else if (absExpected > 0 && amountDiff / absExpected <= 0.25) amountScore = 10;
      else amountScore = 0;
      break;
    default:
      amountScore = amountDiff === 0 ? 30 : 0;
  }

  if (amountScore === 0) return { score: 0, payeeScore: 0 };

  let payeeScore = 0;
  if (schedule.payeeId && tx.payeeId === schedule.payeeId) {
    payeeScore = 25;
  } else if (schedule.payeeId && tx.payeeName && schedule.name) {
    const txNameLower = tx.payeeName.toLowerCase();
    const schedNameLower = schedule.name.toLowerCase();
    if (txNameLower.includes(schedNameLower) || schedNameLower.includes(txNameLower)) {
      payeeScore = 15;
    }
  }

  let accountScore = 0;
  if (schedule.accountId && tx.accountId === schedule.accountId) {
    accountScore = 15;
  } else if (!schedule.accountId) {
    accountScore = 5;
  }

  return { score: dateScore + amountScore + payeeScore + accountScore, payeeScore };
}

export interface MatchSuggestion {
  occurrenceId: string;
  scheduleId: string;
  scheduleName: string;
  scheduledDate: string;
  expectedDate: string;
  expectedAmount: number;
  candidates: {
    transactionId: string;
    date: string;
    amount: number;
    payeeName: string | null;
    score: number;
  }[];
}

export function getMatchSuggestions(): MatchSuggestion[] {
  const windowStart = format(subDays(new Date(), 14), 'yyyy-MM-dd');
  const windowEnd = format(addDays(new Date(), 7), 'yyyy-MM-dd');

  const pendingOccs = db
    .select({
      occ: scheduleOccurrences,
      schedule: schedules,
    })
    .from(scheduleOccurrences)
    .innerJoin(schedules, eq(scheduleOccurrences.scheduleId, schedules.id))
    .where(
      and(
        eq(scheduleOccurrences.status, 'pending'),
        eq(schedules.status, 'active'),
        gte(scheduleOccurrences.expectedDate, windowStart),
        lte(scheduleOccurrences.expectedDate, windowEnd),
      ),
    )
    .all();

  const suggestions: MatchSuggestion[] = [];

  for (const { occ, schedule } of pendingOccs) {
    const nearbyTxns = db
      .select()
      .from(transactions)
      .where(
        and(
          isNull(transactions.scheduleId),
          isNull(transactions.transferTransactionId),
          gte(
            transactions.date,
            format(subDays(parseISO(occ.expectedDate), schedule.dateFlexibility), 'yyyy-MM-dd'),
          ),
          lte(
            transactions.date,
            format(addDays(parseISO(occ.expectedDate), schedule.dateFlexibility), 'yyyy-MM-dd'),
          ),
        ),
      )
      .all();

    const candidateTxns: MatchSuggestion['candidates'] = [];

    for (const tx of nearbyTxns) {
      if (schedule.amount < 0 && tx.amount > 0) continue;
      if (schedule.amount > 0 && tx.amount < 0) continue;

      const dismissed = db
        .select()
        .from(scheduleMatchDismissals)
        .where(
          and(
            eq(scheduleMatchDismissals.occurrenceId, occ.id),
            eq(scheduleMatchDismissals.transactionId, tx.id),
          ),
        )
        .get();
      if (dismissed) continue;

      const { score } = scoreMatch(tx, occ, schedule);
      if (score >= 40) {
        candidateTxns.push({
          transactionId: tx.id,
          date: tx.date,
          amount: tx.amount,
          payeeName: tx.payeeName,
          score,
        });
      }
    }

    if (candidateTxns.length > 0) {
      candidateTxns.sort((a, b) => b.score - a.score);
      suggestions.push({
        occurrenceId: occ.id,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        scheduledDate: occ.scheduledDate,
        expectedDate: occ.expectedDate,
        expectedAmount: occ.expectedAmount,
        candidates: candidateTxns,
      });
    }
  }

  return suggestions;
}

export function dismissMatchSuggestion(occurrenceId: string, transactionId: string): void {
  try {
    db.insert(scheduleMatchDismissals)
      .values({
        id: nanoid(),
        occurrenceId,
        transactionId,
      })
      .run();
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) return;
    throw e;
  }
}
