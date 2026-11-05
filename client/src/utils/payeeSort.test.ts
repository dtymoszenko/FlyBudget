import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  compareText,
  nextSort,
  sortPayees,
  type PayeeSort,
  type PayeeSortKey,
  type SortDir,
} from './payeeSort';
import type { PayeeWithCount } from '../types';

const LABELS: Record<string, string> = {
  groceries: 'Food → Groceries',
  groceriesLower: 'food → groceries',
  rent: 'Bills → Rent',
  shop2: 'Shopping → Shop 2',
  shop10: 'Shopping → Shop 10',
};
const categoryLabel = (id: string) => LABELS[id];

const name = fc.oneof(
  fc.constantFrom('apple', 'Apple', 'Äpple', 'Shop 2', 'Shop 10', 'zebra', 'b', ''),
  fc.string({ maxLength: 8 }),
);
const payee = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  name,
  defaultCategoryId: fc.constantFrom(null, ...Object.keys(LABELS), 'deletedCategory'),
  transactionCount: fc.nat(5),
}) as fc.Arbitrary<Omit<PayeeWithCount, 'logo' | 'createdAt'>>;
const payees = fc
  .uniqueArray(payee, { selector: (p) => p.id, maxLength: 30 })
  .map((list) => list.map((p): PayeeWithCount => ({ ...p, logo: null, createdAt: '' })));

const key = fc.constantFrom<PayeeSortKey>('name', 'category', 'transactions');
const dir = fc.constantFrom<SortDir>('asc', 'desc');
const sort = fc.record({ key, dir }) as fc.Arbitrary<PayeeSort>;

const labelOf = (p: PayeeWithCount) =>
  p.defaultCategoryId ? categoryLabel(p.defaultCategoryId) : undefined;

function primary(sortKey: PayeeSortKey, a: PayeeWithCount, b: PayeeWithCount): number {
  if (sortKey === 'name') return compareText(a.name, b.name);
  if (sortKey === 'transactions') return a.transactionCount - b.transactionCount;
  return compareText(labelOf(a)!, labelOf(b)!);
}

describe('sortPayees (property-based)', () => {
  it('keeps every payee exactly once and leaves the input alone', () => {
    fc.assert(
      fc.property(payees, sort, (list, s) => {
        const before = list.map((p) => p.id);
        const sorted = sortPayees(list, s, categoryLabel);
        expect(list.map((p) => p.id)).toEqual(before);
        expect(sorted.map((p) => p.id).sort()).toEqual([...before].sort());
      }),
    );
  });

  it('puts every neighbouring pair in order, with ties by name A–Z', () => {
    fc.assert(
      fc.property(payees, sort, (list, s) => {
        const sorted = sortPayees(list, s, categoryLabel).filter(
          (p) => s.key !== 'category' || labelOf(p) !== undefined,
        );
        const sign = s.dir === 'asc' ? 1 : -1;
        for (let i = 1; i < sorted.length; i++) {
          const [a, b] = [sorted[i - 1], sorted[i]];
          const cmp = sign * primary(s.key, a, b);
          expect(cmp).toBeLessThanOrEqual(0);
          if (cmp === 0 && s.key !== 'name') {
            expect(compareText(a.name, b.name)).toBeLessThanOrEqual(0);
          }
        }
      }),
    );
  });

  it('descending is ascending reversed (column values)', () => {
    fc.assert(
      fc.property(payees, key, (list, k) => {
        const values = (d: SortDir) =>
          sortPayees(list, { key: k, dir: d }, categoryLabel)
            .filter((p) => k !== 'category' || labelOf(p) !== undefined)
            .map((p) =>
              k === 'name'
                ? p.name.toLocaleLowerCase()
                : k === 'transactions'
                  ? String(p.transactionCount)
                  : labelOf(p)!.toLocaleLowerCase(),
            );
        // Compare groups of equal values, since names equal to the collator may differ in text
        const groups = (vals: string[]) =>
          vals.reduce<string[]>((acc, v) => {
            const last = acc[acc.length - 1];
            if (last === undefined || compareText(last, v) !== 0) acc.push(v);
            return acc;
          }, []);
        const asc = groups(values('asc'));
        const desc = groups(values('desc'));
        expect(desc.length).toBe(asc.length);
        desc.forEach((v, i) => expect(compareText(v, asc[asc.length - 1 - i])).toBe(0));
      }),
    );
  });

  it('payees without a (still existing) default category are always last', () => {
    fc.assert(
      fc.property(payees, dir, (list, d) => {
        const sorted = sortPayees(list, { key: 'category', dir: d }, categoryLabel);
        const firstMissing = sorted.findIndex((p) => labelOf(p) === undefined);
        if (firstMissing === -1) return;
        expect(sorted.slice(firstMissing).every((p) => labelOf(p) === undefined)).toBe(true);
      }),
    );
  });

  it('does not depend on the order the payees came in', () => {
    fc.assert(
      fc.property(
        payees.chain((list) =>
          fc.tuple(
            fc.constant(list),
            fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length }),
          ),
        ),
        sort,
        ([list, shuffled], s) => {
          expect(sortPayees(shuffled, s, categoryLabel).map((p) => p.id)).toEqual(
            sortPayees(list, s, categoryLabel).map((p) => p.id),
          );
        },
      ),
    );
  });
});

describe('sortPayees', () => {
  const make = (
    id: string,
    name: string,
    transactionCount = 0,
    defaultCategoryId: string | null = null,
  ) =>
    ({
      id,
      name,
      transactionCount,
      defaultCategoryId,
      logo: null,
      createdAt: '',
    }) as PayeeWithCount;

  it('sorts names case- and accent-insensitively, with numbers in natural order', () => {
    const list = [
      make('1', 'Shop 10'),
      make('2', 'zebra'),
      make('3', 'Shop 2'),
      make('4', 'Äpple'),
    ];
    expect(sortPayees(list, { key: 'name', dir: 'asc' }, categoryLabel).map((p) => p.name)).toEqual(
      ['Äpple', 'Shop 2', 'Shop 10', 'zebra'],
    );
  });

  it('keeps payees without a category last when sorting by category descending', () => {
    const list = [make('1', 'A'), make('2', 'B', 0, 'rent'), make('3', 'C', 0, 'groceries')];
    expect(
      sortPayees(list, { key: 'category', dir: 'desc' }, categoryLabel).map((p) => p.name),
    ).toEqual(['C', 'B', 'A']);
  });
});

describe('nextSort', () => {
  it('flips the direction of the active column', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'transactions', dir: 'desc' }, 'transactions')).toEqual({
      key: 'transactions',
      dir: 'asc',
    });
  });

  it('starts another column at its most useful end', () => {
    expect(nextSort({ key: 'name', dir: 'desc' }, 'transactions')).toEqual({
      key: 'transactions',
      dir: 'desc',
    });
    expect(nextSort({ key: 'transactions', dir: 'asc' }, 'name')).toEqual({
      key: 'name',
      dir: 'asc',
    });
    expect(nextSort({ key: 'name', dir: 'desc' }, 'category')).toEqual({
      key: 'category',
      dir: 'asc',
    });
  });
});
