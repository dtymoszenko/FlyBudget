import type { PayeeWithCount } from '../types';

export type PayeeSortKey = 'name' | 'category' | 'transactions';
export type SortDir = 'asc' | 'desc';
export interface PayeeSort {
  key: PayeeSortKey;
  dir: SortDir;
}

export const DEFAULT_PAYEE_SORT: PayeeSort = { key: 'name', dir: 'asc' };

const FIRST_DIR: Record<PayeeSortKey, SortDir> = {
  name: 'asc',
  category: 'asc',
  transactions: 'desc',
};

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function compareText(a: string, b: string): number {
  return collator.compare(a, b);
}

function byName(a: PayeeWithCount, b: PayeeWithCount): number {
  return compareText(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The payees in the given order, as a new array. Equal values fall back to name A–Z,
 * and payees without a default category (or whose category is gone) are always last
 * when sorting by category, in both directions.
 */
export function sortPayees(
  payees: readonly PayeeWithCount[],
  sort: PayeeSort,
  categoryLabel: (categoryId: string) => string | undefined,
): PayeeWithCount[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const rows = payees.map((payee) => ({
    payee,
    label:
      sort.key === 'category' && payee.defaultCategoryId
        ? categoryLabel(payee.defaultCategoryId)
        : undefined,
  }));

  rows.sort((a, b) => {
    switch (sort.key) {
      case 'name':
        return sign * byName(a.payee, b.payee);
      case 'transactions':
        return (
          sign * (a.payee.transactionCount - b.payee.transactionCount) || byName(a.payee, b.payee)
        );
      case 'category':
        if (a.label === undefined || b.label === undefined) {
          if (a.label === b.label) return byName(a.payee, b.payee);
          return a.label === undefined ? 1 : -1;
        }
        return sign * compareText(a.label, b.label) || byName(a.payee, b.payee);
    }
  });

  return rows.map((row) => row.payee);
}

export function nextSort(current: PayeeSort, key: PayeeSortKey): PayeeSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: FIRST_DIR[key] };
}
