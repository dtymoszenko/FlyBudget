import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  detectDateFormat,
  detectDelimiter,
  detectNumberFormat,
  generateImportId,
  normalizeDate,
  parseCsv,
  readDirection,
  readImportAmount,
  type DateFormat,
  type Delimiter,
  type NumberFormat,
} from './csv';

/** Quotes a field the way spreadsheets and banks do */
const quote = (f: string) => `"${f.replace(/"/g, '""')}"`;

// Fields with no leading/trailing spaces (the parser trims) and at least one visible character
const field = fc
  .string({
    unit: fc.constantFrom('a', 'Z', '1', ' ', ',', ';', '\t', '"', '\n', '\r\n', '$', '€', '-'),
  })
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const delimiter = fc.constantFrom<Delimiter>(',', ';', '\t');

describe('parseCsv (property-based)', () => {
  it('round-trips any quoted fields, including delimiters, quotes and line breaks', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(field, { minLength: 3, maxLength: 3 }), { minLength: 1, maxLength: 20 }),
        fc.constantFrom('\n', '\r\n'),
        fc.boolean(),
        delimiter,
        (records, eol, bom, sep) => {
          const text = (bom ? '﻿' : '') + records.map((r) => r.map(quote).join(sep)).join(eol);
          expect(detectDelimiter(text)).toBe(sep);
          const { headers, rows } = parseCsv(text, sep);
          expect([headers, ...rows]).toEqual(records);
        },
      ),
    );
  });

  it('skips blank lines and strips an Excel byte order mark from the first header', () => {
    expect(parseCsv('﻿Date,Amount\r\n\r\n2024-01-02,5\r\n')).toEqual({
      headers: ['Date', 'Amount'],
      rows: [['2024-01-02', '5']],
    });
  });

  it('finds the separator from unquoted headers', () => {
    expect(detectDelimiter('Buchungstag;Betrag;Verwendungszweck\n01.02.2026;-12,50;Miete')).toBe(
      ';',
    );
    expect(detectDelimiter('Date\tAmount\n2026-01-02\t5')).toBe('\t');
    expect(detectDelimiter('Date,Amount\n2026-01-02,"1,5"')).toBe(',');
    expect(detectDelimiter('Amount\n5')).toBe(',');
  });
});

/** Writes cents the way a bank in that country would, in one of the many styles banks use */
function formatAmount(
  cents: number,
  format: NumberFormat,
  style: { group: boolean; decimals: boolean; sign: number; symbol: number },
): string {
  const [thousands, decimal] = format === 'dot' ? [',', '.'] : ['.', ','];
  const abs = Math.abs(cents);
  let whole = String(Math.floor(abs / 100));
  if (style.group) whole = whole.replace(/\B(?=(\d{3})+$)/g, thousands);
  const fraction = String(abs % 100).padStart(2, '0');
  let s = style.decimals || abs % 100 !== 0 ? `${whole}${decimal}${fraction}` : whole;
  s = ['', '$', '€', 'EUR '][style.symbol] + s + ['', '', ' €', ' kr'][style.symbol];
  if (cents < 0) {
    s = [`-${s}`, `(${s})`, `${s}-`, `−${s}`][style.sign];
  } else if (style.sign === 1) {
    s = `+${s}`;
  }
  return style.symbol === 3 ? s.replace(/ /g, ' ') : s;
}

const amountStyle = fc.record({
  group: fc.boolean(),
  decimals: fc.boolean(),
  sign: fc.integer({ min: 0, max: 3 }),
  symbol: fc.integer({ min: 0, max: 3 }),
});
const numberFormat = fc.constantFrom<NumberFormat>('dot', 'comma');
const cents = fc.integer({ min: -1e12, max: 1e12 });

describe('readImportAmount (property-based)', () => {
  it('reads back any amount written in either format', () => {
    fc.assert(
      fc.property(cents, numberFormat, amountStyle, (c, format, style) => {
        expect(readImportAmount(formatAmount(c, format, style), format)).toBe(c);
      }),
    );
  });

  it('never misreads an amount with two decimals as the other format', () => {
    fc.assert(
      fc.property(cents, numberFormat, amountStyle, (c, format, style) => {
        const other = format === 'dot' ? 'comma' : 'dot';
        const read = readImportAmount(formatAmount(c, format, { ...style, decimals: true }), other);
        // 12.50 read with a decimal comma would be 1250.00: refuse instead
        if (Math.abs(c) >= 100 || c % 100 !== 0) expect(read === null || read === c).toBe(true);
      }),
    );
  });

  it.each<[string, NumberFormat, number | null]>([
    ['12.34', 'dot', 1234],
    ['-12.34', 'dot', -1234],
    ['$1,234.56', 'dot', 123456],
    ['(12.00)', 'dot', -1200],
    ['12.00-', 'dot', -1200],
    ['0.29', 'dot', 29],
    ['-12,50', 'comma', -1250],
    ['1.234,56 €', 'comma', 123456],
    ['1 234,56', 'comma', 123456],
    ['EUR -5,00', 'comma', -500],
    ['12,50', 'dot', null],
    ['1,234.56', 'comma', null],
    ['', 'dot', null],
    ['n/a', 'dot', null],
  ])('%s (%s)', (raw, format, expected) => {
    expect(readImportAmount(raw, format)).toBe(expected);
  });
});

describe('detectNumberFormat (property-based)', () => {
  it('finds the format of any column with decimals', () => {
    fc.assert(
      fc.property(fc.array(cents, { minLength: 1 }), numberFormat, amountStyle, (cs, format, s) => {
        const column = cs.map((c) => formatAmount(c, format, { ...s, decimals: true }));
        expect(detectNumberFormat(column)).toBe(format);
      }),
    );
  });

  it('never picks a format that reads any value differently', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(cents, amountStyle), { minLength: 1 }),
        numberFormat,
        (values, format) => {
          const column = values.map(([c, style]) => formatAmount(c, format, style));
          const detected = detectNumberFormat(column);
          if (detected === null) return; // the user is asked
          values.forEach(([c], i) => expect(readImportAmount(column[i], detected)).toBe(c));
        },
      ),
    );
  });

  it('asks when the file cannot tell', () => {
    expect(detectNumberFormat(['1.234', '5.678'])).toBeNull(); // 1234 or 1.234?
    expect(detectNumberFormat(['1.50', '2,50'])).toBeNull(); // rows disagree
    expect(detectNumberFormat(['12', '-40'])).toBe('dot'); // reads the same either way
  });
});

const isoDay = fc
  .date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z') })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString().slice(0, 10));
const dateFormat = fc.constantFrom<DateFormat>('mdy', 'dmy');
const dateStyle = fc.record({
  sep: fc.constantFrom('/', '.', '-'),
  pad: fc.boolean(),
  shortYear: fc.boolean(),
  time: fc.constantFrom('', ' 14:05', 'T14:05:09', ' 2:05 PM', ' 2:05:09 p.m.', ' 9:30am'),
});

function formatDate(
  iso: string,
  format: DateFormat,
  style: { sep: string; pad: boolean; shortYear: boolean; time: string },
): string {
  const [y, m, d] = iso.split('-');
  const p = (s: string) => (style.pad ? s : String(+s));
  const year = style.shortYear ? y.slice(2) : y;
  const parts = format === 'mdy' ? [p(m), p(d), year] : [p(d), p(m), year];
  return parts.join(style.sep) + style.time;
}

describe('normalizeDate (property-based)', () => {
  it('reads back any date written in either order', () => {
    fc.assert(
      fc.property(isoDay, dateFormat, dateStyle, (iso, format, style) => {
        expect(normalizeDate(formatDate(iso, format, style), format)).toBe(iso);
      }),
    );
  });

  it('reads year-first dates the same in either order', () => {
    fc.assert(
      fc.property(isoDay, dateFormat, fc.constantFrom('-', '/', '.'), (iso, format, sep) => {
        expect(normalizeDate(iso.replace(/-/g, sep), format)).toBe(iso);
      }),
    );
  });

  it('keeps the calendar day for written-out dates in any time zone', () => {
    expect(normalizeDate('Jan 5, 2024')).toBe('2024-01-05');
    expect(normalizeDate('03/07/2024')).toBe('2024-03-07');
    expect(normalizeDate('03/07/2024', 'dmy')).toBe('2024-07-03');
    expect(normalizeDate('20240703', 'dmy')).toBe('2024-07-03');
  });

  it('rejects days that do not exist instead of guessing', () => {
    expect(normalizeDate('2024-02-30')).toBe('');
    expect(normalizeDate('31/12/2024', 'mdy')).toBe('');
    expect(normalizeDate('12345')).toBe('');
    expect(normalizeDate('20241301')).toBe('');
    expect(normalizeDate('Mar 5')).toBe(''); // no year: the browser would say 2001
  });
});

describe('detectDateFormat (property-based)', () => {
  it('never picks an order that reads any date differently, and finds it once a day is over 12', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(isoDay, dateStyle), { minLength: 1 }),
        dateFormat,
        (values, format) => {
          const column = values.map(([iso, style]) => formatDate(iso, format, style));
          const detected = detectDateFormat(column);
          if (values.some(([iso]) => +iso.slice(8) > 12)) expect(detected).toBe(format);
          if (detected === null) return; // the user is asked
          values.forEach(([iso], i) => expect(normalizeDate(column[i], detected)).toBe(iso));
        },
      ),
    );
  });

  it('follows the chosen order when a 12-hour time follows the date', () => {
    expect(normalizeDate('05/03/2024 10:00 AM', 'dmy')).toBe('2024-03-05');
    expect(normalizeDate('05/03/2024 10:00 AM', 'mdy')).toBe('2024-05-03');
    expect(detectDateFormat(['13/03/2024 10:00 PM'])).toBe('dmy');
    expect(detectDateFormat(['05/03/2024 10:00 PM'])).toBeNull();
    // Never left to the browser, which would read it month first
    expect(normalizeDate('05/03/2024 at 10:00', 'dmy')).toBe('');
  });

  it('asks when no day is over 12', () => {
    expect(detectDateFormat(['01.02.2026', '03.04.2026'])).toBeNull();
    expect(detectDateFormat(['2026-01-02', 'Jan 5, 2026'])).toBe('mdy'); // nothing to decide
  });
});

describe('readDirection', () => {
  it.each<[string, 'in' | 'out' | null]>([
    ['Af', 'out'],
    ['Bij', 'in'],
    [' debit ', 'out'],
    ['CREDIT', 'in'],
    ['DBIT', 'out'],
    ['CRDT', 'in'],
    ['Dr.', 'out'],
    ['S', 'out'],
    ['H', 'in'],
    ['', null],
    ['Betaalautomaat', null],
  ])('%s', (raw, expected) => {
    expect(readDirection(raw)).toBe(expected);
  });
});

describe('generateImportId', () => {
  it('tells identical rows in one file apart, and keeps the first one compatible', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 50 }), (n) => {
        const ids = Array.from({ length: n }, (_, i) =>
          generateImportId('2024-01-01', -500, 'Cafe', i + 1),
        );
        expect(new Set(ids).size).toBe(n);
        expect(ids[0]).toBe(generateImportId('2024-01-01', -500, 'Cafe'));
      }),
    );
  });
});
