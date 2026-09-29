import { Router } from 'express';
import { db } from '../db/index.js';
import { accounts, budgetMonths, categories, categoryGroups, transactions } from '../db/schema.js';
import { eq, and, gte, lte, lt, sql, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { monthBounds } from '../utils/date.js';
import { isMonth } from '../utils/validation.js';

export const budgetRouter = Router();

const cents = z.number().int().min(-1e13).max(1e13);
const upsertSchema = z.object({ budgeted: cents });

// The budget only counts money in on-budget accounts: a categorized dividend in an
// off-budget brokerage account isn't money to budget
const onBudgetAccountIds = db
  .select({ id: accounts.id })
  .from(accounts)
  .where(eq(accounts.isOffBudget, 0));
const onBudget = inArray(transactions.accountId, onBudgetAccountIds);

// Every route here takes a YYYY-MM month
budgetRouter.param('month', (_req, res, next, month) => {
  if (!isMonth(month)) return res.status(400).json({ error: 'Expected a month as YYYY-MM' });
  next();
});

budgetRouter.get('/:month', (req, res) => {
  const { month } = req.params;
  const { from, to } = monthBounds(month);

  const groups = db.select().from(categoryGroups).orderBy(categoryGroups.sortOrder).all();
  const cats = db.select().from(categories).orderBy(categories.sortOrder).all();
  const budgeted = db.select().from(budgetMonths).where(eq(budgetMonths.month, month)).all();

  const spentRows = db
    .select({
      categoryId: transactions.categoryId,
      spent: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(and(gte(transactions.date, from), lte(transactions.date, to), onBudget))
    .groupBy(transactions.categoryId)
    .all();

  const priorBudgetedRows = db
    .select({
      categoryId: budgetMonths.categoryId,
      total: sql<number>`coalesce(sum(${budgetMonths.budgeted}), 0)`,
    })
    .from(budgetMonths)
    .where(lt(budgetMonths.month, month))
    .groupBy(budgetMonths.categoryId)
    .all();

  const priorActivityRows = db
    .select({
      categoryId: transactions.categoryId,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(and(lt(transactions.date, from), onBudget))
    .groupBy(transactions.categoryId)
    .all();

  const spentMap = Object.fromEntries(spentRows.map((r) => [r.categoryId, r.spent]));
  const budgetMap = Object.fromEntries(budgeted.map((b) => [b.categoryId, b]));
  const priorBudgetMap = Object.fromEntries(priorBudgetedRows.map((r) => [r.categoryId, r.total]));
  const priorActivityMap = Object.fromEntries(
    priorActivityRows.map((r) => [r.categoryId, r.total]),
  );

  const result = groups.map((g) => ({
    ...g,
    categories: cats
      .filter((c) => c.groupId === g.id)
      .map((c) => {
        const bm = budgetMap[c.id];
        const budgetedAmt = bm?.budgeted ?? 0;
        const activity = spentMap[c.id] ?? 0;
        const carryOver = (priorBudgetMap[c.id] ?? 0) + (priorActivityMap[c.id] ?? 0);
        return {
          ...c,
          budgeted: budgetedAmt,
          spent: Math.abs(Math.min(activity, 0)),
          carryOver,
          balance: carryOver + budgetedAmt + activity,
        };
      }),
  }));

  res.json(result);
});

budgetRouter.put('/:month/:categoryId', (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { month, categoryId } = req.params;
  const existing = db
    .select()
    .from(budgetMonths)
    .where(and(eq(budgetMonths.month, month), eq(budgetMonths.categoryId, categoryId)))
    .get();

  if (existing) {
    db.update(budgetMonths)
      .set({ budgeted: parsed.data.budgeted })
      .where(eq(budgetMonths.id, existing.id))
      .run();
  } else {
    db.insert(budgetMonths)
      .values({
        id: nanoid(),
        month,
        categoryId,
        budgeted: parsed.data.budgeted,
        notes: null,
      })
      .run();
  }

  res.json({ month, categoryId, budgeted: parsed.data.budgeted });
});

const historyQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).optional().default(6),
  currentMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

budgetRouter.get('/category/:categoryId/history', (req, res) => {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { categoryId } = req.params;
  const { months } = parsed.data;

  const now = new Date();
  const currentMonth =
    parsed.data.currentMonth ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const cat = db.select().from(categories).where(eq(categories.id, categoryId)).get();
  if (!cat) return res.status(404).json({ error: 'Category not found' });

  const group = db.select().from(categoryGroups).where(eq(categoryGroups.id, cat.groupId)).get();
  const isIncome = group?.isIncome === 1;

  const endYear = parseInt(currentMonth.slice(0, 4));
  const endMon = parseInt(currentMonth.slice(5, 7)) + 1;
  const adjEndYear = endYear + Math.floor((endMon - 1) / 12);
  const adjEndMonth = ((((endMon - 1) % 12) + 12) % 12) + 1;
  const endDate = `${adjEndYear}-${String(adjEndMonth).padStart(2, '0')}-01`;

  const startYear = parseInt(currentMonth.slice(0, 4));
  const startMon = parseInt(currentMonth.slice(5, 7)) - months + 1;
  const adjustedYear = startYear + Math.floor((startMon - 1) / 12);
  const adjustedMonth = ((((startMon - 1) % 12) + 12) % 12) + 1;
  const startDate = `${adjustedYear}-${String(adjustedMonth).padStart(2, '0')}-01`;

  const amountExpr = isIncome
    ? sql<number>`coalesce(sum(max(${transactions.amount}, 0)), 0)`
    : sql<number>`coalesce(sum(abs(min(${transactions.amount}, 0))), 0)`;

  const rows = db
    .select({
      month: sql<string>`strftime('%Y-%m', ${transactions.date})`,
      amount: amountExpr,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.categoryId, categoryId),
        gte(transactions.date, startDate),
        lt(transactions.date, endDate),
        onBudget,
      ),
    )
    .groupBy(sql`strftime('%Y-%m', ${transactions.date})`)
    .orderBy(sql`strftime('%Y-%m', ${transactions.date})`)
    .all();

  const rowMap = Object.fromEntries(rows.map((r) => [r.month, r.amount]));
  const history: { month: string; amount: number }[] = [];
  let y = adjustedYear;
  let m = adjustedMonth;
  for (let i = 0; i < months; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    history.push({ month: key, amount: rowMap[key] ?? 0 });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  const total = history.reduce((s, h) => s + h.amount, 0);
  const nonZeroCount = history.filter((h) => h.amount > 0).length;
  const average = nonZeroCount > 0 ? Math.round(total / nonZeroCount) : 0;
  const lastMonthKey = history.length >= 2 ? history[history.length - 2]?.month : undefined;
  const lastMonth = lastMonthKey ? (rowMap[lastMonthKey] ?? 0) : 0;

  res.json({ categoryId, isIncome, lastMonth, average, history });
});

const bulkSchema = z.object({
  budgeted: cents,
  fromMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

budgetRouter.put('/category/:categoryId/bulk', (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { categoryId } = req.params;
  const { budgeted, fromMonth } = parsed.data;

  let y = parseInt(fromMonth.slice(0, 4));
  let m = parseInt(fromMonth.slice(5, 7));
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  for (const month of months) {
    const existing = db
      .select()
      .from(budgetMonths)
      .where(and(eq(budgetMonths.month, month), eq(budgetMonths.categoryId, categoryId)))
      .get();

    if (existing) {
      db.update(budgetMonths).set({ budgeted }).where(eq(budgetMonths.id, existing.id)).run();
    } else {
      db.insert(budgetMonths)
        .values({
          id: nanoid(),
          month,
          categoryId,
          budgeted,
          notes: null,
        })
        .run();
    }
  }

  res.json({ categoryId, budgeted, months });
});

budgetRouter.get('/:month/summary', (req, res) => {
  const { month } = req.params;
  const { from, to } = monthBounds(month);

  const incomeRow = db
    .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(
      and(
        gte(transactions.date, from),
        lte(transactions.date, to),
        eq(categoryGroups.isIncome, 1),
        onBudget,
      ),
    )
    .get();

  const budgetedRow = db
    .select({ total: sql<number>`coalesce(sum(${budgetMonths.budgeted}), 0)` })
    .from(budgetMonths)
    .innerJoin(categories, eq(budgetMonths.categoryId, categories.id))
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(eq(budgetMonths.month, month), eq(categoryGroups.isIncome, 0)))
    .get();

  const priorIncomeRow = db
    .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(lt(transactions.date, from), eq(categoryGroups.isIncome, 1), onBudget))
    .get();

  const priorBudgetedRow = db
    .select({ total: sql<number>`coalesce(sum(${budgetMonths.budgeted}), 0)` })
    .from(budgetMonths)
    .innerJoin(categories, eq(budgetMonths.categoryId, categories.id))
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(lt(budgetMonths.month, month), eq(categoryGroups.isIncome, 0)))
    .get();

  // tbb = income + leftover from prior months - what's already budgeted
  const income = incomeRow?.total ?? 0;
  const totalBudgeted = budgetedRow?.total ?? 0;
  const carryOver = (priorIncomeRow?.total ?? 0) - (priorBudgetedRow?.total ?? 0);

  res.json({
    month,
    income,
    totalBudgeted,
    carryOver,
    toBeBudgeted: income + carryOver - totalBudgeted,
  });
});
