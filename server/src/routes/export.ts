import express, { Router } from 'express';
import { db } from '../db/index.js';
import { accounts, categories, transactions } from '../db/schema.js';
import {
  InvalidBackupError,
  createBackup,
  parseBackup,
  restoreBackup,
  saveSafetyCopy,
} from '../services/backupService.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { isRealDate } from '../utils/validation.js';
import { minorUnits } from '../utils/currencies.js';
import { minorToDecimal } from '../utils/money.js';
import { budgetCurrency, hasForeignAccounts } from '../services/mainAmountService.js';

export const exportRouter = Router();

export const RESTORE_PATH = '/api/export/restore';
const RESTORE_BODY_LIMIT = '250mb';

/**
 * Quotes a text cell for CSV. Payee names and notes can come from banks and
 * merchants, so cells that a spreadsheet would treat as a formula (=, +, -, @,
 * tab, CR) are prefixed with an apostrophe to block CSV formula injection
 * (https://owasp.org/www-community/attacks/CSV_Injection). Cells holding the column
 * separator (`,`, or `;` in files with a decimal comma) are quoted.
 */
export function escapeCsv(val: string | null | undefined, separator: ',' | ';' = ','): string {
  if (val == null) return '';
  let s = String(val);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/["\n\r]/.test(s) || s.includes(separator)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * An amount as a CSV amount, exactly: -1234.56, or -1234,56 with a decimal comma (with the
 * currency's own decimals: 1234 yen, 12.345 dinars)
 */
export function csvAmount(cents: number, decimal: '.' | ',', minor = 2): string {
  return minorToDecimal(cents, minor).replace('.', decimal);
}

// How the file writes amounts: `comma` for spreadsheets in languages with a decimal comma,
// which then expect `;` between columns. Without it, the old `12.50` with commas.
const csvFormatSchema = z.enum(['dot', 'comma']).default('dot');

exportRouter.get('/transactions/csv', (req, res) => {
  const { from, to } = req.query;
  const decimalFormat = csvFormatSchema.safeParse(req.query.decimal);
  if (!decimalFormat.success) {
    return res.status(400).json({ error: 'Expected `decimal` to be dot or comma' });
  }
  const [sep, decimal] =
    decimalFormat.data === 'comma' ? ([';', ','] as const) : ([',', '.'] as const);
  if (
    (from !== undefined && !isRealDate(String(from))) ||
    (to !== undefined && !isRealDate(String(to)))
  ) {
    return res.status(400).json({ error: 'Expected `from` and `to` as YYYY-MM-DD' });
  }
  // A split is exported as its parts (which carry the categories), so amounts add up
  const filters = [eq(transactions.isParent, 0)];
  if (typeof from === 'string') filters.push(gte(transactions.date, from));
  if (typeof to === 'string') filters.push(lte(transactions.date, to));

  const rows = db
    .select({
      date: transactions.date,
      amount: transactions.amount,
      payeeName: transactions.payeeName,
      notes: transactions.notes,
      reconciled: transactions.reconciled,
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
      mainAmount: transactions.mainAmount,
      mainAmountSource: transactions.mainAmountSource,
    })
    .from(transactions)
    .where(and(...filters))
    .orderBy(transactions.date)
    .all();

  const accountRows = db.select().from(accounts).all();
  const accts = Object.fromEntries(accountRows.map((a) => [a.id, a.name]));
  // With accounts in other currencies, each row says its currency and its budget value
  const budget = budgetCurrency();
  const multi = hasForeignAccounts();
  const currencyOf = Object.fromEntries(accountRows.map((a) => [a.id, a.currency ?? budget]));
  const cats = Object.fromEntries(
    db
      .select()
      .from(categories)
      .all()
      .map((c) => [c.id, c.name]),
  );

  const columns = ['Date', 'Account', 'Payee', 'Category', 'Notes', 'Amount'];
  if (multi) columns.push('Currency', `Amount (${budget})`);
  const header = `${[...columns, 'Reconciled'].join(sep)}\n`;
  const body = rows
    .map((r) => {
      const currency = currencyOf[r.accountId] ?? null;
      const value = r.mainAmountSource === 'missing' ? null : (r.mainAmount ?? r.amount);
      return [
        r.date,
        escapeCsv(accts[r.accountId] ?? '', sep),
        escapeCsv(r.payeeName, sep),
        escapeCsv(r.categoryId ? (cats[r.categoryId] ?? '') : '', sep),
        escapeCsv(r.notes, sep),
        csvAmount(r.amount, decimal, minorUnits(currency)),
        ...(multi
          ? [currency ?? '', value === null ? '' : csvAmount(value, decimal, minorUnits(budget))]
          : []),
        r.reconciled ? 'Yes' : 'No',
      ].join(sep);
    })
    .join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.send(header + body);
});

exportRouter.get('/backup', (_req, res) => {
  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="budget-backup-${dateStr}.json"`);
  res.json(createBackup());
});

// Replaces everything with a backup. A backup can be much bigger than other requests
// (every transaction, plus logos), so this route parses its own body; index.ts skips
// the general 10 MB parser for it. It runs after the login check like every route here.
exportRouter.post('/restore', express.json({ limit: RESTORE_BODY_LIMIT }), async (req, res) => {
  let data;
  try {
    data = parseBackup(req.body);
  } catch (err) {
    if (err instanceof InvalidBackupError) return res.status(400).json({ error: err.message });
    throw err;
  }
  const safetyCopy = await saveSafetyCopy();
  try {
    const restored = restoreBackup(data);
    res.json({ restored, safetyCopy });
  } catch (err) {
    // e.g. a row pointing at an account that isn't in the file: nothing was changed
    console.error('Restore failed:', err);
    res.status(400).json({ error: 'The backup is inconsistent, so nothing was restored' });
  }
});
