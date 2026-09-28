import { z } from 'zod';

// Keep in sync with ACCOUNT_TYPES in client/src/types/index.ts
export const ACCOUNT_TYPES = [
  'checking',
  'savings',
  'cash',
  'credit',
  'line_of_credit',
  'investment',
  'retirement',
  'crypto',
  'real_estate',
  'vehicle',
  'valuables',
  'mortgage',
  'auto_loan',
  'student_loan',
  'loan',
  'other_asset',
  'other_liability',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const accountTypeSchema = z.enum(ACCOUNT_TYPES);

/** Debts: their balance is what's owed, stored as a negative number */
const LIABILITY_TYPES = new Set<string>([
  'credit',
  'line_of_credit',
  'mortgage',
  'auto_loan',
  'student_loan',
  'loan',
  'other_liability',
]);

/** Everyday spending accounts; everything else is tracked off budget by default */
const ON_BUDGET_TYPES = new Set<string>([
  'checking',
  'savings',
  'cash',
  'credit',
  'line_of_credit',
]);

export function isLiabilityType(type: string): boolean {
  return LIABILITY_TYPES.has(type);
}

export function defaultOffBudget(type: string): 0 | 1 {
  return ON_BUDGET_TYPES.has(type) ? 0 : 1;
}
