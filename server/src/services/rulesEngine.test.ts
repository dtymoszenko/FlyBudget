import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeSplitAmounts,
  evalCondition,
  matchesRule,
  normalizeActions,
  normalizeConditions,
  runRules,
  TEXT_FIELDS,
  type Action,
  type Condition,
  type EngineRule,
  type RuleContext,
  type SplitPart,
  type TxState,
} from './rulesEngine.js';

const CATEGORIES = ['groceries', 'dining', 'fuel', 'rent'];
const PAYEES: Record<string, string> = { p1: 'Amazon', p2: 'Kroger', p3: 'Starbucks' };
const ctx: RuleContext = {
  payeeName: (id) => PAYEES[id],
  categoryExists: (id) => CATEGORIES.includes(id),
};

const arbDate = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

const arbTx: fc.Arbitrary<TxState> = fc.record({
  accountId: fc.constantFrom('a1', 'a2'),
  date: arbDate,
  amount: fc.integer({ min: -1_000_000_00, max: 1_000_000_00 }),
  payeeId: fc.option(fc.constantFrom('p1', 'p2', 'p3')),
  payeeName: fc.option(fc.string({ maxLength: 30 })),
  importedPayee: fc.option(fc.string({ maxLength: 30 })),
  notes: fc.option(fc.string({ maxLength: 30 })),
  categoryId: fc.option(fc.constantFrom(...CATEGORIES)),
});

const arbText = fc.string({ maxLength: 10 });
const arbCents = fc.integer({ min: 0, max: 1_000_00 });

/** Conditions that don't look at category or payee, so actions can't change whether they match */
const arbStableCondition: fc.Arbitrary<Condition> = fc.oneof(
  fc.record({
    field: fc.constant('notes' as const),
    op: fc.constantFrom('is', 'is_not', 'contains', 'not_contains', 'starts_with', 'ends_with', 'regex'),
    value: arbText,
  }),
  fc.record({ field: fc.constant('amount' as const), op: fc.constantFrom('is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'approx'), value: arbCents }),
  fc.record({ field: fc.constant('amount' as const), op: fc.constant('between' as const), value: fc.tuple(arbCents, arbCents) }),
  fc.record({ field: fc.constant('direction' as const), op: fc.constant('is' as const), value: fc.constantFrom('inflow', 'outflow') }),
  fc.record({ field: fc.constant('date' as const), op: fc.constantFrom('is', 'before', 'after'), value: arbDate }),
  fc.record({ field: fc.constant('account' as const), op: fc.constantFrom('is', 'is_not'), value: fc.constantFrom('a1', 'a2') }),
);

const arbCondition: fc.Arbitrary<Condition> = fc.oneof(
  arbStableCondition,
  fc.record({
    field: fc.constantFrom(...TEXT_FIELDS),
    op: fc.constantFrom('is', 'is_not', 'contains', 'not_contains', 'starts_with', 'ends_with', 'regex'),
    value: arbText,
  }),
  fc.record({ field: fc.constantFrom(...TEXT_FIELDS, 'payee', 'category'), op: fc.constantFrom('one_of', 'not_one_of'), value: fc.array(arbText, { minLength: 1, maxLength: 3 }) }),
  fc.record({ field: fc.constantFrom(...TEXT_FIELDS, 'payee', 'account', 'category'), op: fc.constantFrom('is_empty', 'is_not_empty') }),
  fc.record({ field: fc.constantFrom('payee', 'category'), op: fc.constantFrom('is', 'is_not'), value: fc.constantFrom('p1', 'p2', ...CATEGORIES) }),
);

const arbSplitPart: fc.Arbitrary<SplitPart> = fc.record({
  kind: fc.constantFrom('fixed', 'percent', 'remainder'),
  value: fc.integer({ min: 0, max: 100 }),
  categoryId: fc.option(fc.constantFrom(...CATEGORIES, 'deleted')),
  notes: fc.option(arbText),
});

const arbAction: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ type: fc.constant('set_category' as const), value: fc.constantFrom(...CATEGORIES, 'deleted') }),
  fc.record({ type: fc.constant('set_payee' as const), value: fc.constantFrom('p1', 'p2', 'p3', 'deleted') }),
  fc.record({ type: fc.constantFrom('set_notes', 'prepend_notes', 'append_notes'), value: arbText }),
  fc.record({ type: fc.constant('split' as const), parts: fc.array(arbSplitPart, { minLength: 1, maxLength: 4 }) }),
);

const arbRule = (cond = arbCondition, action = arbAction): fc.Arbitrary<EngineRule> =>
  fc.record({
    id: fc.uuid(),
    conditionsOp: fc.constantFrom('and', 'or'),
    conditions: fc.array(cond, { maxLength: 3 }),
    actions: fc.array(action, { minLength: 1, maxLength: 3 }),
    enabled: fc.constant(true),
    sortOrder: fc.nat(),
  });

const categoryRule = arbRule(
  arbStableCondition,
  fc.record({ type: fc.constant('set_category' as const), value: fc.constantFrom(...CATEGORIES) }),
);

// Change the case of a string using a list of flips, e.g. "Coffee" -> "cOFfeE"
const recase = (s: string, flips: boolean[]) =>
  [...s].map((ch, i) => (flips[i % flips.length] ? ch.toUpperCase() : ch.toLowerCase())).join('');

describe('rule conditions (property-based)', () => {
  it('never throw, whatever the condition and transaction', () => {
    fc.assert(
      fc.property(arbTx, arbCondition, (tx, c) => {
        expect(typeof evalCondition(c, tx)).toBe('boolean');
      }),
    );
  });

  it('negated operators are the exact opposite of their positive form', () => {
    const opposite = { is: 'is_not', contains: 'not_contains', one_of: 'not_one_of', is_empty: 'is_not_empty' } as const;
    fc.assert(
      fc.property(arbTx, arbCondition, (tx, c) => {
        const neg = opposite[c.op as keyof typeof opposite];
        if (!neg || c.field === 'amount' || c.field === 'date' || c.field === 'direction') return;
        expect(evalCondition({ ...c, op: neg } as Condition, tx)).toBe(!evalCondition(c, tx));
      }),
    );
  });

  it('"all" matches only when every condition does, "any" when at least one does, and no conditions match everything', () => {
    fc.assert(
      fc.property(arbTx, fc.array(arbCondition, { maxLength: 4 }), (tx, conditions) => {
        const each = conditions.map((c) => evalCondition(c, tx));
        expect(matchesRule({ conditionsOp: 'and', conditions }, tx)).toBe(each.every(Boolean));
        expect(matchesRule({ conditionsOp: 'or', conditions }, tx)).toBe(!conditions.length || each.some(Boolean));
      }),
    );
  });

  it('match text case-insensitively for is / contains / starts with / ends with / one of', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 20 })
          .chain((payee) =>
            fc
              .tuple(fc.nat({ max: payee.length }), fc.nat({ max: payee.length }))
              .map(([a, b]) => ({ payee, from: Math.min(a, b), to: Math.max(a, b) })),
          ),
        arbTx,
        fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }),
        ({ payee, from, to }, base, flips) => {
          const tx = { ...base, payeeName: payee };
          const cases: Array<[string, string | string[]]> = [
            ['contains', payee.slice(from, to)],
            ['starts_with', payee.slice(0, to)],
            ['ends_with', payee.slice(from)],
            ['is', payee],
            ['one_of', ['zzz', payee]],
          ];
          for (const [op, text] of cases) {
            const value = Array.isArray(text) ? text.map((t) => recase(t, flips)) : recase(text, flips);
            const c = { field: 'payee_name', op, value } as Condition;
            expect(evalCondition(c, tx), `${op} ${JSON.stringify(value)} on "${payee}"`).toBe(true);
          }
        },
      ),
    );
  });

  it('fall back to the payee name for the imported description when there is none', () => {
    fc.assert(
      fc.property(arbTx, fc.string({ minLength: 1, maxLength: 10 }), (base, name) => {
        const tx = { ...base, payeeName: name, importedPayee: null };
        expect(evalCondition({ field: 'imported_payee', op: 'is', value: name }, tx)).toBe(true);
      }),
    );
  });

  it('compare amounts by absolute value, with direction telling inflow from outflow', () => {
    fc.assert(
      fc.property(arbTx, arbCents, arbCents, (tx, a, b) => {
        const abs = Math.abs(tx.amount);
        expect(evalCondition({ field: 'amount', op: 'is', value: abs }, tx)).toBe(true);
        expect(evalCondition({ field: 'amount', op: 'is', value: abs }, { ...tx, amount: -tx.amount })).toBe(true);
        expect(evalCondition({ field: 'amount', op: 'between', value: [a, b] }, tx)).toBe(
          evalCondition({ field: 'amount', op: 'between', value: [b, a] }, tx),
        );
        const inflow = evalCondition({ field: 'direction', op: 'is', value: 'inflow' }, tx);
        const outflow = evalCondition({ field: 'direction', op: 'is', value: 'outflow' }, tx);
        expect(inflow).toBe(tx.amount > 0);
        expect(outflow).toBe(tx.amount < 0);
      }),
    );
  });

  it('"approximately" accepts amounts within 7.5% and rejects ones well outside', () => {
    fc.assert(
      fc.property(arbTx, fc.integer({ min: 1_00, max: 10_000_00 }), (tx, target) => {
        const near = { ...tx, amount: Math.round(target * 1.07) };
        const far = { ...tx, amount: Math.round(target * 1.2) };
        expect(evalCondition({ field: 'amount', op: 'approx', value: target }, near)).toBe(true);
        expect(evalCondition({ field: 'amount', op: 'approx', value: target }, far)).toBe(false);
      }),
    );
  });
});

describe('running rules (property-based)', () => {
  it('never throws, and returns a transaction with the same account, date and amount', () => {
    fc.assert(
      fc.property(arbTx, fc.array(arbRule(), { maxLength: 5 }), (tx, rules) => {
        const { tx: out } = runRules(tx, rules, ctx);
        expect([out.accountId, out.date, out.amount]).toEqual([tx.accountId, tx.date, tx.amount]);
      }),
    );
  });

  it('gives the category of the first matching rule, so rules below never override it', () => {
    fc.assert(
      fc.property(arbTx, fc.array(categoryRule, { maxLength: 5 }), fc.array(arbRule(), { maxLength: 4 }), (tx, rules, after) => {
        const first = rules.find((r) => matchesRule(r, tx));
        const { tx: out } = runRules(tx, [...rules, ...after], ctx);
        if (first) expect(out.categoryId).toBe((first.actions[0] as { value: string }).value);
      }),
    );
  });

  it('never applies disabled rules', () => {
    fc.assert(
      fc.property(arbTx, fc.array(arbRule(), { maxLength: 5 }), (tx, rules) => {
        const out = runRules(tx, rules.map((r) => ({ ...r, enabled: false })), ctx);
        expect(out).toEqual({ tx, split: null, matchedRuleIds: [] });
      }),
    );
  });

  it('never changes a locked field, and skips payees and categories that no longer exist', () => {
    fc.assert(
      fc.property(arbTx, fc.array(arbRule(), { maxLength: 5 }), (tx, rules) => {
        const locked = runRules(tx, rules, ctx, { category: true, payee: true });
        expect(locked.tx.categoryId).toBe(tx.categoryId);
        expect(locked.tx.payeeId).toBe(tx.payeeId);
        expect(locked.split).toBeNull();

        const { tx: out, split } = runRules(tx, rules, ctx);
        if (out.categoryId !== tx.categoryId && out.categoryId) expect(CATEGORIES).toContain(out.categoryId);
        if (out.payeeId !== tx.payeeId) expect(out.payeeName).toBe(PAYEES[out.payeeId!]);
        for (const p of split ?? []) if (p.categoryId) expect(CATEGORIES).toContain(p.categoryId);
      }),
    );
  });

  it('lets a rule see what the rules above it changed (rename, then categorize the new name)', () => {
    fc.assert(
      fc.property(arbTx, fc.constantFrom('p1', 'p2', 'p3'), fc.constantFrom(...CATEGORIES), (base, payee, category) => {
        const tx = { ...base, payeeId: null, payeeName: 'SQ *RAW 1234', categoryId: null };
        const rules: EngineRule[] = [
          { id: 'rename', conditionsOp: 'and', enabled: true, sortOrder: 0,
            conditions: [{ field: 'payee_name', op: 'starts_with', value: 'sq *raw' }],
            actions: [{ type: 'set_payee', value: payee }] },
          { id: 'categorize', conditionsOp: 'and', enabled: true, sortOrder: 1,
            conditions: [{ field: 'payee', op: 'is', value: payee }],
            actions: [{ type: 'set_category', value: category }] },
        ];
        const out = runRules(tx, rules, ctx);
        expect(out.tx).toMatchObject({ payeeId: payee, payeeName: PAYEES[payee], categoryId: category });
        expect(out.matchedRuleIds).toEqual(['rename', 'categorize']);
      }),
    );
  });

  it('stacks prepended and appended notes around the original', () => {
    fc.assert(
      fc.property(arbTx, arbText, arbText, (tx, pre, post) => {
        const rule: EngineRule = { id: 'n', conditionsOp: 'and', conditions: [], enabled: true, sortOrder: 0,
          actions: [{ type: 'prepend_notes', value: pre }, { type: 'append_notes', value: post }] };
        const { tx: out } = runRules(tx, [rule], ctx);
        expect(out.notes ?? '').toBe(`${pre}${tx.notes ?? ''}${post}`);
      }),
    );
  });
});

describe('split amounts (property-based)', () => {
  const arbTotal = fc.integer({ min: -1_000_000_00, max: 1_000_000_00 }).filter((n) => n !== 0);
  const fixedOrPercent = fc.record({
    kind: fc.constantFrom('fixed', 'percent'),
    value: fc.integer({ min: 0, max: 60 }),
    categoryId: fc.constant(null),
    notes: fc.constant(null),
  }) as fc.Arbitrary<SplitPart>;

  it('always add up to the total, with every part the same sign as the total', () => {
    fc.assert(
      fc.property(arbTotal, fc.array(arbSplitPart, { minLength: 1, maxLength: 5 }), (total, parts) => {
        const out = computeSplitAmounts(total, parts);
        if (!out) return;
        expect(out.reduce((s, p) => s + p.amount, 0)).toBe(total);
        for (const p of out) expect(Math.sign(p.amount)).toBe(Math.sign(total));
      }),
    );
  });

  it('only refuse when the fixed and percent parts need more than the total', () => {
    fc.assert(
      fc.property(arbTotal, fc.array(fixedOrPercent, { minLength: 1, maxLength: 4 }), (total, parts) => {
        const abs = Math.abs(total);
        const pct = parts.filter((p) => p.kind === 'percent').reduce((s, p) => s + p.value, 0);
        const fixed = parts.filter((p) => p.kind === 'fixed').reduce((s, p) => s + p.value, 0);
        const needed = fixed + Math.round((abs * pct) / 100);
        expect(computeSplitAmounts(total, parts) === null).toBe(needed > abs);
      }),
    );
  });

  it('split evenly-weighted percents to within a cent of each other', () => {
    fc.assert(
      fc.property(arbTotal, fc.integer({ min: 2, max: 4 }), (total, n) => {
        const parts: SplitPart[] = Array.from({ length: n }, (_, i) => ({ kind: 'percent', value: 100 / n, categoryId: `c${i}`, notes: null }));
        const out = computeSplitAmounts(total, parts)!;
        const amounts = out.map((p) => Math.abs(p.amount));
        expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
        expect(amounts.reduce((s, a) => s + a, 0)).toBe(Math.abs(total));
      }),
    );
  });
});

describe('rules saved in the original format', () => {
  // The original engine: text match on payee/notes, amount compared as signed cents text
  function legacyMatch(c: { field: string; op: string; value: string }, tx: TxState) {
    const raw = c.field === 'payee_name' ? tx.payeeName : c.field === 'amount' ? String(tx.amount) : tx.notes;
    const s = (raw ?? '').toLowerCase();
    const v = c.value.toLowerCase();
    if (c.op === 'contains') return s.includes(v);
    if (c.op === 'starts_with') return s.startsWith(v);
    if (c.op === 'ends_with') return s.endsWith(v);
    if (c.op === 'exact') return s === v;
    try { return new RegExp(c.value, 'i').test(raw ?? ''); } catch { return false; }
  }

  it('match exactly the same transactions after conversion', () => {
    const arbLegacy = fc.oneof(
      fc.record({ field: fc.constantFrom('payee_name', 'notes'), op: fc.constantFrom('contains', 'starts_with', 'ends_with', 'exact', 'regex'), value: arbText }),
      arbTx.map((t) => ({ field: 'amount', op: 'exact', value: String(t.amount) })),
    );
    fc.assert(
      fc.property(arbTx, fc.array(arbLegacy, { maxLength: 3 }), (tx, legacy) => {
        const converted = normalizeConditions(legacy);
        expect(matchesRule({ conditionsOp: 'and', conditions: converted }, tx)).toBe(legacy.every((c) => legacyMatch(c, tx)));
      }),
    );
  });

  it('convert actions to the new format and leave new ones alone', () => {
    expect(
      normalizeActions([
        { field: 'category_id', value: 'c' },
        { field: 'payee_id', value: 'p' },
        { field: 'notes', value: 'n' },
        { type: 'append_notes', value: '!' },
      ]),
    ).toEqual([
      { type: 'set_category', value: 'c' },
      { type: 'set_payee', value: 'p' },
      { type: 'set_notes', value: 'n' },
      { type: 'append_notes', value: '!' },
    ]);
  });
});
