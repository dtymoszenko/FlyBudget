import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildImportRows,
  describeSkippedRows,
  generateImportId,
  normalizeDate,
  parseCsv,
  parseImportAmount,
  type ColumnRole,
} from './csv';

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

describe('buildImportRows', () => {
  const roles: ColumnRole[] = ['date', 'payee', 'amount'];

  it('reports the rows it leaves out instead of dropping them silently', () => {
    const result = buildImportRows(
      [
        ['2024-01-02', 'Cafe', '-4.50'],
        ['2024-01-03', 'Shop', '-10.00'],
        ['2024-01-04', 'Bank', 'N/A'],
        ['13/45/2024', 'Gym', '-30.00'],
        ['2024-01-05', 'Store', ''],
        ['2024-01-06', 'Fee', '0.00'],
      ],
      roles,
    );
    if (typeof result === 'string') throw new Error(result);
    expect(result.rows.map((r) => r.payeeName)).toEqual(['Cafe', 'Shop']);
    expect(result.skipped).toEqual([
      { row: 3, field: 'amount', value: 'N/A' },
      { row: 4, field: 'date', value: '13/45/2024' },
      { row: 5, field: 'amount', value: '' },
      { row: 6, field: 'amount', value: '0.00' },
    ]);
  });

  it('with inflow and outflow columns, an empty side is not an error', () => {
    const result = buildImportRows(
      [
        ['2024-01-02', '', '12.00'],
        ['2024-01-03', '5.00', ''],
        ['2024-01-04', '', ''],
        ['2024-01-05', 'abc', ''],
      ],
      ['date', 'inflow', 'outflow'],
    );
    if (typeof result === 'string') throw new Error(result);
    expect(result.rows.map((r) => r.amount)).toEqual([-1200, 500]);
    expect(result.skipped).toEqual([
      { row: 3, field: 'amount', value: '' },
      { row: 4, field: 'amount', value: 'abc' },
    ]);
  });

  it('explains a missing date or amount column', () => {
    expect(buildImportRows([], ['payee', 'amount'])).toBe('Date column is required');
    expect(buildImportRows([], ['date', 'payee'])).toBe('At least one amount column is required');
  });

  it('accounts for every row: each one is imported or reported as skipped', () => {
    const cell = fc.constantFrom(
      '2024-01-02',
      '01/05/2024',
      '25/01/2024',
      'nope',
      '',
      '-4.50',
      '0',
      'N/A',
      '$12',
    );
    fc.assert(
      fc.property(fc.array(fc.array(cell, { minLength: 3, maxLength: 3 })), (rawRows) => {
        const result = buildImportRows(rawRows, roles);
        if (typeof result === 'string') throw new Error(result);
        expect(result.rows.length + result.skipped.length).toBe(rawRows.length);
        // Every row sent to the server is one it accepts
        for (const row of result.rows) {
          expect(new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(row.date);
          expect(row.amount).not.toBe(0);
        }
      }),
    );
  });
});

describe('describeSkippedRows', () => {
  it('names each skipped row and its value', () => {
    expect(describeSkippedRows([{ row: 3, field: 'amount', value: 'N/A' }])).toBe(
      '1 row skipped: row 3, amount "N/A".',
    );
    expect(
      describeSkippedRows([
        { row: 3, field: 'amount', value: '' },
        { row: 7, field: 'date', value: '13/45/2024' },
      ]),
    ).toBe('2 rows skipped: row 3, amount (empty); row 7, date "13/45/2024".');
  });

  it('lists the first few and counts the rest', () => {
    const skipped = Array.from({ length: 8 }, (_, i) => ({
      row: i + 1,
      field: 'amount' as const,
      value: 'x',
    }));
    expect(describeSkippedRows(skipped)).toBe(
      '8 rows skipped: row 1, amount "x"; row 2, amount "x"; row 3, amount "x"; ' +
        'row 4, amount "x"; row 5, amount "x"; and 3 more.',
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
