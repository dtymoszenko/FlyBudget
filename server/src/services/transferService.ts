import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { accounts, transactions, transferMatchDismissals } from '../db/schema.js';
import { restoreBankPayee } from './transactionHelpers.js';
import {
  bestCounterpart,
  findTransferMatches,
  pairKey,
  type TransferCandidate,
} from './transferMatching.js';

// Turning existing transactions into transfers (and back). The matching itself is pure, in
// transferMatching.ts; this is the database side.

type TransactionRow = typeof transactions.$inferSelect;

/** A request that can't be done; the message is safe to show (see the routes) */
export class TransferError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** What a transfer row in `accountId` is called: after the account on the other side */
const transferName = (otherAccountName: string) => `Transfer: ${otherAccountName}`;

/** A new row for one side of a transfer (POST /transactions/transfer and "Transfer: …" on one) */
export function newTransferRow(fields: {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  otherAccountName: string;
  otherId: string;
  notes: string | null;
}): typeof transactions.$inferInsert {
  return {
    id: fields.id,
    accountId: fields.accountId,
    date: fields.date,
    amount: fields.amount,
    payeeId: null,
    payeeName: transferName(fields.otherAccountName),
    categoryId: null,
    notes: fields.notes,
    transferTransactionId: fields.otherId,
    reconciled: 0,
    isParent: 0,
    parentTransactionId: null,
    importedId: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Rows that could become one side of a transfer: in an open account, not already a transfer,
 * not a split or a part of one, not reconciled (locked), and not a balance correction.
 */
const eligible = and(
  isNull(transactions.transferTransactionId),
  eq(transactions.isParent, 0),
  isNull(transactions.parentTransactionId),
  eq(transactions.reconciled, 0),
  eq(transactions.isAdjustment, 0),
  ne(transactions.amount, 0),
  isNull(accounts.closedAt),
);

function loadCandidates(accountId?: string): TransferCandidate[] {
  return db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      date: transactions.date,
      amount: transactions.amount,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(accountId ? and(eligible, eq(transactions.accountId, accountId)) : eligible)
    .all();
}

function loadDismissed(): Set<string> {
  return new Set(
    db
      .select({ id: transferMatchDismissals.id })
      .from(transferMatchDismissals)
      .all()
      .map((r) => r.id),
  );
}

/** Why `row` can't be one side of a transfer, or null if it can */
function ineligibleReason(row: TransactionRow): string | null {
  if (row.reconciled === 1) return 'Reconciled transactions are locked';
  if (row.transferTransactionId) return 'This is already a transfer';
  if (row.isParent === 1 || row.parentTransactionId)
    return "A split transaction can't be a transfer";
  if (row.isAdjustment === 1) return "A balance correction can't be a transfer";
  if (row.amount === 0) return 'A transfer needs an amount';
  return null;
}

function getRow(id: string): TransactionRow {
  const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!row) throw new TransferError('Transaction not found', 404);
  return row;
}

function getOpenAccount(id: string) {
  const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!account) throw new TransferError('Account not found', 404);
  if (account.closedAt) throw new TransferError('That account is closed');
  return account;
}

export interface TransferSuggestion {
  outflow: TransactionRow;
  inflow: TransactionRow;
  days: number;
}

/**
 * Likely transfers among existing transactions (see findTransferMatches), newest first.
 * With `accountId`, only pairs with one side in that account.
 */
export function listTransferSuggestions(accountId?: string): TransferSuggestion[] {
  const matches = findTransferMatches(loadCandidates(), loadDismissed());
  if (!matches.length) return [];
  const ids = matches.flatMap((m) => [m.outflowId, m.inflowId]);
  const rows = new Map<string, TransactionRow>();
  // Chunked: SQLite limits how many values one statement may bind
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const row of db.select().from(transactions).where(inArray(transactions.id, chunk)).all()) {
      rows.set(row.id, row);
    }
  }
  return matches
    .map((m) => ({ outflow: rows.get(m.outflowId)!, inflow: rows.get(m.inflowId)!, days: m.days }))
    .filter(
      (s) => !accountId || s.outflow.accountId === accountId || s.inflow.accountId === accountId,
    )
    .sort((a, b) => b.outflow.date.localeCompare(a.outflow.date));
}

export interface LinkResult {
  /** The two sides, the requested transaction first */
  transactions: [TransactionRow, TransactionRow];
  /** Both rows as they were before (the other side is null when it was just created) */
  previous: [TransactionRow, TransactionRow | null];
  /** Whether the other side was created (no matching transaction was found) */
  created: boolean;
}

/** Links two existing transactions as the two sides of one transfer */
export function linkTransfer(id: string, otherId: string): LinkResult {
  return db.transaction(() => linkRows(id, otherId));
}

/** Makes `row` one side of a transfer. The bank's text stays in importedPayee for rules */
function markTransfer(row: TransactionRow, otherId: string, otherAccountName: string) {
  db.update(transactions)
    .set({
      transferTransactionId: otherId,
      categoryId: null,
      payeeId: null,
      payeeName: transferName(otherAccountName),
      importedPayee: row.importedPayee ?? row.payeeName,
    })
    .where(eq(transactions.id, row.id))
    .run();
}

function linkRows(id: string, otherId: string): LinkResult {
  const a = getRow(id);
  const b = getRow(otherId);
  for (const row of [a, b]) {
    const reason = ineligibleReason(row);
    if (reason) throw new TransferError(reason, row.reconciled === 1 ? 403 : 400);
  }
  if (a.accountId === b.accountId) throw new TransferError('Choose two different accounts');
  if (a.amount !== -b.amount) {
    throw new TransferError('The two sides of a transfer must be the same amount, in and out');
  }
  const accountA = getOpenAccount(a.accountId);
  const accountB = getOpenAccount(b.accountId);

  markTransfer(a, b.id, accountB.name);
  markTransfer(b, a.id, accountA.name);
  // Linked on purpose: forget an earlier "not a transfer"
  db.delete(transferMatchDismissals)
    .where(eq(transferMatchDismissals.id, pairKey(a.id, b.id)))
    .run();

  return { transactions: [getRow(a.id), getRow(b.id)], previous: [a, b], created: false };
}

/**
 * Makes `id` a transfer to or from `accountId`: links the matching transaction already there
 * (same amount the other way, within a few days: the bank imported both sides), or creates it.
 */
export function transferToAccount(id: string, accountId: string): LinkResult {
  return db.transaction(() => {
    const tx = getRow(id);
    const reason = ineligibleReason(tx);
    if (reason) throw new TransferError(reason, tx.reconciled === 1 ? 403 : 400);
    if (tx.accountId === accountId) throw new TransferError('Choose a different account');
    const from = getOpenAccount(tx.accountId);
    const to = getOpenAccount(accountId);

    // The user asked for this transfer, so an earlier "not a transfer" doesn't hide its match
    // (linking forgets that dismissal); skipping it would add a duplicate of the real row
    const match = bestCounterpart(tx, loadCandidates(accountId));
    if (match) return linkRows(tx.id, match.id);

    const otherId = nanoid();
    db.insert(transactions)
      .values(
        newTransferRow({
          id: otherId,
          accountId: to.id,
          date: tx.date,
          amount: -tx.amount,
          otherAccountName: from.name,
          otherId: tx.id,
          notes: tx.notes,
        }),
      )
      .run();
    markTransfer(tx, otherId, to.name);

    return { transactions: [getRow(tx.id), getRow(otherId)], previous: [tx, null], created: true };
  });
}

/**
 * "Not a transfer": both sides become ordinary transactions again (named after the bank's
 * text when there is one) and the pair is never suggested again. Nothing is deleted.
 * Undo passes `dismiss: false`: the pair goes back to being a suggestion.
 */
export function unlinkTransfer(
  id: string,
  { dismiss = true }: { dismiss?: boolean } = {},
): [TransactionRow, TransactionRow | null] {
  return db.transaction(() => {
    const tx = getRow(id);
    if (!tx.transferTransactionId) throw new TransferError('This is not a transfer');
    const other = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, tx.transferTransactionId))
      .get();
    if (tx.reconciled === 1 || other?.reconciled === 1) {
      throw new TransferError('Reconciled transactions are locked', 403);
    }
    for (const row of other ? [tx, other] : [tx]) {
      db.update(transactions).set(restoreBankPayee(row)).where(eq(transactions.id, row.id)).run();
    }
    if (other && dismiss) dismissPair(tx.id, other.id);
    return [getRow(tx.id), other ? getRow(other.id) : null];
  });
}

/** Never suggest these two as a transfer again */
export function dismissPair(id: string, otherId: string): void {
  if (id === otherId) throw new TransferError('Choose two different transactions');
  getRow(id);
  getRow(otherId);
  db.insert(transferMatchDismissals)
    .values({ id: pairKey(id, otherId), transactionId: id, otherTransactionId: otherId })
    .onConflictDoNothing()
    .run();
}

/**
 * What a bank sync may still write to one side of a transfer: `linked` (it's still a transfer),
 * `unlinked` (an ordinary transaction again, or never a transfer), `locked` (the other side is
 * reconciled, so the amount can't change without breaking the pair).
 */
export type SyncedTransfer = 'linked' | 'unlinked' | 'locked';

/**
 * A bank sync changed one side of a linked transfer (`before` → `date`/`amount`, with the
 * bank's new text). A side that wasn't imported (FlyBudget created it, or you entered it)
 * follows the date and amount, like a manual edit. When both were imported, a new date keeps
 * the link and a new amount unlinks both (not dismissed: if they still match, they're suggested
 * again). Call it before saving the change.
 */
export function syncedTransferChange(
  before: TransactionRow,
  change: { date: string; amount: number; importedPayee: string },
): SyncedTransfer {
  if (!before.transferTransactionId) return 'unlinked';
  const other = db
    .select()
    .from(transactions)
    .where(eq(transactions.id, before.transferTransactionId))
    .get();
  const amountChanged = change.amount !== before.amount;
  if (other?.reconciled === 1) return amountChanged ? 'locked' : 'linked';
  if (other && other.importedId === null) {
    db.update(transactions)
      .set({ amount: -change.amount, date: change.date })
      .where(eq(transactions.id, other.id))
      .run();
    return 'linked';
  }
  if (!amountChanged) return 'linked';
  db.update(transactions)
    .set(restoreBankPayee({ ...before, importedPayee: change.importedPayee }))
    .where(eq(transactions.id, before.id))
    .run();
  if (other) {
    db.update(transactions).set(restoreBankPayee(other)).where(eq(transactions.id, other.id)).run();
  }
  return 'unlinked';
}
