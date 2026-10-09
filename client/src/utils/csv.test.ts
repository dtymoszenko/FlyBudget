import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  columnKeys,
  columnRolesFor,
  decodeCsvBytes,
  detectDateFormat,
  detectDelimiter,
  detectNumberFormat,
  detectSkipRows,
  generateImportId,
  normalizeDate,
  parseCsv,
  parseCsvRecords,
  readDirection,
  unknownDirectionWords,
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
  s =
    ['', '$', '€', 'EUR ', 'kr. ', ''][style.symbol] +
    s +
    ['', '', ' €', ' kr', '', ' Fr.'][style.symbol];
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
  symbol: fc.integer({ min: 0, max: 5 }),
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
    ['kr. 1.234,56', 'comma', 123456],
    ['Fr. 12.50', 'dot', 1250],
    ['1.234,56 kr.', 'comma', 123456],
    ['45.00 DR', 'dot', -4500],
    ['45.00 CR', 'dot', 4500],
    ['-45.00 Cr.', 'dot', 4500],
    ['1.234,56 S', 'comma', -123456],
    ['1.234,56 H', 'comma', 123456],
    ['C$ 12.50', 'dot', 1250], // a currency before the amount, not a direction
    ['-C$12.50', 'dot', -1250],
    ['S/ 12.50-', 'dot', -1250],
    ['12,50', 'dot', null],
    ['100000000000.00', 'dot', 10_000_000_000_000], // the largest the server takes
    ['100000000000.01', 'dot', null],
    ['1,234.56', 'comma', null],
    ['', 'dot', null],
    ['n/a', 'dot', null],
  ])('%s (%s)', (raw, format, expected) => {
    expect(readImportAmount(raw, format)).toBe(expected);
  });
});

describe('readImportAmount with a direction after the amount (property-based)', () => {
  it('takes the sign from DR/CR, Soll/Haben and the like', () => {
    fc.assert(
      fc.property(
        cents.filter((c) => c !== 0),
        numberFormat,
        amountStyle,
        fc.constantFrom(['DR', -1], ['CR', 1], ['S', -1], ['H', 1], ['Debit', -1], ['Credit', 1]),
        (c, format, style, [word, sign]) => {
          const written = `${formatAmount(Math.abs(c), format, { ...style, sign: 0 })} ${word}`;
          expect(readImportAmount(written, format)).toBe(Number(sign) * Math.abs(c));
        },
      ),
    );
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
const dateFormat = fc.constantFrom<DateFormat>('mdy', 'dmy', 'ymd');
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
  const parts =
    format === 'mdy'
      ? [p(m), p(d), year]
      : format === 'dmy'
        ? [p(d), p(m), year]
        : [y.slice(2), p(m), d]; // 26-3-05: a two-digit year, and the day in two digits
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

  it('reads ISO timestamps, taking the date as written', () => {
    expect(normalizeDate('2024-01-05T10:00:00Z')).toBe('2024-01-05');
    expect(normalizeDate('2024-01-05T23:30:00+01:00')).toBe('2024-01-05');
    expect(normalizeDate('2024-01-05 10:00:00.123')).toBe('2024-01-05');
    expect(normalizeDate('05.01.2024 10:00:00,5 +0100', 'dmy')).toBe('2024-01-05');
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
          // A day over 12 settles month or day first; with only two-digit years the year
          // could still come first (13/04/19 is also 2013-04-19), so then it may ask
          if (
            format !== 'ymd' &&
            values.some(([iso]) => +iso.slice(8) > 12) &&
            values.some(([, style]) => !style.shortYear)
          ) {
            expect(detected).toBe(format);
          }
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

  it('asks whether a two-digit year comes first, unless only one order is a date', () => {
    expect(detectDateFormat(['26-03-15'])).toBeNull(); // 26 March 2015, or 15 March 2026?
    expect(detectDateFormat(['13/04/19', '14/04/2019'])).toBe('dmy'); // a full year settles it
    expect(detectDateFormat(['99-01-15'])).toBe('ymd'); // 99 can't be a day or a month
    expect(normalizeDate('26-03-15', 'ymd')).toBe('2026-03-15');
    expect(normalizeDate('26-03-2015', 'ymd')).toBe(''); // a four-digit year isn't first
  });

  it('asks when no day is over 12', () => {
    expect(detectDateFormat(['01.02.2026', '03.04.2026'])).toBeNull();
    expect(detectDateFormat(['2026-01-02', 'Jan 5, 2026'])).toBe('mdy'); // nothing to decide
  });
});

describe('detectSkipRows (property-based)', () => {
  // Account details above the table, as DKB or Comdirect write them: fewer columns
  const preambleRow = (width: number) =>
    fc.array(field, { minLength: 1, maxLength: Math.max(1, width - 2) });

  it('finds the header under any rows of account details (fewer than the table rows)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 10 }).chain((width) =>
          fc.array(preambleRow(width), { maxLength: 8 }).chain((preamble) =>
            fc.tuple(
              fc.constant(preamble),
              fc.array(fc.array(field, { minLength: width, maxLength: width }), {
                minLength: preamble.length + 2,
                maxLength: preamble.length + 20,
              }),
              fc.boolean(),
            ),
          ),
        ),
        delimiter,
        ([preamble, table, trailingSeparator], sep) => {
          // Some banks end every data row with a separator, making it a column wider
          const rows = table.map((r, i) => (trailingSeparator && i > 0 ? [...r, ''] : r));
          const text = [...preamble, ...rows].map((r) => r.map(quote).join(sep)).join('\n');
          const records = parseCsvRecords(text, sep);
          expect(detectSkipRows(records)).toBe(preamble.length);
          expect(parseCsv(text, sep, preamble.length).headers).toEqual(table[0]);
        },
      ),
    );
  });

  it('keeps the header when a few rows have a stray separator', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), fc.integer({ min: 3, max: 30 }), (width, n) => {
        const row = (w: number) => Array.from({ length: w }, (_, i) => `c${i}`);
        // Fewer than half the rows are wider
        const records = [
          row(width),
          ...Array.from({ length: n }, (_, i) => row(i < n / 2 - 1 ? width + 1 : width)),
        ];
        expect(detectSkipRows(records)).toBe(0);
      }),
    );
  });

  it('keeps a header one column short of rows with an extra unnamed column', () => {
    expect(
      detectSkipRows([
        ['Date', 'Description', 'Amount'],
        ['2025-01-02', 'Bakery', '-4.50', 'POS'],
        ['2025-01-03', 'Salary', '2500.00', 'SEPA'],
      ]),
    ).toBe(0);
  });

  it('never takes account details for the header of a narrow table', () => {
    const records = [
      ['Konto', 'DE89370400440532013000'],
      ['Datum', 'Text', 'Betrag'],
      ['01.02.2025', 'Miete', '-500,00'],
    ];
    expect(detectSkipRows(records)).toBe(1);
  });

  it('skips nothing in a plain file', () => {
    expect(
      detectSkipRows([
        ['Date', 'Amount'],
        ['2026-01-02', '5'],
      ]),
    ).toBe(0);
    expect(detectSkipRows([['just one column'], ['5']])).toBe(0);
    expect(detectSkipRows([])).toBe(0);
  });
});

describe('decodeCsvBytes', () => {
  const bytes = (...b: number[]) => new Uint8Array(b).buffer;

  it('reads UTF-8, and falls back to Windows-1252 for files that are not', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('Müller;Café').buffer)).toBe('Müller;Café');
    expect(decodeCsvBytes(bytes(0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72))).toBe('Müller');
  });

  it('follows a UTF-16 byte order mark', () => {
    // Each character as two bytes, low first (LE) or high first (BE), after a byte order mark
    const utf16 = (s: string, bigEndian: boolean) =>
      bytes(
        ...[...('﻿' + s)].flatMap((ch) => {
          const code = ch.charCodeAt(0);
          return bigEndian ? [code >> 8, code & 0xff] : [code & 0xff, code >> 8];
        }),
      );
    expect(decodeCsvBytes(utf16('Datum;Betrag', false))).toBe('Datum;Betrag');
    expect(decodeCsvBytes(utf16('Datum;Kwota', true))).toBe('Datum;Kwota');
  });

  it('reads Central European files when told to', () => {
    const lodz = bytes(0xa3, 0xf3, 0x64, 0x9f); // "Łódź" in Windows-1250
    expect(decodeCsvBytes(lodz, 'windows-1250')).toBe('Łódź');
    expect(decodeCsvBytes(bytes(0xa3, 0xf3, 0x64, 0xbc), 'iso-8859-2')).toBe('Łódź');
    expect(decodeCsvBytes(lodz)).not.toBe('Łódź'); // valid 1252, just the wrong letters
  });
});

describe('columnRolesFor', () => {
  it('maps columns as last time, and guesses the ones it has not seen', () => {
    expect(
      columnRolesFor(['Datum', 'Omschrijving', 'Code', 'Bedrag'], {
        Omschrijving: 'notes',
        Code: 'direction',
      }),
    ).toEqual(['date', 'notes', 'direction', 'amount']);
    // Repeated (or blank) headers each keep their own role
    expect(columnKeys(['Datum', 'Text', 'Datum', '', ''])).toEqual([
      'Datum',
      'Text',
      'Datum#2',
      '',
      '#2',
    ]);
    expect(columnRolesFor(['Datum', 'Datum'], { Datum: 'skip', 'Datum#2': 'date' })).toEqual([
      'skip',
      'date',
    ]);
    // A header named like an object property is still just a header
    expect(columnRolesFor(['constructor', 'Amount'], {})).toEqual(['skip', 'amount']);
  });
});

describe('readDirection', () => {
  it('uses the word the user gave for money out, and counts every other word as in', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom('a', 'B', 'c'), minLength: 1, maxLength: 8 }),
        fc.string({ unit: fc.constantFrom('x', 'Y', 'z'), minLength: 1, maxLength: 8 }),
        (word, other) => {
          expect(readDirection(` ${word.toUpperCase()} `, word)).toBe('out');
          expect(readDirection(other, word)).toBe('in');
          expect(readDirection('', word)).toBeNull();
        },
      ),
    );
  });

  it('keeps the words it knows, whatever word was typed for another bank', () => {
    expect(readDirection('Debit', 'Uit')).toBe('out');
    expect(readDirection('Af', 'Uit')).toBe('out');
    expect(readDirection('Bij', 'Uit')).toBe('in');
    expect(readDirection('Uit', 'Uit')).toBe('out');
    expect(readDirection('Binnen', 'Uit')).toBe('in');
  });

  it('lists the words it does not know, once each', () => {
    expect(unknownDirectionWords(['Af', 'Uit', 'uit ', 'Bij', '', 'In'])).toEqual(['Uit']);
  });

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

describe('generateImportId (ids)', () => {
  it('stays within the 500 characters the server takes, even for a very long payee', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), fc.integer({ min: 1, max: 1e6 }), (payee, n) => {
        expect(generateImportId('2025-01-01', -1e13, payee, n).length).toBeLessThanOrEqual(500);
      }),
    );
  });

  it('keeps every id that already fit unchanged, so earlier imports still match', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 470 }), fc.integer({ min: 1, max: 99 }), (payee, n) => {
        const id = `2025-01-01|-1234|${payee.toLowerCase()}${n > 1 ? `|${n}` : ''}`;
        fc.pre(id.length <= 500);
        expect(generateImportId('2025-01-01', -1234, payee, n)).toBe(id);
      }),
    );
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
