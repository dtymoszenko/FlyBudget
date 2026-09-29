import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ACTION_TYPES,
  CONDITION_FIELDS,
  actionText,
  conditionText,
  isConditionComplete,
  makeAction,
  makeCondition,
  type RuleLookups,
} from './ruleFormat';
import type { RuleAction, RuleCondition } from '../types';

const lookups: RuleLookups = {
  payee: (id) => (id === 'p1' ? 'Starbucks' : undefined),
  account: (id) => (id === 'a1' ? 'Checking' : undefined),
  category: (id) => (id === 'c1' ? 'Coffee' : undefined),
};

const arbFieldOp = fc
  .constantFrom(...CONDITION_FIELDS)
  .chain((f) => fc.constantFrom(...f.ops).map((op) => ({ field: f.value, op })));

/** A sequence of field/operator changes, like a user clicking through the editor */
const arbEdits = fc.array(arbFieldOp, { minLength: 1, maxLength: 6 });

/** The value shape the server's schema expects for a condition */
function hasValidShape(c: RuleCondition): boolean {
  if (c.op === 'is_empty' || c.op === 'is_not_empty') return !('value' in c);
  if (!('value' in c)) return false;
  const v = c.value;
  if (c.op === 'one_of' || c.op === 'not_one_of')
    return Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (c.field === 'amount') {
    return c.op === 'between'
      ? Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number')
      : typeof v === 'number';
  }
  if (c.field === 'date') {
    const isDate = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
    return c.op === 'between' ? Array.isArray(v) && v.length === 2 && v.every(isDate) : isDate(v);
  }
  if (c.field === 'direction') return v === 'inflow' || v === 'outflow';
  return typeof v === 'string';
}

describe('rule editor helpers (property-based)', () => {
  it('always build a condition the server accepts the shape of, whatever the user switches between', () => {
    fc.assert(
      fc.property(arbEdits, (edits) => {
        let c: RuleCondition | undefined;
        for (const { field, op } of edits) {
          c = makeCondition(field, op, c);
          expect(c.field).toBe(field);
          expect(c.op).toBe(op);
          expect(hasValidShape(c), JSON.stringify(c)).toBe(true);
        }
      }),
    );
  });

  it('keeps typed text when switching between text operators and text fields', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim() !== ''),
        fc.constantFrom('payee_name', 'imported_payee', 'notes'),
        fc.constantFrom('is', 'contains', 'starts_with', 'ends_with', 'regex'),
        (text, field, op) => {
          const from: RuleCondition = { field: 'payee_name', op: 'contains', value: text };
          const to = makeCondition(field, op, from);
          expect('value' in to && to.value).toBe(text);
          expect(makeCondition(field, 'one_of', from)).toMatchObject({ value: [text] });
        },
      ),
    );
  });

  it('starts text, payee, account and category values empty (incomplete), and amounts, dates and inflow/outflow filled in', () => {
    fc.assert(
      fc.property(arbFieldOp, ({ field, op }) => {
        const c = makeCondition(field, op);
        const prefilled =
          field === 'amount' || field === 'date' || field === 'direction' || !('value' in c);
        expect(isConditionComplete(c)).toBe(prefilled);
      }),
    );
  });

  it('describes every condition and action without throwing, including deleted payees and categories', () => {
    fc.assert(
      fc.property(arbEdits, fc.constantFrom('p1', 'gone', 'c1', 'a1'), (edits, id) => {
        let c: RuleCondition | undefined;
        for (const { field, op } of edits) {
          c = makeCondition(field, op, c);
          if (
            'value' in c &&
            typeof c.value === 'string' &&
            c.field !== 'date' &&
            c.field !== 'direction'
          ) {
            c = { ...c, value: id } as RuleCondition;
          }
          expect(conditionText(c, lookups).length).toBeGreaterThan(0);
        }
      }),
    );
    for (const { value } of ACTION_TYPES) {
      const a = makeAction(value);
      const withTarget = (
        a.type === 'set_category' || a.type === 'set_payee' ? { ...a, value: 'gone' } : a
      ) as RuleAction;
      expect(actionText(withTarget, lookups)).toMatch(/\S/);
    }
  });
});
