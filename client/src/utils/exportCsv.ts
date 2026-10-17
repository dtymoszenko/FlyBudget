import { amountStyle, decimalSeparator } from './currency';

/** `,` between cells, or `;` where numbers use a decimal comma (as spreadsheets there expect) */
export type CsvSeparator = ',' | ';';

/**
 * One CSV cell. Text starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'` so
 * spreadsheets don't run it as a formula (names can come from banks); numbers are left as-is,
 * with a decimal comma in `;` files.
 */
export function csvCell(value: unknown, separator: CsvSeparator = ','): string {
  if (typeof value === 'number') {
    return separator === ';' ? String(value).replace('.', ',') : String(value);
  }
  let s = String(value ?? '');
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /["\n\r]/.test(s) || s.includes(separator) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The separator for this device: `;` when amounts are shown with a decimal comma */
export const deviceCsvSeparator = (): CsvSeparator =>
  decimalSeparator(amountStyle().format) === ',' ? ';' : ',';

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const separator = deviceCsvSeparator();
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map((h) => csvCell(h, separator)).join(separator),
    ...rows.map((r) => headers.map((h) => csvCell(r[h], separator)).join(separator)),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
