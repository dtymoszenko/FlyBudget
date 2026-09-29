/**
 * Rules engine: pure matching and action logic, no database access.
 *
 * Rules run top to bottom and every matching rule applies. Each rule sees the transaction as
 * changed by the rules above it (so a rename rule can feed a categorize rule), but a field set
 * by a higher rule is never overwritten by a lower one. Prepend/append notes always stack.
 */

export const TEXT_FIELDS = ['payee_name', 'imported_payee', 'notes'] as const;
export const ID_FIELDS = ['payee', 'account', 'category'] as const;

export type TextField = (typeof TEXT_FIELDS)[number];
export type IdField = (typeof ID_FIELDS)[number];

export const TEXT_OPS = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'regex',
] as const;
export const ID_OPS = ['is', 'is_not'] as const;
export const LIST_OPS = ['one_of', 'not_one_of'] as const;
export const EMPTY_OPS = ['is_empty', 'is_not_empty'] as const;
export const AMOUNT_OPS = ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'approx'] as const;
export const DATE_OPS = ['is', 'before', 'after'] as const;

/** "approx" amount tolerance: within 7.5% either way */
export const APPROX_TOLERANCE = 0.075;

export type Condition =
  | { field: TextField; op: (typeof TEXT_OPS)[number]; value: string }
  | { field: TextField | IdField; op: (typeof LIST_OPS)[number]; value: string[] }
  | { field: TextField | IdField; op: (typeof EMPTY_OPS)[number] }
  | { field: IdField; op: (typeof ID_OPS)[number]; value: string }
  /** Amounts compare the absolute value in cents; use `direction` for inflow vs outflow */
  | { field: 'amount'; op: (typeof AMOUNT_OPS)[number]; value: number }
  | { field: 'amount'; op: 'between'; value: [number, number] }
  | { field: 'direction'; op: 'is'; value: 'inflow' | 'outflow' }
  | { field: 'date'; op: (typeof DATE_OPS)[number]; value: string }
  | { field: 'date'; op: 'between'; value: [string, string] };

export type SplitPart = {
  kind: 'fixed' | 'percent' | 'remainder';
  /** cents for fixed, 0–100 for percent, unused for remainder */
  value: number;
  categoryId: string | null;
  notes: string | null;
};

export type Action =
  | { type: 'set_category'; value: string }
  | { type: 'set_payee'; value: string }
  | { type: 'set_notes' | 'prepend_notes' | 'append_notes'; value: string }
  | { type: 'split'; parts: SplitPart[] };

export type ConditionsOp = 'and' | 'or';

export type EngineRule = {
  id: string;
  conditionsOp: ConditionsOp;
  conditions: Condition[];
  actions: Action[];
  enabled: boolean;
  sortOrder: number;
};

export type TxState = {
  accountId: string;
  date: string;
  amount: number;
  payeeId: string | null;
  payeeName: string | null;
  /** Raw description from the bank or CSV; falls back to the payee name when absent */
  importedPayee: string | null;
  notes: string | null;
  categoryId: string | null;
};

/** Lookups the engine needs to validate action targets (deleted payees/categories are skipped) */
export type RuleContext = {
  payeeName: (id: string) => string | undefined;
  categoryExists: (id: string) => boolean;
};

export type Locks = { category?: boolean; payee?: boolean; notes?: boolean };

export type RuleOutcome = {
  tx: TxState;
  split: SplitPart[] | null;
  matchedRuleIds: string[];
};

// ---------------------------------------------------------------------------
// Conditions

const lower = (s: string | null | undefined) => (s ?? '').toLowerCase();

function textSubject(field: TextField, tx: TxState): string | null {
  if (field === 'payee_name') return tx.payeeName;
  if (field === 'imported_payee') return tx.importedPayee ?? tx.payeeName;
  return tx.notes;
}

function idSubject(field: IdField, tx: TxState): string | null {
  if (field === 'payee') return tx.payeeId;
  if (field === 'account') return tx.accountId;
  return tx.categoryId;
}

const isTextField = (f: string): f is TextField => (TEXT_FIELDS as readonly string[]).includes(f);

function subjectOf(field: TextField | IdField, tx: TxState): string | null {
  return isTextField(field) ? textSubject(field, tx) : idSubject(field, tx);
}

/** Compare two values; text compares case-insensitively, ids exactly */
function same(field: TextField | IdField, a: string | null, b: string): boolean {
  return isTextField(field) ? lower(a) === b.toLowerCase() : a === b;
}

export function evalCondition(c: Condition, tx: TxState): boolean {
  switch (c.field) {
    case 'amount': {
      const abs = Math.abs(tx.amount);
      if (c.op === 'between') {
        const [lo, hi] = c.value[0] <= c.value[1] ? c.value : [c.value[1], c.value[0]];
        return abs >= lo && abs <= hi;
      }
      const v = Math.abs(c.value);
      switch (c.op) {
        case 'is':
          return abs === v;
        case 'is_not':
          return abs !== v;
        case 'gt':
          return abs > v;
        case 'gte':
          return abs >= v;
        case 'lt':
          return abs < v;
        case 'lte':
          return abs <= v;
        case 'approx':
          return Math.abs(abs - v) <= Math.round(v * APPROX_TOLERANCE);
      }
      return false;
    }
    case 'direction':
      return c.value === 'inflow' ? tx.amount > 0 : tx.amount < 0;
    case 'date': {
      if (c.op === 'between') {
        const [a, b] = c.value[0] <= c.value[1] ? c.value : [c.value[1], c.value[0]];
        return tx.date >= a && tx.date <= b;
      }
      if (c.op === 'is') return tx.date === c.value;
      if (c.op === 'before') return tx.date < c.value;
      return tx.date > c.value;
    }
  }

  const subject = subjectOf(c.field, tx);
  switch (c.op) {
    case 'is_empty':
      return !subject;
    case 'is_not_empty':
      return !!subject;
    case 'one_of':
      return c.value.some((v) => same(c.field, subject, v));
    case 'not_one_of':
      return !c.value.some((v) => same(c.field, subject, v));
    case 'is':
      return same(c.field, subject, c.value);
    case 'is_not':
      return !same(c.field, subject, c.value);
  }

  const s = lower(subject);
  const v = c.value.toLowerCase();
  switch (c.op) {
    case 'contains':
      return s.includes(v);
    case 'not_contains':
      return !s.includes(v);
    case 'starts_with':
      return s.startsWith(v);
    case 'ends_with':
      return s.endsWith(v);
    case 'regex':
      try {
        return new RegExp(c.value, 'i').test(subject ?? '');
      } catch {
        return false;
      }
  }
}

export function matchesRule(
  rule: Pick<EngineRule, 'conditions' | 'conditionsOp'>,
  tx: TxState,
): boolean {
  if (!rule.conditions.length) return true;
  return rule.conditionsOp === 'or'
    ? rule.conditions.some((c) => evalCondition(c, tx))
    : rule.conditions.every((c) => evalCondition(c, tx));
}

// ---------------------------------------------------------------------------
// Actions

/**
 * Run rules over a transaction. `locks` marks fields the user already chose (e.g. a category
 * picked when adding a transaction) so rules leave them alone.
 */
export function runRules(
  input: TxState,
  rules: EngineRule[],
  ctx: RuleContext,
  locks: Locks = {},
): RuleOutcome {
  const tx = { ...input };
  const locked = { ...locks };
  let split: SplitPart[] | null = null;
  const matchedRuleIds: string[] = [];

  for (const rule of rules) {
    if (!rule.enabled || !matchesRule(rule, tx)) continue;
    let applied = false;
    for (const a of rule.actions) {
      switch (a.type) {
        case 'set_category':
          if (locked.category || !ctx.categoryExists(a.value)) break;
          tx.categoryId = a.value;
          locked.category = applied = true;
          break;
        case 'set_payee': {
          const name = ctx.payeeName(a.value);
          if (locked.payee || name === undefined) break;
          tx.payeeId = a.value;
          tx.payeeName = name;
          locked.payee = applied = true;
          break;
        }
        case 'set_notes':
          if (locked.notes) break;
          tx.notes = a.value || null;
          locked.notes = applied = true;
          break;
        case 'prepend_notes':
          if (!a.value) break;
          tx.notes = tx.notes ? `${a.value}${tx.notes}` : a.value;
          applied = true;
          break;
        case 'append_notes':
          if (!a.value) break;
          tx.notes = tx.notes ? `${tx.notes}${a.value}` : a.value;
          applied = true;
          break;
        case 'split':
          if (locked.category || computeSplitAmounts(tx.amount, a.parts) === null) break;
          split = a.parts.map((p) => ({
            ...p,
            categoryId: p.categoryId && ctx.categoryExists(p.categoryId) ? p.categoryId : null,
          }));
          tx.categoryId = null;
          locked.category = applied = true;
          break;
      }
    }
    if (applied) matchedRuleIds.push(rule.id);
  }

  return { tx, split, matchedRuleIds };
}

/**
 * Turn split parts into child amounts (same sign as the total). Fixed parts take their amount,
 * percent parts a share of the total (largest-remainder rounding, so 50/50 of an odd total still
 * adds up), and remainder parts share what's left. If nothing takes the remainder, it becomes an
 * extra uncategorized part. Returns null when the split can't apply (zero total, or the fixed and
 * percent parts add up to more than the total). Parts that come out as zero are dropped.
 */
export function computeSplitAmounts(
  total: number,
  parts: SplitPart[],
): Array<{ amount: number; categoryId: string | null; notes: string | null }> | null {
  if (total === 0 || !parts.length) return null;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const amounts = parts.map(() => 0);

  parts.forEach((p, i) => {
    if (p.kind === 'fixed') amounts[i] = Math.max(0, Math.round(p.value));
  });

  const pctIdx = parts.map((p, i) => (p.kind === 'percent' ? i : -1)).filter((i) => i >= 0);
  const pctTotal = pctIdx.reduce((s, i) => s + Math.max(0, parts[i].value), 0);
  const pctTarget = Math.round((abs * pctTotal) / 100);
  const exact = pctIdx.map((i) => (abs * Math.max(0, parts[i].value)) / 100);
  pctIdx.forEach((i, k) => (amounts[i] = Math.floor(exact[k])));
  let spare = pctTarget - pctIdx.reduce((s, i) => s + amounts[i], 0);
  const byFraction = pctIdx
    .map((i, k) => ({ i, frac: exact[k] - Math.floor(exact[k]) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; spare > 0 && byFraction.length; k = (k + 1) % byFraction.length, spare--) {
    amounts[byFraction[k].i]++;
  }

  const used = amounts.reduce((s, a) => s + a, 0);
  if (used > abs) return null;

  let left = abs - used;
  const remIdx = parts.map((p, i) => (p.kind === 'remainder' ? i : -1)).filter((i) => i >= 0);
  const result = parts.map((p, i) => ({
    amount: amounts[i],
    categoryId: p.categoryId,
    notes: p.notes,
  }));
  if (remIdx.length) {
    const share = Math.floor(left / remIdx.length);
    remIdx.forEach(
      (i, k) => (result[i].amount = share + (k < left - share * remIdx.length ? 1 : 0)),
    );
    left = 0;
  }
  if (left > 0) result.push({ amount: left, categoryId: null, notes: null });

  return result.filter((r) => r.amount > 0).map((r) => ({ ...r, amount: r.amount * sign }));
}

// ---------------------------------------------------------------------------
// Stored rules

type LegacyCondition = { field: 'payee_name' | 'amount' | 'notes'; op: string; value: string };
type LegacyAction = { field: 'category_id' | 'payee_id' | 'notes'; value: string };

/** Convert conditions saved by the original rules format to the current one */
export function normalizeConditions(raw: unknown[]): Condition[] {
  return raw.flatMap((c): Condition[] => {
    const legacy = c as LegacyCondition;
    if (legacy.field === 'amount' && typeof legacy.value === 'string') {
      // Originally matched against the signed cents as text; only "exact" was meaningful
      const cents = Number(legacy.value);
      if (!Number.isFinite(cents)) return [];
      const amount: Condition = { field: 'amount', op: 'is', value: Math.abs(Math.round(cents)) };
      if (cents === 0) return [amount];
      return [amount, { field: 'direction', op: 'is', value: cents > 0 ? 'inflow' : 'outflow' }];
    }
    if (legacy.op === 'exact') return [{ ...legacy, op: 'is' } as Condition];
    return [c as Condition];
  });
}

export function normalizeActions(raw: unknown[]): Action[] {
  return raw.map((a): Action => {
    const legacy = a as LegacyAction;
    if (!('field' in (a as object))) return a as Action;
    if (legacy.field === 'category_id') return { type: 'set_category', value: legacy.value };
    if (legacy.field === 'payee_id') return { type: 'set_payee', value: legacy.value };
    return { type: 'set_notes', value: legacy.value };
  });
}
