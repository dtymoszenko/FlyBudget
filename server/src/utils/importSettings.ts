import { z } from 'zod';

// How an account's bank writes its CSV files, remembered from the last import (keep in sync
// with `ImportSettings` in client/src/utils/csv.ts)

export const CSV_ENCODINGS = [
  'auto',
  'utf-8',
  'utf-16le',
  'utf-16be',
  'windows-1252',
  'windows-1250',
  'iso-8859-2',
] as const;

const COLUMN_ROLES = [
  'date',
  'payee',
  'amount',
  'inflow',
  'outflow',
  'direction',
  'notes',
  'skip',
] as const;

export const importSettingsSchema = z.object({
  delimiter: z.enum([',', ';', '\t']),
  encoding: z.enum(CSV_ENCODINGS),
  /** Rows above the header (account details some banks put first) */
  skipRows: z.number().int().min(0).max(1000),
  /** Column header → what it holds */
  columns: z
    .record(z.string().max(200), z.enum(COLUMN_ROLES))
    .refine((c) => Object.keys(c).length <= 200, 'Too many columns'),
  dateFormat: z.enum(['mdy', 'dmy', 'ymd']).nullable(),
  numberFormat: z.enum(['dot', 'comma']).nullable(),
  /** What the direction column says for money going out, if not a word FlyBudget knows */
  outWord: z.string().trim().max(50).nullable(),
});

export type ImportSettings = z.infer<typeof importSettingsSchema>;

/** Stored settings, or null if there are none or they don't fit the current shape */
export function readImportSettings(stored: string | null): ImportSettings | null {
  if (!stored) return null;
  try {
    const parsed = importSettingsSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
