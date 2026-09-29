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
import { isRealDate } from '../utils/validation.js';

export const exportRouter = Router();

export const RESTORE_PATH = '/api/export/restore';
const RESTORE_BODY_LIMIT = '250mb';

/**
 * Quotes a text cell for CSV. Payee names and notes can come from banks and
 * merchants, so cells that a spreadsheet would treat as a formula (=, +, -, @,
 * tab, CR) are prefixed with an apostrophe to block CSV formula injection
 * (https://owasp.org/www-community/attacks/CSV_Injection).
 */
export function escapeCsv(val: string | null | undefined): string {
  if (val == null) return '';
  let s = String(val);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

exportRouter.get('/transactions/csv', (req, res) => {
  const { from, to } = req.query;
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
    })
    .from(transactions)
    .where(and(...filters))
    .orderBy(transactions.date)
    .all();

  const accts = Object.fromEntries(
    db
      .select()
      .from(accounts)
      .all()
      .map((a) => [a.id, a.name]),
  );
  const cats = Object.fromEntries(
    db
      .select()
      .from(categories)
      .all()
      .map((c) => [c.id, c.name]),
  );

  const header = 'Date,Account,Payee,Category,Notes,Amount,Reconciled\n';
  const body = rows
    .map((r) =>
      [
        r.date,
        escapeCsv(accts[r.accountId] ?? ''),
        escapeCsv(r.payeeName),
        escapeCsv(r.categoryId ? (cats[r.categoryId] ?? '') : ''),
        escapeCsv(r.notes),
        (r.amount / 100).toFixed(2),
        r.reconciled ? 'Yes' : 'No',
      ].join(','),
    )
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
