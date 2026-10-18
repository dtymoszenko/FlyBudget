import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { cashFlowSelection } from './cashFlowSelection';

describe('Cash Flow drill-down selection', () => {
  it('filters a category within the chart range', () => {
    expect(
      cashFlowSelection({ nodeType: 'subcategory', categoryId: 'groceries' }, '2026-08', '2026-10'),
    ).toEqual({
      categoryId: 'groceries',
      categoryGroupId: undefined,
      uncategorized: false,
      from: '2026-08-01',
      to: '2026-10-31',
    });
  });
  it('filters a group rather than retaining a previous category', () => {
    expect(
      cashFlowSelection({ nodeType: 'expense-group', groupId: 'food' }, '2026-10', '2026-10'),
    ).toMatchObject({ categoryId: undefined, categoryGroupId: 'food', uncategorized: false });
  });
  it.each(['subcategory', 'expense-group'] as const)(
    'explicitly filters uncategorized %s nodes',
    (nodeType) => {
      expect(
        cashFlowSelection({ nodeType, categoryId: null, groupId: null }, '2024-02', '2024-02'),
      ).toMatchObject({ uncategorized: true, from: '2024-02-01', to: '2024-02-29' });
    },
  );
});

describe('Cash Flow month boundaries', () => {
  it('uses the first and last day across month lengths and year transitions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1990 * 12, max: 2090 * 12 }),
        fc.integer({ min: 0, max: 36 }),
        (start, duration) => {
          const month = (index: number) =>
            `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
          const end = start + duration;
          const result = cashFlowSelection(
            { nodeType: 'subcategory', categoryId: 'category' },
            month(start),
            month(end),
          );
          const lastDay = new Date(Date.UTC(Math.floor(end / 12), (end % 12) + 1, 0)).getUTCDate();
          expect(result.from).toBe(`${month(start)}-01`);
          expect(result.to).toBe(`${month(end)}-${lastDay}`);
        },
      ),
    );
  });
});
