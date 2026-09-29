import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { categoryFigures, isActiveCategory, splitCategories } from './budgetFigures';
import type { BudgetCategory } from '../types';

const cents = fc.integer({ min: -10_000_000, max: 10_000_000 });
const category = fc
  .record({ budgeted: cents, spent: fc.nat(10_000_000), carryOver: cents, received: cents })
  .map(({ budgeted, spent, carryOver, received }): BudgetCategory => ({
    id: 'c',
    groupId: 'g',
    name: 'Category',
    icon: null,
    budgetType: null,
    sortOrder: 0,
    createdAt: '',
    budgeted,
    spent,
    carryOver,
    // The server's balance: carry-over + planned + this month's activity
    balance: carryOver + budgeted + received,
  }));

describe('categoryFigures (property-based)', () => {
  it('expenses: remaining is planned minus spent', () => {
    fc.assert(
      fc.property(category, (cat) => {
        const { actual, remaining } = categoryFigures(cat, false);
        expect(actual).toBe(cat.spent);
        expect(remaining).toBe(cat.budgeted - cat.spent);
      }),
    );
  });

  it('income: actual is what came in this month, and remaining is never negative', () => {
    fc.assert(
      fc.property(category, (cat) => {
        const { actual, remaining } = categoryFigures(cat, true);
        expect(actual).toBe(cat.balance - cat.carryOver - cat.budgeted);
        expect(remaining).toBe(Math.max(cat.budgeted - actual, 0));
        expect(remaining).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('a category is inactive only with nothing planned and nothing happening', () => {
    fc.assert(
      fc.property(category, fc.boolean(), (cat, isIncome) => {
        const idle = cat.budgeted === 0 && categoryFigures(cat, isIncome).actual === 0;
        expect(isActiveCategory(cat, isIncome)).toBe(!idle);
      }),
    );
  });
});

describe('splitCategories (property-based)', () => {
  // Categories that are often idle (nothing planned, nothing happening), with distinct ids
  const idleOrNot = fc.oneof(
    category,
    category.map((c) => ({ ...c, budgeted: 0, spent: 0, balance: c.carryOver })),
  );
  const section = fc
    .array(idleOrNot, { maxLength: 30 })
    .map((cats) => cats.map((c, i) => ({ ...c, id: `c${i}`, sortOrder: i })));

  it('lists every active category and at least `min` in all, in the section order', () => {
    fc.assert(
      fc.property(section, fc.boolean(), fc.nat(6), (cats, isIncome, min) => {
        const { shown, hidden } = splitCategories(cats, isIncome, min);
        // Nothing lost or repeated, and the order is kept
        expect([...shown, ...hidden].map((c) => c.id).sort()).toEqual(cats.map((c) => c.id).sort());
        const order = (list: BudgetCategory[]) => list.map((c) => c.sortOrder);
        expect(order(shown)).toEqual([...order(shown)].sort((a, b) => a - b));
        expect(order(hidden)).toEqual([...order(hidden)].sort((a, b) => a - b));
        // Only inactive categories are tucked away
        for (const c of hidden) expect(isActiveCategory(c, isIncome)).toBe(false);
        for (const c of cats.filter((c) => isActiveCategory(c, isIncome))) {
          expect(shown).toContain(c);
        }
        // Never fewer than `min` shown (unless the section has fewer)
        expect(shown.length).toBeGreaterThanOrEqual(Math.min(min, cats.length));
        // And no more than needed: extra inactive ones only to reach `min`
        const active = cats.filter((c) => isActiveCategory(c, isIncome)).length;
        expect(shown.length).toBe(Math.max(active, Math.min(min, cats.length)));
      }),
    );
  });
});
