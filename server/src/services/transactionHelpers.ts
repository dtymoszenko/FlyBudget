import { db } from '../db/index.js';
import { payees, transactions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { unlinkOccurrenceByTransactionId } from './matchingEngine.js';
import { refreshMainAmounts } from './mainAmountService.js';

export function resolvePayee(
  payeeName: string | null | undefined,
  payeeId: string | null | undefined,
) {
  let id = payeeId ?? null;
  let name = payeeName ?? null;
  if (!id && payeeName) {
    const existing = db.select().from(payees).where(eq(payees.name, payeeName)).get();
    if (existing) {
      id = existing.id;
    } else {
      id = nanoid();
      db.insert(payees)
        .values({
          id,
          name: payeeName,
          defaultCategoryId: null,
          createdAt: new Date().toISOString(),
        })
        .run();
    }
    name = payeeName;
  }
  return { payeeId: id, payeeName: name };
}

/**
 * The fields that make one side of a transfer an ordinary transaction again: named after the
 * bank's text when there is one (and that payee, if it exists: never creates one), otherwise
 * it keeps its name. Used by "Not a transfer", deleting the other side, and bank syncs.
 * A payee a rule gave it before it became a transfer isn't brought back (linking cleared it).
 */
export function restoreBankPayee(row: {
  payeeId: string | null;
  payeeName: string | null;
  importedPayee: string | null;
}) {
  const name = row.importedPayee;
  if (!name) {
    return { transferTransactionId: null, payeeId: row.payeeId, payeeName: row.payeeName };
  }
  const payee = db.select({ id: payees.id }).from(payees).where(eq(payees.name, name)).get();
  return { transferTransactionId: null, payeeId: payee?.id ?? null, payeeName: name };
}

/**
 * Splits an existing transaction into parts, replaces the parts of one that's already split,
 * or (no parts) makes it one uncategorized transaction again. The parts are new rows in the
 * same account, like a rule's split; the caller checks they add up to the whole.
 */
export function setSplitParts(
  row: typeof transactions.$inferSelect,
  parts: { categoryId: string | null; amount: number; notes?: string | null }[],
) {
  db.transaction((tx) => {
    const old = tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.parentTransactionId, row.id))
      .all();
    for (const c of old) unlinkOccurrenceByTransactionId(c.id);
    tx.delete(transactions).where(eq(transactions.parentTransactionId, row.id)).run();
    tx.update(transactions)
      .set({ isParent: parts.length ? 1 : 0, categoryId: null })
      .where(eq(transactions.id, row.id))
      .run();
    for (const p of parts) {
      tx.insert(transactions)
        .values({
          ...row,
          id: nanoid(),
          amount: p.amount,
          categoryId: p.categoryId,
          notes: p.notes ?? null,
          isParent: 0,
          parentTransactionId: row.id,
          importedId: null,
          scheduleId: null,
          createdAt: new Date().toISOString(),
        })
        .run();
    }
  });
  // The parts share the whole's budget-currency value
  refreshMainAmounts([row.id]);
}

/**
 * Deletes a transaction with everything that hangs off it: a split's parts, the link
 * from a transfer's other side (back to the bank's payee), and a schedule occurrence it paid (back to pending).
 */
export function deleteTransactionRow(row: { id: string; transferTransactionId: string | null }) {
  db.transaction((tx) => {
    const ids = [
      row.id,
      ...tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.parentTransactionId, row.id))
        .all()
        .map((c) => c.id),
    ];
    for (const id of ids) unlinkOccurrenceByTransactionId(id);
    const other = row.transferTransactionId
      ? tx.select().from(transactions).where(eq(transactions.id, row.transferTransactionId)).get()
      : undefined;
    if (other) {
      tx.update(transactions)
        .set(restoreBankPayee(other))
        .where(eq(transactions.id, other.id))
        .run();
    }
    tx.delete(transactions).where(eq(transactions.parentTransactionId, row.id)).run();
    tx.delete(transactions).where(eq(transactions.id, row.id)).run();
    // The other side is an ordinary transaction again, worth its own amount
    if (other) refreshMainAmounts([other.id]);
  });
}
