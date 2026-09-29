import { z } from 'zod';

// Shared request validators. Dates are checked against the calendar, not just their
// shape: "2024-13-45" matches /\d{4}-\d{2}-\d{2}/ but becomes an Invalid Date, which
// breaks date math downstream (and made recurrence generation loop forever).

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isRealDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export const isoDate = z.string().refine(isRealDate, 'Expected a date as YYYY-MM-DD');

export const isoMonth = z.string().regex(MONTH_RE, 'Expected a month as YYYY-MM');

export const isMonth = (value: unknown): value is string =>
  typeof value === 'string' && MONTH_RE.test(value);
