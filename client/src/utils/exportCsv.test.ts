import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { csvCell } from './exportCsv';

// Reads back one cell as a spreadsheet would: strips the quotes and unescapes `""`
const unquote = (cell: string) =>
  cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;

const text = fc.string({
  unit: fc.constantFrom('=', '+', '-', '@', '\t', '\r', '\n', '"', ',', 'a', ' '),
});

describe('csvCell (property-based)', () => {
  it('never lets text start like a formula', () => {
    fc.assert(
      fc.property(text, (s) => {
        expect(unquote(csvCell(s))).not.toMatch(/^[=+\-@\t\r]/);
      }),
    );
  });

  it('keeps the text, adding only the leading quote mark', () => {
    fc.assert(
      fc.property(text, (s) => {
        const back = unquote(csvCell(s));
        expect(back === s || back === `'${s}`).toBe(true);
      }),
    );
  });

  it('quotes any cell with a comma, quote or line break, so it stays one cell', () => {
    fc.assert(
      fc.property(text, (s) => {
        const cell = csvCell(s);
        if (/[",\n\r]/.test(s)) expect(cell).toMatch(/^".*"$/s);
        else expect(cell).not.toMatch(/[",\n\r]/);
      }),
    );
  });

  it('leaves numbers alone, including negative amounts', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(csvCell(n)).toBe(String(n));
      }),
    );
  });
});

describe('csvCell with semicolons (property-based)', () => {
  const semicolonText = fc.string({
    unit: fc.constantFrom('=', '+', '-', '@', '\t', '\r', '\n', '"', ',', ';', 'a', ' '),
  });

  it('quotes any cell with a semicolon, quote or line break, and still blocks formulas', () => {
    fc.assert(
      fc.property(semicolonText, (s) => {
        const cell = csvCell(s, ';');
        if (/[";\n\r]/.test(s)) expect(cell).toMatch(/^".*"$/s);
        else expect(cell).not.toMatch(/[";\n\r]/);
        expect(unquote(cell)).not.toMatch(/^[=+\-@\t\r]/);
      }),
    );
  });

  it('writes numbers with a decimal comma', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 9 }), (whole, tenth) => {
        expect(csvCell(whole, ';')).toBe(String(whole));
        expect(csvCell(Number(`${whole}.${tenth}`), ';')).toBe(`${whole},${tenth}`);
      }),
    );
  });
});
