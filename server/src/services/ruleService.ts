import { db } from '../db/index.js';
import { categories, payees, rules, transactions } from '../db/schema.js';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  computeSplitAmounts,
  matchesRule,
  normalizeActions,
  normalizeConditions,
  runRules,
  type Condition,
  type ConditionsOp,
  type EngineRule,
  type RuleContext,
  type TxState,
} from './rulesEngine.js';
import { resolvePayee } from './transactionHelpers.js';

type RuleRow = typeof rules.$inferSelect;
type TxRow = typeof transactions.$inferSelect;

/** API shape of a stored rule (JSON columns parsed, legacy formats converted) */
export function parseRuleRow(r: RuleRow) {
  return {
    id: r.id,
    conditionsOp: (r.conditionsOp === 'or' ? 'or' : 'and') as ConditionsOp,
    conditions: normalizeConditions(JSON.parse(r.conditions)),
    actions: normalizeActions(JSON.parse(r.actions)),
    enabled: r.enabled === 1,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
  };
}

export function loadRules(): EngineRule[] {
  return db.select().from(rules).orderBy(rules.sortOrder).all().map(parseRuleRow);
}

export function buildRuleContext(): RuleContext {
  const payeeNames = new Map(
    db
      .select({ id: payees.id, name: payees.name })
      .from(payees)
      .all()
      .map((p) => [p.id, p.name]),
  );
  const categoryIds = new Set(
    db
      .select({ id: categories.id })
      .from(categories)
      .all()
      .map((c) => c.id),
  );
  return { payeeName: (id) => payeeNames.get(id), categoryExists: (id) => categoryIds.has(id) };
}

// ---------------------------------------------------------------------------
// New transactions

export type NewTransactionInput = {
  accountId: string;
  date: string;
  amount: number;
  payeeId: string | null;
  payeeName: string | null;
  importedPayee: string | null;
  notes: string | null;
  categoryId: string | null;
  importedId: string | null;
  /** Chosen by the device for a transaction saved offline, so sending it twice can't duplicate it */
  id?: string;
};

type InsertOptions = {
  /** Pass these when inserting many transactions (bank sync, CSV) so they load once */
  rules?: EngineRule[];
  ctx?: RuleContext;
  /** Keep a category/notes the user entered themselves instead of letting rules replace them */
  keepUserCategory?: boolean;
  keepUserNotes?: boolean;
};

/**
 * Insert a new transaction after running rules on it. Payees are only created after rules run,
 * so a rule that renames "SQ *COFFEE 1234" doesn't leave a junk payee behind. If no rule sets a
 * category, the payee's default category applies. A split action creates a parent plus children.
 */
export function insertNewTransaction(input: NewTransactionInput, opts: InsertOptions = {}) {
  let payeeId = input.payeeId;
  if (!payeeId && input.payeeName) {
    payeeId =
      db.select({ id: payees.id }).from(payees).where(eq(payees.name, input.payeeName)).get()?.id ??
      null;
  }

  const { tx, split } = runRules(
    { ...input, payeeId },
    opts.rules ?? loadRules(),
    opts.ctx ?? buildRuleContext(),
    {
      category: !!opts.keepUserCategory && !!input.categoryId,
      notes: !!opts.keepUserNotes && !!input.notes,
    },
  );

  if (!tx.payeeId && tx.payeeName) tx.payeeId = resolvePayee(tx.payeeName, null).payeeId;
  if (!tx.categoryId && !split && tx.payeeId) {
    tx.categoryId =
      db.select().from(payees).where(eq(payees.id, tx.payeeId)).get()?.defaultCategoryId ?? null;
  }

  const now = new Date().toISOString();
  const row = {
    id: input.id ?? nanoid(),
    accountId: tx.accountId,
    date: tx.date,
    amount: tx.amount,
    payeeId: tx.payeeId,
    payeeName: tx.payeeName,
    importedPayee: input.importedPayee,
    categoryId: tx.categoryId,
    notes: tx.notes,
    reconciled: 0,
    isParent: 0,
    transferTransactionId: null,
    parentTransactionId: null,
    importedId: input.importedId,
    createdAt: now,
  };

  const parts = split && computeSplitAmounts(tx.amount, split);
  if (!parts) {
    db.insert(transactions).values(row).run();
    return { transaction: row, children: [] };
  }

  const parent = { ...row, isParent: 1, categoryId: null };
  const children = parts.map((p) => ({
    ...row,
    id: nanoid(),
    amount: p.amount,
    categoryId: p.categoryId,
    notes: p.notes ?? null,
    importedId: null,
    parentTransactionId: parent.id,
  }));
  db.transaction(() => {
    db.insert(transactions).values(parent).run();
    for (const c of children) db.insert(transactions).values(c).run();
  });
  return { transaction: parent, children };
}

// ---------------------------------------------------------------------------
// Existing transactions

export type ApplyScope = 'uncategorized' | 'all';

type PlanOptions = {
  /** Run only these rules (even if disabled); default: every enabled rule */
  ruleIds?: string[];
  scope: ApplyScope;
  /** Limit to these transactions (the ones the user ticked in the preview) */
  transactionIds?: string[];
};

export type PlannedChange = {
  transactionId: string;
  date: string;
  accountId: string;
  amount: number;
  payeeName: string | null;
  changes: {
    payee?: { from: string | null; to: string | null };
    category?: { from: string | null; to: string | null };
    notes?: { from: string | null; to: string | null };
    split?: Array<{ amount: number; categoryId: string | null; notes: string | null }>;
  };
  next: {
    payeeId: string | null;
    payeeName: string | null;
    categoryId: string | null;
    notes: string | null;
  };
};

const txState = (t: TxRow): TxState => ({
  accountId: t.accountId,
  date: t.date,
  amount: t.amount,
  payeeId: t.payeeId,
  payeeName: t.payeeName,
  importedPayee: t.importedPayee,
  notes: t.notes,
  categoryId: t.categoryId,
});

/** Transactions rules may change: not reconciled, not transfers, not split (parents or children) */
function candidates(opts: PlanOptions): TxRow[] {
  const where = [
    ne(transactions.reconciled, 1),
    isNull(transactions.transferTransactionId),
    isNull(transactions.parentTransactionId),
    eq(transactions.isParent, 0),
  ];
  if (opts.scope === 'uncategorized') where.push(isNull(transactions.categoryId));
  if (opts.transactionIds) {
    if (!opts.transactionIds.length) return [];
    where.push(inArray(transactions.id, opts.transactionIds));
  }
  return db
    .select()
    .from(transactions)
    .where(and(...where))
    .orderBy(desc(transactions.date))
    .all();
}

/** Dry run: what running rules over existing transactions would change */
export function planRules(opts: PlanOptions): PlannedChange[] {
  const all = loadRules();
  const selected = opts.ruleIds
    ? all.filter((r) => opts.ruleIds!.includes(r.id)).map((r) => ({ ...r, enabled: true }))
    : all;
  if (!selected.length) return [];
  const ctx = buildRuleContext();
  // Running every rule also fills in payee default categories, like new transactions get
  const defaults = opts.ruleIds
    ? null
    : new Map(
        db
          .select({ id: payees.id, cat: payees.defaultCategoryId })
          .from(payees)
          .all()
          .filter((p) => p.cat && ctx.categoryExists(p.cat))
          .map((p) => [p.id, p.cat!]),
      );

  return candidates(opts).flatMap((t): PlannedChange[] => {
    const { tx, split } = runRules(txState(t), selected, ctx);
    if (defaults && !tx.categoryId && !split && tx.payeeId)
      tx.categoryId = defaults.get(tx.payeeId) ?? null;

    const changes: PlannedChange['changes'] = {};
    if (tx.payeeId !== t.payeeId) changes.payee = { from: t.payeeName, to: tx.payeeName };
    const parts = split && computeSplitAmounts(t.amount, split);
    if (parts) changes.split = parts;
    else if (tx.categoryId !== t.categoryId)
      changes.category = { from: t.categoryId, to: tx.categoryId };
    if ((tx.notes ?? null) !== (t.notes ?? null)) changes.notes = { from: t.notes, to: tx.notes };
    if (!Object.keys(changes).length) return [];

    return [
      {
        transactionId: t.id,
        date: t.date,
        accountId: t.accountId,
        amount: t.amount,
        payeeName: t.payeeName,
        changes,
        next: {
          payeeId: tx.payeeId,
          payeeName: tx.payeeName,
          categoryId: tx.categoryId,
          notes: tx.notes,
        },
      },
    ];
  });
}

/** Apply the planned changes for the given transactions (recomputed here, never trusted from the client) */
export function applyRules(opts: PlanOptions & { transactionIds: string[] }): number {
  const plan = planRules(opts);
  const rows = new Map(candidates(opts).map((t) => [t.id, t]));
  db.transaction(() => {
    for (const p of plan) {
      const t = rows.get(p.transactionId)!;
      const split = p.changes.split;
      db.update(transactions)
        .set({
          payeeId: p.next.payeeId,
          payeeName: p.next.payeeName,
          notes: p.next.notes,
          categoryId: split ? null : p.next.categoryId,
          ...(split ? { isParent: 1 } : {}),
        })
        .where(eq(transactions.id, t.id))
        .run();
      for (const s of split ?? []) {
        db.insert(transactions)
          .values({
            ...t,
            id: nanoid(),
            amount: s.amount,
            payeeId: p.next.payeeId,
            payeeName: p.next.payeeName,
            categoryId: s.categoryId,
            notes: s.notes,
            isParent: 0,
            parentTransactionId: t.id,
            importedId: null,
            scheduleId: null,
            createdAt: new Date().toISOString(),
          })
          .run();
      }
    }
  });
  return plan.length;
}

/** Transactions a set of conditions matches (for the rule editor's live preview) */
export function testConditions(conditionsOp: ConditionsOp, conditions: Condition[], limit = 20) {
  const rows = db
    .select()
    .from(transactions)
    .where(isNull(transactions.parentTransactionId))
    .orderBy(desc(transactions.date))
    .all();
  const matches = rows.filter((t) => matchesRule({ conditionsOp, conditions }, txState(t)));
  return {
    count: matches.length,
    matches: matches.slice(0, limit).map((t) => ({
      id: t.id,
      date: t.date,
      payeeName: t.payeeName,
      amount: t.amount,
      accountId: t.accountId,
      categoryId: t.categoryId,
    })),
  };
}
