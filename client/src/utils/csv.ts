import { parseCents } from './currency';
import type { ImportRow } from '../api/transactions';

/**
 * Parses CSV text (RFC 4180): quoted fields may contain commas, doubled quotes and
 * line breaks (bank memos often do). A UTF-8 byte order mark (Excel) is ignored.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endRecord = () => {
    record.push(field.trim());
    if (record.some((f) => f !== '')) records.push(record);
    record = [];
    field = '';
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field.trim());
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRecord();
    } else {
      field += ch;
    }
  }
  endRecord();

  if (records.length === 0) return { headers: [], rows: [] };
  return { headers: records[0], rows: records.slice(1) };
}

export function normalizeDate(raw: string): string {
  const trimmed = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const slash = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    // Local date parts: "Jan 5, 2024" parses as local midnight, and toISOString() (UTC)
    // would give the previous day east of UTC
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }

  return trimmed;
}

/**
 * An amount as banks write it: "$1,234.56", "-12.00", "(12.00)" or "12.00-" for
 * negatives. Returns integer cents (0 if unreadable).
 */
export function parseImportAmount(raw: string | undefined): number {
  let s = (raw ?? '').replace(/[\s$€£,]/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  const cents = parseCents(s);
  return negative ? -cents : cents;
}

/**
 * Id used to skip rows imported before. `occurrence` numbers identical rows within one
 * file (two same-price coffees on the same day are two purchases, not a duplicate); the
 * first keeps the plain id, so files imported earlier still match.
 */
export function generateImportId(
  date: string,
  amount: number,
  payeeName: string,
  occurrence = 1,
): string {
  const id = `${date}|${amount}|${(payeeName || '').toLowerCase()}`;
  return occurrence > 1 ? `${id}|${occurrence}` : id;
}

const COLUMN_HINTS: Record<string, string> = {
  date: 'date',
  'transaction date': 'date',
  'posted date': 'date',
  'post date': 'date',
  description: 'payee',
  payee: 'payee',
  name: 'payee',
  merchant: 'payee',
  amount: 'amount',
  'transaction amount': 'amount',
  debit: 'outflow',
  withdrawal: 'outflow',
  outflow: 'outflow',
  credit: 'inflow',
  deposit: 'inflow',
  inflow: 'inflow',
  memo: 'notes',
  notes: 'notes',
  note: 'notes',
  reference: 'notes',
};

export type ColumnRole = 'date' | 'payee' | 'amount' | 'inflow' | 'outflow' | 'notes' | 'skip';

export function guessColumnRoles(headers: string[]): ColumnRole[] {
  return headers.map((h) => (COLUMN_HINTS[h.toLowerCase()] as ColumnRole) ?? 'skip');
}

/**
 * A real calendar date as YYYY-MM-DD, like the server's `isRealDate`: "13/45/2024" normalizes
 * to "2024-13-45", which the server would reject, failing the whole import over one row.
 */
function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** A file row left out of an import: `row` counts data rows from 1, `value` is the cell text */
export interface SkippedRow {
  row: number;
  field: 'date' | 'amount';
  value: string;
}

/**
 * The rows to import, plus every row left out (a date or amount it can't read, or an amount
 * of zero) so the preview can say so; or a message saying why there are none.
 */
export function buildImportRows(
  rawRows: string[][],
  roles: ColumnRole[],
): { rows: ImportRow[]; skipped: SkippedRow[] } | string {
  const dateIdx = roles.indexOf('date');
  const payeeIdx = roles.indexOf('payee');
  const amountIdx = roles.indexOf('amount');
  const inflowIdx = roles.indexOf('inflow');
  const outflowIdx = roles.indexOf('outflow');
  const notesIdx = roles.indexOf('notes');

  if (dateIdx === -1) return 'Date column is required';
  if (amountIdx === -1 && inflowIdx === -1 && outflowIdx === -1) {
    return 'At least one amount column is required';
  }

  const rows: ImportRow[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Map<string, number>();
  rawRows.forEach((raw, i) => {
    const date = normalizeDate(raw[dateIdx] ?? '');
    if (!isRealDate(date)) {
      skipped.push({ row: i + 1, field: 'date', value: raw[dateIdx] ?? '' });
      return;
    }

    let amount: number;
    if (amountIdx !== -1) {
      amount = parseImportAmount(raw[amountIdx]);
    } else {
      // Some banks write debits in the outflow column as negative numbers
      const inf = Math.abs(inflowIdx !== -1 ? parseImportAmount(raw[inflowIdx]) : 0);
      const out = Math.abs(outflowIdx !== -1 ? parseImportAmount(raw[outflowIdx]) : 0);
      amount = inf > 0 ? inf : -out;
    }
    if (amount === 0) {
      const cells = amountIdx !== -1 ? [amountIdx] : [inflowIdx, outflowIdx];
      const value = cells
        .map((idx) => (idx !== -1 ? (raw[idx] ?? '') : ''))
        .filter(Boolean)
        .join(' / ');
      skipped.push({ row: i + 1, field: 'amount', value });
      return;
    }

    // Same limits as the server, so one long memo can't fail the whole import
    const payeeName = payeeIdx !== -1 ? raw[payeeIdx]?.slice(0, 500) || null : null;
    const notes = notesIdx !== -1 ? raw[notesIdx]?.slice(0, 5000) || null : null;
    const key = generateImportId(date, amount, payeeName ?? '');
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const importedId = generateImportId(date, amount, payeeName ?? '', occurrence);
    rows.push({ date, amount, payeeName, notes, importedId });
  });
  return { rows, skipped };
}

/** "2 rows skipped: row 3, amount "N/A"; row 7, date "13/45/2024"." (the first `max` named) */
export function describeSkippedRows(skipped: SkippedRow[], max = 5): string {
  const listed = skipped
    .slice(0, max)
    .map((s) => `row ${s.row}, ${s.field} ${s.value ? `"${s.value}"` : '(empty)'}`);
  if (skipped.length > max) listed.push(`and ${skipped.length - max} more`);
  const count = `${skipped.length} ${skipped.length === 1 ? 'row' : 'rows'} skipped`;
  return `${count}: ${listed.join('; ')}.`;
}
