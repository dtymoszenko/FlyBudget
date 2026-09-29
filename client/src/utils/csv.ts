import { parseCents } from './currency';

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
