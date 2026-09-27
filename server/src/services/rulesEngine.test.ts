import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { applyRulesToNew, type Action, type Condition, type EngineRule } from './rulesEngine.js';

type Tx = Parameters<typeof applyRulesToNew>[0];

const arbTx: fc.Arbitrary<Tx> = fc.record({
  payeeName: fc.option(fc.string({ maxLength: 30 })),
  amount: fc.integer({ min: -1_000_000_00, max: 1_000_000_00 }),
  notes: fc.option(fc.string({ maxLength: 30 })),
  categoryId: fc.constant(null),
});

const arbCondition: fc.Arbitrary<Condition> = fc.record({
  field: fc.constantFrom('payee_name', 'amount', 'notes'),
  op: fc.constantFrom('contains', 'starts_with', 'ends_with', 'exact', 'regex'),
  value: fc.string({ maxLength: 10 }),
});

const arbAction: fc.Arbitrary<Action> = fc.record({
  field: fc.constantFrom('category_id', 'payee_id', 'notes'),
  value: fc.string({ minLength: 1, maxLength: 10 }),
});

const arbRule: fc.Arbitrary<EngineRule> = fc.record({
  id: fc.uuid(),
  conditions: fc.array(arbCondition, { maxLength: 3 }),
  actions: fc.array(arbAction, { minLength: 1, maxLength: 2 }),
  sortOrder: fc.nat(),
});

// Change the case of a string using a list of flips, e.g. "Coffee" -> "cOFfeE"
const recase = (s: string, flips: boolean[]) =>
  [...s].map((ch, i) => (flips[i % flips.length] ? ch.toUpperCase() : ch.toLowerCase())).join('');

describe('rules engine (property-based)', () => {
  it('never throws, whatever the conditions and transaction', () => {
    fc.assert(
      fc.property(arbTx, fc.array(arbRule, { maxLength: 5 }), (tx, rules) => {
        expect(() => applyRulesToNew(tx, rules)).not.toThrow();
      }),
    );
  });

  it('applies the first matching rule, so later rules never override it', () => {
    fc.assert(
      fc.property(
        arbTx,
        fc.array(arbRule, { maxLength: 4 }),
        fc.array(arbRule, { maxLength: 4 }),
        (tx, before, after) => {
          const first = applyRulesToNew(tx, before);
          if (first === null) return;
          expect(applyRulesToNew(tx, [...before, ...after])).toBe(first);
        },
      ),
    );
  });

  it('returns null when no rule matches, and a rule without conditions matches everything', () => {
    fc.assert(
      fc.property(arbTx, arbRule, (tx, rule) => {
        expect(applyRulesToNew(tx, [])).toBeNull();
        const catchAll = { ...rule, conditions: [] };
        expect(applyRulesToNew(tx, [catchAll])).toBe(catchAll.actions);
      }),
    );
  });

  it('matches payee text case-insensitively for contains / starts_with / ends_with / exact', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 20 })
          .chain((payee) =>
            fc
              .tuple(fc.nat({ max: payee.length }), fc.nat({ max: payee.length }))
              .map(([a, b]) => ({ payee, from: Math.min(a, b), to: Math.max(a, b) })),
          ),
        arbRule,
        fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }),
        ({ payee, from, to }, rule, flips) => {
          const tx: Tx = { payeeName: payee, amount: 0, notes: null, categoryId: null };
          const cases: Array<[Condition['op'], string]> = [
            ['contains', payee.slice(from, to)],
            ['starts_with', payee.slice(0, to)],
            ['ends_with', payee.slice(from)],
            ['exact', payee],
          ];
          for (const [op, text] of cases) {
            const value = recase(text, flips);
            const r = { ...rule, conditions: [{ field: 'payee_name' as const, op, value }] };
            expect(applyRulesToNew(tx, [r]), `${op} "${value}" on "${payee}"`).toBe(r.actions);
          }
        },
      ),
    );
  });

  it('matches amounts by their exact integer-cents value', () => {
    fc.assert(
      fc.property(arbTx, arbRule, (tx, rule) => {
        const r = {
          ...rule,
          conditions: [
            { field: 'amount' as const, op: 'exact' as const, value: String(tx.amount) },
          ],
        };
        expect(applyRulesToNew(tx, [r])).toBe(r.actions);
      }),
    );
  });
});
