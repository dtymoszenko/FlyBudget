export type Delimiter = ',' | ';' | '\t';

/**
 * The separator a file uses, judged by its first line that has any (the header row):
 * whichever of comma, semicolon or tab appears most often outside quotes, ties going to the
 * comma. Many European banks use semicolons, because the comma is their decimal separator.
 */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (inQuotes) continue;
    else if (ch === '\n' || ch === '\r') {
      if (counts[','] + counts[';'] + counts['\t'] > 0) break;
    } else if (ch === ',' || ch === ';' || ch === '\t') counts[ch]++;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

/**
 * Parses CSV text (RFC 4180): quoted fields may contain the delimiter, doubled quotes and
 * line breaks (bank memos often do). A UTF-8 byte order mark (Excel) is ignored.
 */
export function parseCsvRecords(text: string, delimiter: Delimiter = ','): string[][] {
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
    } else if (ch === delimiter) {
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
  return records;
}

/**
 * The header and the rows under it. `skipRows` leaves out rows above the header: some banks
 * (DKB, Comdirect) start with account details.
 */
export function parseCsv(
  text: string,
  delimiter: Delimiter = ',',
  skipRows = 0,
): { headers: string[]; rows: string[][] } {
  const records = parseCsvRecords(text, delimiter).slice(skipRows);
  if (records.length === 0) return { headers: [], rows: [] };
  return { headers: records[0], rows: records.slice(1) };
}

/**
 * How many rows sit above the header: those with clearly fewer columns than the table under
 * them (account details like `Kontonummer:;DE12…`). The table is the widest part of the
 * file: its width is the widest seen twice, or one less than the widest row (so one row
 * with a stray separator doesn't count). The header may be a column shorter than the rows,
 * when every row ends with a separator.
 */
export function detectSkipRows(records: string[][]): number {
  const widths = records.map((r) => r.length).filter((w) => w >= 2);
  if (!widths.length) return 0;
  const seen = new Set<number>();
  let widest = 0;
  let widestTwice = 0;
  for (const w of widths) {
    if (seen.has(w)) widestTwice = Math.max(widestTwice, w);
    seen.add(w);
    widest = Math.max(widest, w);
  }
  const width = Math.max(widestTwice, widest - 1);
  return Math.max(
    records.findIndex((r) => r.length >= 2 && r.length >= width - 1),
    0,
  );
}

export const CSV_ENCODINGS = [
  { value: 'auto', label: 'Detect' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'windows-1252', label: 'Western European (Windows-1252)' },
  { value: 'windows-1250', label: 'Central European (Windows-1250)' },
  { value: 'iso-8859-2', label: 'Central European (ISO-8859-2)' },
] as const;

export type CsvEncoding = (typeof CSV_ENCODINGS)[number]['value'];

/**
 * The text of a file. `auto` follows a byte order mark (UTF-16 from Excel's "Unicode text"),
 * then reads UTF-8 if the file is valid UTF-8, else Windows-1252, which many banks still
 * export. Polish or Czech files in Windows-1250 need it chosen: they are valid 1252 too, just
 * with the wrong letters.
 */
export function decodeCsvBytes(bytes: ArrayBuffer, encoding: CsvEncoding = 'auto'): string {
  if (encoding !== 'auto') return new TextDecoder(encoding).decode(bytes);
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
  if (head[0] === 0xff && head[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (head[0] === 0xfe && head[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Order of day and month in dates like 03/04/2026. Year-first dates are always read as such. */
export type DateFormat = 'mdy' | 'dmy';

// A time after the date: 14:05, 14:05:09, 2:05 PM, 2:05:09 p.m.
const TIME = '(?:[ T]\\d{1,2}:\\d{2}(?::\\d{2})?(?: ?[ap]\\.?m\\.?)?)?';
// 31/12/2026, 31.12.2026, 31-12-26, optionally followed by a time
const DAY_MONTH = new RegExp(`^(\\d{1,2})([./-])(\\d{1,2})\\2(\\d{4}|\\d{2})${TIME}$`, 'i');
// 2026-12-31, 2026/12/31, 2026.12.31, optionally followed by a time
const YEAR_FIRST = new RegExp(`^(\\d{4})([./-])(\\d{1,2})\\2(\\d{1,2})${TIME}$`, 'i');
// 20261231, as some banks (ING in the Netherlands) write it
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/;

/** `YYYY-MM-DD`, or '' if there is no such day (February 30) */
function isoDateOf(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * A date as `YYYY-MM-DD`, or '' if it isn't a real date. `format` says whether 03/04/2026 is
 * March 4 (`mdy`) or 3 April (`dmy`); two-digit years are 20xx.
 */
export function normalizeDate(raw: string, format: DateFormat = 'mdy'): string {
  const trimmed = raw.trim();

  const yearFirst = trimmed.match(YEAR_FIRST);
  if (yearFirst) return isoDateOf(+yearFirst[1], +yearFirst[3], +yearFirst[4]);
  const compact = trimmed.match(COMPACT);
  if (compact) return isoDateOf(+compact[1], +compact[2], +compact[3]);

  const dayMonth = trimmed.match(DAY_MONTH);
  if (dayMonth) {
    const [a, b] = [+dayMonth[1], +dayMonth[3]];
    const year = dayMonth[4].length === 2 ? 2000 + +dayMonth[4] : +dayMonth[4];
    return format === 'mdy' ? isoDateOf(year, a, b) : isoDateOf(year, b, a);
  }

  // Written-out dates like "Jan 5, 2024". Numeric dates are never left to the browser,
  // whatever follows them (it reads 05.03.2024 as May 3), nor dates without a year ("Mar 5"
  // is 2001).
  if (!/[a-z]/i.test(trimmed) || !/\d{4}/.test(trimmed)) return '';
  if (/^\d{1,4}[./-]\d{1,2}[./-]/.test(trimmed)) return '';
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    // Local date parts: "Jan 5, 2024" parses as local midnight, and toISOString() (UTC)
    // would give the previous day east of UTC
    return isoDateOf(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }

  return '';
}

/**
 * Whether a column of dates puts the month or the day first, or null when the file can't
 * tell (no day above 12, or rows that disagree). Then the user has to say: a wrong guess
 * would silently swap days and months.
 */
export function detectDateFormat(values: string[]): DateFormat | null {
  let monthFirst = false;
  let dayFirst = false;
  let ambiguous = false;
  for (const value of values) {
    const m = value.trim().match(DAY_MONTH);
    if (!m) continue;
    const [a, b] = [+m[1], +m[3]];
    if (a > 12 && b <= 12) dayFirst = true;
    else if (b > 12 && a <= 12) monthFirst = true;
    else if (a !== b) ambiguous = true;
  }
  if (monthFirst && dayFirst) return null;
  if (monthFirst) return 'mdy';
  if (dayFirst) return 'dmy';
  // Nothing to decide: year-first or written-out dates, or days that equal their month
  return ambiguous ? null : 'mdy';
}

/** How amounts are written: `1,234.56` (`dot` decimal) or `1.234,56` (`comma` decimal) */
export type NumberFormat = 'dot' | 'comma';

/** The digits, separators and signs of an amount, without currency symbols or spaces */
function amountChars(raw: string): string {
  return raw.replace(/[−–]/g, '-').replace(/[^0-9.,()+-]/g, '');
}

/** What one amount says about the format, if anything */
function numberFormatHint(raw: string): NumberFormat | 'ambiguous' | null {
  const s = amountChars(raw).replace(/[()+-]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) return lastDot > lastComma ? 'dot' : 'comma';
  const sep = lastDot !== -1 ? '.' : lastComma !== -1 ? ',' : null;
  if (!sep) return null;
  // The same separator twice can only group thousands: 1.234.567 or 1,234,567
  if (s.indexOf(sep) !== s.lastIndexOf(sep)) return sep === '.' ? 'comma' : 'dot';
  // Exactly three digits after it could be either: 1.234 is 1234 in Germany
  if (s.length - s.indexOf(sep) - 1 === 3 && s.indexOf(sep) > 0) return 'ambiguous';
  return sep === '.' ? 'dot' : 'comma';
}

/**
 * The format of a column of amounts, or null when it can't tell (only values like `1.234`,
 * or rows that disagree). Then the user has to say: a wrong guess would be off by a factor
 * of 100 or 1000.
 */
export function detectNumberFormat(values: string[]): NumberFormat | null {
  let dot = false;
  let comma = false;
  let ambiguous = false;
  for (const value of values) {
    const hint = numberFormatHint(value);
    if (hint === 'dot') dot = true;
    else if (hint === 'comma') comma = true;
    else if (hint === 'ambiguous') ambiguous = true;
  }
  if (dot && comma) return null;
  if (dot) return 'dot';
  if (comma) return 'comma';
  // Whole numbers without separators read the same either way
  return ambiguous ? null : 'dot';
}

// Thousands groups of exactly three digits, then optional decimals
const AMOUNT_PATTERN: Record<NumberFormat, RegExp> = {
  dot: /^(\d{1,3}(,\d{3})+|\d*)(\.\d*)?$/,
  comma: /^(\d{1,3}(\.\d{3})+|\d*)(,\d*)?$/,
};

/**
 * An amount as banks write it: "$1,234.56", "-12.00", "(12.00)" or "12.00-" for negatives,
 * or with `format: 'comma'` "1.234,56 €" and "-12,50". Returns integer cents (rounded to the
 * nearest cent), or null if it isn't a number in that format.
 */
export function readImportAmount(
  raw: string | undefined,
  format: NumberFormat = 'dot',
): number | null {
  let s = amountChars(raw ?? '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/\d/.test(s) || !AMOUNT_PATTERN[format].test(s)) return null;

  // Exact decimal arithmetic on the digits: parseFloat would turn 0.29 into 28.999… cents
  const [thousands, decimal] = format === 'dot' ? [',', '.'] : ['.', ','];
  const [whole, fraction = ''] = s.split(thousands).join('').split(decimal);
  const cents =
    Number(whole || '0') * 100 +
    Number(fraction.padEnd(2, '0').slice(0, 2)) +
    (fraction[2] >= '5' ? 1 : 0);
  if (!Number.isSafeInteger(cents)) return null;
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

const COLUMN_HINTS: Record<string, ColumnRole> = {
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
  // Common headers in European bank exports
  datum: 'date', // German, Dutch, Swedish
  buchungstag: 'date',
  buchungsdatum: 'date',
  fecha: 'date', // Spanish
  data: 'date', // Italian, Portuguese, Polish
  'date opération': 'date', // French
  'date operation': 'date',
  'naam / omschrijving': 'payee', // Dutch
  omschrijving: 'payee',
  'auftraggeber / empfänger': 'payee', // German
  'begünstigter/zahlungspflichtiger': 'payee',
  empfänger: 'payee',
  libellé: 'payee', // French
  libelle: 'payee',
  concepto: 'payee', // Spanish
  descrizione: 'payee', // Italian
  betrag: 'amount', // German
  'betrag (eur)': 'amount',
  bedrag: 'amount', // Dutch
  'bedrag (eur)': 'amount',
  montant: 'amount', // French
  importe: 'amount', // Spanish
  importo: 'amount', // Italian
  belopp: 'amount', // Swedish
  beløb: 'amount', // Danish
  beløp: 'amount', // Norwegian
  kwota: 'amount', // Polish
  débit: 'outflow',
  crédit: 'inflow',
  verwendungszweck: 'notes', // German
  mededelingen: 'notes', // Dutch
  // Columns saying which way the money went, when amounts have no sign
  'af bij': 'direction', // ING Netherlands
  'af/bij': 'direction',
  'debit/credit': 'direction',
  'credit/debit': 'direction',
  'soll/haben': 'direction', // German
  's/h': 'direction',
};

export type ColumnRole =
  'date' | 'payee' | 'amount' | 'inflow' | 'outflow' | 'direction' | 'notes' | 'skip';

// What banks write in a direction column, lowercased and without dots
const MONEY_OUT = new Set(['af', 'debit', 'dbit', 'd', 'dr', 'db', 'soll', 's', 'out']);
const MONEY_IN = new Set(['bij', 'credit', 'crdt', 'c', 'cr', 'haben', 'h', 'in']);

const directionWord = (raw: string | undefined) =>
  (raw ?? '').trim().toLowerCase().replace(/\./g, '');

/**
 * Which way the money went according to a direction column ("Af"/"Bij" at ING, "Debit"/
 * "Credit", "S"/"H"), or null if the cell says neither. With `outWord` (what the user said
 * this bank writes for money out, like Actual's "out value"), that word means out and any
 * other word in.
 */
export function readDirection(
  raw: string | undefined,
  outWord?: string | null,
): 'in' | 'out' | null {
  const value = directionWord(raw);
  if (value === '') return null;
  if (outWord?.trim()) return value === directionWord(outWord) ? 'out' : 'in';
  if (MONEY_OUT.has(value)) return 'out';
  if (MONEY_IN.has(value)) return 'in';
  return null;
}

/** The different words in a direction column that FlyBudget doesn't know, as written */
export function unknownDirectionWords(values: string[]): string[] {
  const unknown = new Map<string, string>();
  for (const raw of values) {
    const value = directionWord(raw);
    if (value && !MONEY_OUT.has(value) && !MONEY_IN.has(value) && !unknown.has(value)) {
      unknown.set(value, raw.trim());
    }
  }
  return [...unknown.values()];
}

/**
 * How an account's bank writes its CSV files, saved after each import and used for the next
 * (keep in sync with server/src/utils/importSettings.ts)
 */
export interface ImportSettings {
  delimiter: Delimiter;
  encoding: CsvEncoding;
  skipRows: number;
  /** Column header → what it holds */
  columns: Record<string, ColumnRole>;
  dateFormat: DateFormat | null;
  numberFormat: NumberFormat | null;
  outWord: string | null;
}

/** Roles for these headers: saved ones where the header was seen before, else a guess */
export function columnRolesFor(
  headers: string[],
  saved?: Record<string, ColumnRole>,
): ColumnRole[] {
  const guessed = guessColumnRoles(headers);
  return headers.map((h, i) => (saved && Object.hasOwn(saved, h) ? saved[h] : guessed[i]));
}

export function guessColumnRoles(headers: string[]): ColumnRole[] {
  return headers.map((h) => {
    const key = h.trim().toLowerCase();
    // hasOwn: a column named "constructor" isn't Object.prototype's
    return Object.hasOwn(COLUMN_HINTS, key) ? COLUMN_HINTS[key] : 'skip';
  });
}
