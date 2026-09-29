import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { generateImportId, normalizeDate, parseCsv, parseImportAmount } from './csv';

/** Quotes a field the way spreadsheets and banks do */
const quote = (f: string) => `"${f.replace(/"/g, '""')}"`;

// Fields with no leading/trailing spaces (the parser trims) and at least one visible character
const field = fc
  .string({ unit: fc.constantFrom('a', 'Z', '1', ' ', ',', '"', '\n', '\r\n', '$', '-') })
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

describe('parseCsv (property-based)', () => {
  it('round-trips any quoted fields, including commas, quotes and line breaks', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(field, { minLength: 3, maxLength: 3 }), { minLength: 1, maxLength: 20 }),
        fc.constantFrom('\n', '\r\n'),
        fc.boolean(),
        (records, eol, bom) => {
          const text = (bom ? '﻿' : '') + records.map((r) => r.map(quote).join(',')).join(eol);
          const { headers, rows } = parseCsv(text);
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
});

describe('parseImportAmount', () => {
  it.each([
    ['12.34', 1234],
    ['-12.34', -1234],
    ['$1,234.56', 123456],
    ['(12.00)', -1200],
    ['12.00-', -1200],
    ['', 0],
    ['n/a', 0],
  ])('%s', (raw, cents) => {
    expect(parseImportAmount(raw)).toBe(cents);
  });
});

describe('normalizeDate', () => {
  it('keeps the calendar day for written-out dates in any time zone', () => {
    expect(normalizeDate('Jan 5, 2024')).toBe('2024-01-05');
    expect(normalizeDate('03/07/2024')).toBe('2024-03-07');
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
