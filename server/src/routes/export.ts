import { Router } from 'express';
import { db } from '../db/index.js';
import {
  accounts,
  categories,
  categoryGroups,
  transactions,
  budgetMonths,
  payees,
  rules,
} from '../db/schema.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import { z } from 'zod';

export const exportRouter = Router();

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
  const filters = [];
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
    .where(filters.length ? and(...filters) : undefined)
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
  const data = {
    exportedAt: new Date().toISOString(),
    accounts: db.select().from(accounts).all(),
    categoryGroups: db.select().from(categoryGroups).all(),
    categories: db.select().from(categories).all(),
    payees: db.select().from(payees).all(),
    transactions: db.select().from(transactions).all(),
    budgetMonths: db.select().from(budgetMonths).all(),
    rules: db.select().from(rules).all(),
  };

  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="budget-backup-${dateStr}.json"`);
  res.json(data);
});
