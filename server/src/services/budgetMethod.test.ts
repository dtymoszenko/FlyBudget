import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BUDGET_METHODS,
  carriesOver,
  categoryCarryOver,
  readBudgetMethod,
  summaryCarryOver,
  type BudgetMethodSettings,
} from './budgetMethod.js';

const settings: fc.Arbitrary<BudgetMethodSettings> = fc.record({
  method: fc.constantFrom(...BUDGET_METHODS),
  carryOver: fc.boolean(),
});
const category = fc.record({
  isIncome: fc.boolean(),
  carryOver: fc.constantFrom<0 | 1 | null>(0, 1, null),
});
const cents = fc.integer({ min: -1e12, max: 1e12 });

describe('readBudgetMethod', () => {
  it('reads what was stored, and anything unknown as zero-based', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer(), (budgetMethod, carryOver) => {
        const read = readBudgetMethod({ budgetMethod, carryOver });
        expect(read.method).toBe(budgetMethod === 'category' ? 'category' : 'zero_based');
        expect(read.carryOver).toBe(carryOver === 1);
      }),
    );
    for (const s of [
      { method: 'zero_based', carryOver: false },
      { method: 'category', carryOver: true },
    ] as const) {
      expect(readBudgetMethod({ budgetMethod: s.method, carryOver: s.carryOver ? 1 : 0 })).toEqual(
        s,
      );
    }
  });
});

describe('carriesOver', () => {
  it('always in zero-based budgeting, as before there was a choice', () => {
    fc.assert(
      fc.property(fc.boolean(), category, (carryOver, c) => {
        expect(carriesOver({ method: 'zero_based', carryOver }, c)).toBe(true);
      }),
    );
  });

  it('never for income in category budgeting', () => {
    fc.assert(
      fc.property(fc.boolean(), category, (carryOver, c) => {
        expect(carriesOver({ method: 'category', carryOver }, { ...c, isIncome: true })).toBe(
          false,
        );
      }),
    );
  });

  it("follows the category's own setting, else the budget's", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.constantFrom<0 | 1 | null>(0, 1, null), (def, own) => {
        const s = { method: 'category', carryOver: def } as const;
        const carries = carriesOver(s, { isIncome: false, carryOver: own });
        expect(carries).toBe(own === null ? def : own === 1);
      }),
    );
  });
});

describe('categoryCarryOver', () => {
  it('is everything before this month when carrying over, overspending too, else 0', () => {
    fc.assert(
      fc.property(fc.boolean(), cents, cents, (carries, budgeted, activity) => {
        expect(categoryCarryOver(carries, { budgeted, activity })).toBe(
          carries ? budgeted + activity : 0,
        );
      }),
    );
  });
});

describe('summaryCarryOver', () => {
  it('is income not yet budgeted in zero-based budgeting, and 0 in category budgeting', () => {
    fc.assert(
      fc.property(settings, cents, cents, (s, income, budgeted) => {
        expect(summaryCarryOver(s.method, { income, budgeted })).toBe(
          s.method === 'category' ? 0 : income - budgeted,
        );
      }),
    );
  });
});
