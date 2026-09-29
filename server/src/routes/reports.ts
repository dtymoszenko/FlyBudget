import { Router } from 'express';
import { db } from '../db/index.js';
import { transactions, accounts, categories, categoryGroups, payees } from '../db/schema.js';
import { eq, and, gte, lte, sql, inArray, lt, isNull } from 'drizzle-orm';
import { monthBounds } from '../utils/date.js';
import { isLiabilityType } from '../utils/accountTypes.js';

export const reportsRouter = Router();

function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  let y = fy,
    m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

export function dayRange(from: string, to: string): string[] {
  const days: string[] = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) {
    // Local date parts: toISOString() is UTC, which is the previous day east of UTC
    days.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
    d.setDate(d.getDate() + 1);
  }
  return days;
}

reportsRouter.get('/net-worth', (req, res) => {
  let {
    from = '2024-01',
    to = '2026-12',
    granularity = 'monthly',
  } = req.query as Record<string, string>;
  const isDaily = granularity === 'daily';

  const earliest = db
    .select({ d: sql<string>`min(${transactions.date})` })
    .from(transactions)
    .get();
  if (earliest?.d) {
    const minPeriod = isDaily ? earliest.d : earliest.d.slice(0, 7);
    if (from < minPeriod) from = minPeriod;
  }

  const periods = isDaily ? dayRange(from, to) : monthRange(from, to);

  const allAccounts = db.select().from(accounts).all();

  const upperBound = isDaily ? to : monthBounds(to).to;
  const groupExpr = isDaily
    ? sql<string>`${transactions.date}`
    : sql<string>`strftime('%Y-%m', ${transactions.date})`;

  const txRows = db
    .select({
      accountId: transactions.accountId,
      period: groupExpr,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(lte(transactions.date, upperBound))
    .groupBy(transactions.accountId, groupExpr)
    .all();

  const byAccount: Record<string, Array<{ period: string; total: number }>> = {};
  for (const row of txRows) {
    (byAccount[row.accountId] ??= []).push({ period: row.period, total: row.total });
  }

  const cumulativeByAccount: Record<string, Record<string, number>> = {};
  for (const acct of allAccounts) {
    const entries = (byAccount[acct.id] ?? []).sort((a, b) => a.period.localeCompare(b.period));
    let running = acct.startingBalance;
    const cumMap: Record<string, number> = {};
    for (const { period, total } of entries) {
      running += total;
      cumMap[period] = running;
    }
    cumulativeByAccount[acct.id] = cumMap;
  }

  function balanceAt(acctId: string, target: string, startingBalance: number): number {
    const cumMap = cumulativeByAccount[acctId] ?? {};
    let balance = startingBalance;
    for (const k of Object.keys(cumMap).sort()) {
      if (k > target) break;
      balance = cumMap[k];
    }
    return balance;
  }

  const result = periods.map((period) => {
    let assets = 0,
      liabilities = 0;
    for (const acct of allAccounts) {
      const balance = balanceAt(acct.id, period, acct.startingBalance);
      if (isLiabilityType(acct.type)) liabilities += Math.abs(Math.min(balance, 0));
      else assets += Math.max(balance, 0);
    }
    return { month: period, assets, liabilities, netWorth: assets - liabilities };
  });

  res.json(result);
});

reportsRouter.get('/spending-by-category', (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  // Only real spending: a split's parent row (its children carry the categories) and transfers
  // have no category and would otherwise show up as "Uncategorized"; income categories aren't spending
  const conditions = [
    eq(transactions.isParent, 0),
    isNull(transactions.transferTransactionId),
    sql`coalesce(${categoryGroups.isIncome}, 0) = 0`,
  ];
  if (from) conditions.push(gte(transactions.date, monthBounds(from).from));
  if (to) conditions.push(lte(transactions.date, monthBounds(to).to));

  const rows = db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      groupId: categoryGroups.id,
      groupName: categoryGroups.name,
      totalSpent: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(...conditions))
    .groupBy(transactions.categoryId)
    .all();

  res.json(
    rows.filter((r) => r.totalSpent < 0).map((r) => ({ ...r, totalSpent: Math.abs(r.totalSpent) })),
  );
});

reportsRouter.get('/income-vs-expenses', (req, res) => {
  const { from = '2024-01', to = '2026-12' } = req.query as Record<string, string>;
  const months = monthRange(from, to);

  // Single query grouped by month + isIncome
  const txRows = db
    .select({
      month: sql<string>`strftime('%Y-%m', ${transactions.date})`,
      isIncome: categoryGroups.isIncome,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
      outflowCount: sql<number>`sum(case when ${transactions.amount} < 0 then 1 else 0 end)`,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(
      and(
        gte(transactions.date, monthBounds(from).from),
        lte(transactions.date, monthBounds(to).to),
      ),
    )
    .groupBy(sql`strftime('%Y-%m', ${transactions.date})`, categoryGroups.isIncome)
    .all();

  type MonthData = { income: number; expenses: number; expenseNet: number; expenseCount: number };
  const empty = (): MonthData => ({ income: 0, expenses: 0, expenseNet: 0, expenseCount: 0 });
  const dataMap: Record<string, MonthData> = {};
  for (const row of txRows) {
    dataMap[row.month] ??= empty();
    if (row.isIncome === 1) dataMap[row.month].income += row.total;
    else {
      dataMap[row.month].expenses += Math.abs(Math.min(row.total, 0));
      dataMap[row.month].expenseNet += row.total;
      dataMap[row.month].expenseCount += row.outflowCount ?? 0;
    }
  }

  const result = months.map((month) => {
    const d = dataMap[month] ?? empty();
    return {
      month,
      income: d.income,
      expenses: d.expenses,
      net: d.income - d.expenses,
      expenseNet: d.expenseNet,
      expenseCount: d.expenseCount,
    };
  });

  res.json(result);
});

reportsRouter.get('/cash-flow', (req, res) => {
  const { from = '2024-01', to = '2026-12' } = req.query as Record<string, string>;
  const months = monthRange(from, to);

  // Single query grouped by month
  const txRows = db
    .select({
      month: sql<string>`strftime('%Y-%m', ${transactions.date})`,
      net: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        gte(transactions.date, monthBounds(from).from),
        lte(transactions.date, monthBounds(to).to),
        eq(accounts.isOffBudget, 0),
      ),
    )
    .groupBy(sql`strftime('%Y-%m', ${transactions.date})`)
    .all();

  const netMap = Object.fromEntries(txRows.map((r) => [r.month, r.net]));
  res.json(months.map((month) => ({ month, net: netMap[month] ?? 0 })));
});

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// Money in and out per day, for the transaction calendar. Like cash flow it covers budget
// accounts only, and leaves out transfers; a split counts once, through its parts.
reportsRouter.get('/daily-flow', (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  if (!MONTH.test(from ?? '') || !MONTH.test(to ?? '') || from > to) {
    return res.status(400).json({ error: 'Expected `from` and `to` as YYYY-MM' });
  }
  const rows = db
    .select({
      date: transactions.date,
      income: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
      expenses: sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`,
      count: sql<number>`count(distinct coalesce(${transactions.parentTransactionId}, ${transactions.id}))`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        gte(transactions.date, monthBounds(from).from),
        lte(transactions.date, monthBounds(to).to),
        eq(accounts.isOffBudget, 0),
        eq(transactions.isParent, 0),
        isNull(transactions.transferTransactionId),
      ),
    )
    .groupBy(transactions.date)
    .orderBy(transactions.date)
    .all();
  res.json(rows);
});

reportsRouter.get('/income-by-category', (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  const conditions = [eq(categoryGroups.isIncome, 1)];
  if (from) conditions.push(gte(transactions.date, monthBounds(from).from));
  if (to) conditions.push(lte(transactions.date, monthBounds(to).to));

  const rows = db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      groupId: categoryGroups.id,
      groupName: categoryGroups.name,
      totalReceived: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(...conditions))
    .groupBy(transactions.categoryId)
    .all();

  res.json(rows.filter((r) => r.totalReceived > 0));
});

reportsRouter.get('/spending-trends', (req, res) => {
  const { category_ids, from, to, granularity } = req.query as Record<string, string>;
  if (!category_ids) return res.json([]);

  const ids = category_ids.split(',');
  const conditions = [];
  if (from) conditions.push(gte(transactions.date, monthBounds(from).from));
  if (to) conditions.push(lte(transactions.date, monthBounds(to).to));
  // Daily totals (for short ranges) put the date (yyyy-MM-dd) in `month`
  const period =
    granularity === 'daily'
      ? sql<string>`${transactions.date}`
      : sql<string>`strftime('%Y-%m', ${transactions.date})`;

  const rows = db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      month: period,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(transactions.categoryId, period)
    .all();

  res.json(
    rows
      .filter((r) => r.categoryId && ids.includes(r.categoryId) && r.total < 0)
      .map((r) => ({ ...r, total: Math.abs(r.total) })),
  );
});

// --------------- Spending comparison endpoint ---------------

reportsRouter.get('/spending-comparison', (req, res) => {
  const { mode = 'month_vs_last_month' } = req.query as Record<string, string>;
  const today = new Date();

  function fmtDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getDailyExpenses(from: string, to: string): Map<string, number> {
    const rows = db
      .select({
        date: transactions.date,
        total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(
        and(lt(transactions.amount, 0), gte(transactions.date, from), lte(transactions.date, to)),
      )
      .groupBy(transactions.date)
      .all();
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.date, Math.abs(row.total));
    return map;
  }

  function buildCumulative(
    dailyMap: Map<string, number>,
    dayMapper: (dateStr: string) => number,
    totalDays: number,
  ): { day: number; cumulative: number }[] {
    const dayTotals = new Map<number, number>();
    for (const [dateStr, amount] of dailyMap) {
      const day = dayMapper(dateStr);
      if (day >= 1 && day <= totalDays) dayTotals.set(day, (dayTotals.get(day) || 0) + amount);
    }
    const result: { day: number; cumulative: number }[] = [];
    let cum = 0;
    for (let day = 1; day <= totalDays; day++) {
      cum += dayTotals.get(day) || 0;
      result.push({ day, cumulative: cum });
    }
    return result;
  }

  const todayStr = fmtDate(today);
  const dayOfMonth = (s: string) => parseInt(s.slice(8, 10), 10);
  const dayOfYear = (s: string) => {
    const d = new Date(s + 'T00:00:00');
    const jan1 = new Date(d.getFullYear(), 0, 1);
    return Math.floor((d.getTime() - jan1.getTime()) / 86400000) + 1;
  };

  let currentLabel: string, comparisonLabel: string, periodLabel: string;
  let currentSeries: { day: number; cumulative: number }[];
  let comparisonSeries: { day: number; cumulative: number }[];
  let maxDays: number, todayDay: number, currentTotal: number;

  switch (mode) {
    case 'week_vs_last_week': {
      const dow = today.getDay();
      const mondayOffset = dow === 0 ? 6 : dow - 1;
      const monday = new Date(today);
      monday.setDate(today.getDate() - mondayOffset);
      const lastMonday = new Date(monday);
      lastMonday.setDate(monday.getDate() - 7);
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);

      const dayOfWeek = (s: string) => {
        const w = new Date(s + 'T00:00:00').getDay();
        return w === 0 ? 7 : w;
      };

      maxDays = 7;
      todayDay = mondayOffset + 1;
      periodLabel = 'this week';
      currentLabel = 'This week';
      comparisonLabel = 'Last week';

      const curDaily = getDailyExpenses(fmtDate(monday), todayStr);
      const compDaily = getDailyExpenses(fmtDate(lastMonday), fmtDate(lastSunday));
      currentSeries = buildCumulative(curDaily, dayOfWeek, todayDay);
      comparisonSeries = buildCumulative(compDaily, dayOfWeek, maxDays);
      currentTotal =
        currentSeries.length > 0 ? currentSeries[currentSeries.length - 1].cumulative : 0;
      break;
    }

    case 'month_vs_last_year': {
      const year = today.getFullYear();
      const month = today.getMonth();
      const mm = String(month + 1).padStart(2, '0');
      const daysInCur = new Date(year, month + 1, 0).getDate();
      const lastYear = year - 1;
      const daysInComp = new Date(lastYear, month + 1, 0).getDate();

      maxDays = Math.max(daysInCur, daysInComp);
      todayDay = today.getDate();
      periodLabel = 'this month';
      currentLabel = 'This month';
      const monthNames = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      comparisonLabel = `${monthNames[month]} ${lastYear}`;

      const curDaily = getDailyExpenses(`${year}-${mm}-01`, todayStr);
      const compDaily = getDailyExpenses(
        `${lastYear}-${mm}-01`,
        `${lastYear}-${mm}-${String(daysInComp).padStart(2, '0')}`,
      );
      currentSeries = buildCumulative(curDaily, dayOfMonth, todayDay);
      comparisonSeries = buildCumulative(compDaily, dayOfMonth, maxDays);
      currentTotal =
        currentSeries.length > 0 ? currentSeries[currentSeries.length - 1].cumulative : 0;
      break;
    }

    case 'month_vs_average': {
      const year = today.getFullYear();
      const month = today.getMonth();
      const mm = String(month + 1).padStart(2, '0');
      const daysInCur = new Date(year, month + 1, 0).getDate();

      const monthsInfo: { days: number }[] = [];
      let rangeFrom = '',
        rangeTo = '';
      for (let i = 1; i <= 12; i++) {
        const d = new Date(year, month - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth();
        const days = new Date(y, m + 1, 0).getDate();
        const mStr = String(m + 1).padStart(2, '0');
        const f = `${y}-${mStr}-01`;
        const t = `${y}-${mStr}-${String(days).padStart(2, '0')}`;
        if (i === 12) rangeFrom = f;
        if (i === 1) rangeTo = t;
        monthsInfo.push({ days });
      }

      const allDaily = getDailyExpenses(rangeFrom, rangeTo);
      const dayTotals = new Map<number, number>();
      for (const [dateStr, amount] of allDaily) {
        const day = dayOfMonth(dateStr);
        dayTotals.set(day, (dayTotals.get(day) || 0) + amount);
      }
      const monthsWithDay = (day: number) => monthsInfo.filter((m) => m.days >= day).length;

      maxDays = Math.max(daysInCur, 31);
      todayDay = today.getDate();
      periodLabel = 'this month';
      currentLabel = 'This month';
      comparisonLabel = 'Average month (last 12 months)';

      comparisonSeries = [];
      let cum = 0;
      for (let day = 1; day <= maxDays; day++) {
        const count = monthsWithDay(day);
        cum += count > 0 ? Math.round((dayTotals.get(day) || 0) / count) : 0;
        comparisonSeries.push({ day, cumulative: cum });
      }

      const curDaily = getDailyExpenses(`${year}-${mm}-01`, todayStr);
      currentSeries = buildCumulative(curDaily, dayOfMonth, todayDay);
      currentTotal =
        currentSeries.length > 0 ? currentSeries[currentSeries.length - 1].cumulative : 0;
      break;
    }

    case 'year_vs_last_year': {
      const year = today.getFullYear();
      const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      const daysThisYear = isLeap(year) ? 366 : 365;
      const daysLastYear = isLeap(year - 1) ? 366 : 365;
      maxDays = Math.max(daysThisYear, daysLastYear);

      const jan1 = new Date(year, 0, 1);
      todayDay = Math.floor((today.getTime() - jan1.getTime()) / 86400000) + 1;
      periodLabel = 'this year';
      currentLabel = 'This year';
      comparisonLabel = 'Last year';

      const curDaily = getDailyExpenses(`${year}-01-01`, todayStr);
      const compDaily = getDailyExpenses(`${year - 1}-01-01`, `${year - 1}-12-31`);
      currentSeries = buildCumulative(curDaily, dayOfYear, todayDay);
      comparisonSeries = buildCumulative(compDaily, dayOfYear, maxDays);
      currentTotal =
        currentSeries.length > 0 ? currentSeries[currentSeries.length - 1].cumulative : 0;
      break;
    }

    default: {
      const year = today.getFullYear();
      const month = today.getMonth();
      const mm = String(month + 1).padStart(2, '0');
      const daysInCur = new Date(year, month + 1, 0).getDate();
      const prevDate = new Date(year, month - 1, 1);
      const pY = prevDate.getFullYear();
      const pM = prevDate.getMonth();
      const daysInPrev = new Date(pY, pM + 1, 0).getDate();
      const pmm = String(pM + 1).padStart(2, '0');

      maxDays = Math.max(daysInCur, daysInPrev);
      todayDay = today.getDate();
      periodLabel = 'this month';
      currentLabel = 'This month';
      comparisonLabel = 'Last month';

      const curDaily = getDailyExpenses(`${year}-${mm}-01`, todayStr);
      const compDaily = getDailyExpenses(
        `${pY}-${pmm}-01`,
        `${pY}-${pmm}-${String(daysInPrev).padStart(2, '0')}`,
      );
      currentSeries = buildCumulative(curDaily, dayOfMonth, todayDay);
      comparisonSeries = buildCumulative(compDaily, dayOfMonth, maxDays);
      currentTotal =
        currentSeries.length > 0 ? currentSeries[currentSeries.length - 1].cumulative : 0;
      break;
    }
  }

  res.json({
    currentTotal,
    periodLabel,
    currentLabel,
    comparisonLabel,
    maxDays,
    todayDay,
    current: currentSeries,
    comparison: comparisonSeries,
  });
});

// --------------- Custom report aggregation endpoint ---------------

reportsRouter.get('/custom', (req, res) => {
  const {
    mode = 'total',
    group_by = 'category',
    balance_type = 'expense',
    from = '2024-01',
    to = '2026-12',
    account_ids,
    category_ids,
    category_group_ids,
  } = req.query as Record<string, string>;

  const conditions: ReturnType<typeof eq>[] = [
    gte(transactions.date, monthBounds(from).from),
    lte(transactions.date, monthBounds(to).to),
  ];

  if (balance_type === 'expense') conditions.push(lt(transactions.amount, 0));
  else if (balance_type === 'income') conditions.push(eq(categoryGroups.isIncome, 1));

  if (account_ids) {
    const ids = account_ids.split(',').filter(Boolean);
    if (ids.length) conditions.push(inArray(transactions.accountId, ids));
  }
  if (category_ids) {
    const ids = category_ids.split(',').filter(Boolean);
    if (ids.length) conditions.push(inArray(transactions.categoryId, ids));
  }
  if (category_group_ids) {
    const ids = category_group_ids.split(',').filter(Boolean);
    if (ids.length) conditions.push(inArray(categories.groupId, ids));
  }

  const groupByCol = {
    category: {
      name: categories.name,
      id: transactions.categoryId,
      groupCol: transactions.categoryId,
    },
    categoryGroup: {
      name: categoryGroups.name,
      id: categories.groupId,
      groupCol: categories.groupId,
    },
    payee: {
      name: sql<string>`coalesce(${payees.name}, ${transactions.payeeName}, 'Unknown')`,
      id: transactions.payeeId,
      groupCol: transactions.payeeId,
    },
    account: { name: accounts.name, id: transactions.accountId, groupCol: transactions.accountId },
    month: {
      name: sql<string>`strftime('%Y-%m', ${transactions.date})`,
      id: sql<string>`strftime('%Y-%m', ${transactions.date})`,
      groupCol: sql`strftime('%Y-%m', ${transactions.date})`,
    },
  }[group_by] ?? {
    name: categories.name,
    id: transactions.categoryId,
    groupCol: transactions.categoryId,
  };

  const baseQuery = db
    .select({
      name: groupByCol.name,
      id: groupByCol.id,
      ...(mode === 'time' ? { month: sql<string>`strftime('%Y-%m', ${transactions.date})` } : {}),
      value: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .leftJoin(payees, eq(transactions.payeeId, payees.id))
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(...conditions));

  if (mode === 'time') {
    const rows = baseQuery
      .groupBy(groupByCol.groupCol, sql`strftime('%Y-%m', ${transactions.date})`)
      .orderBy(sql`strftime('%Y-%m', ${transactions.date})`)
      .all() as { name: string | null; id: string | null; month: string; value: number }[];

    const months = monthRange(from, to);
    const groupSet = new Set<string>();
    for (const r of rows) groupSet.add(r.name || 'Uncategorized');
    const groups = Array.from(groupSet).sort();

    const dataMap = new Map<string, Record<string, number>>();
    for (const m of months) dataMap.set(m, {});

    for (const r of rows) {
      const label = r.name || 'Uncategorized';
      const bucket = dataMap.get(r.month);
      if (bucket) {
        const val = balance_type === 'expense' ? Math.abs(r.value) : r.value;
        bucket[label] = (bucket[label] || 0) + val;
      }
    }

    const data = months.map((m) => ({ month: m, ...dataMap.get(m)! }));
    res.json({ mode: 'time', groups, data });
  } else {
    const rows = baseQuery
      .groupBy(groupByCol.groupCol)
      .orderBy(sql`abs(sum(${transactions.amount})) desc`)
      .all() as { name: string | null; id: string | null; value: number }[];

    const data = rows
      .filter((r) => r.value !== 0)
      .map((r) => ({
        name: r.name || 'Uncategorized',
        id: r.id,
        value: balance_type === 'expense' ? Math.abs(r.value) : r.value,
      }));

    res.json({ mode: 'total', data });
  }
});
