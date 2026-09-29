import { and, eq } from 'drizzle-orm';
import { addDays, format } from 'date-fns';
import { db } from '../db/index.js';
import {
  accounts,
  budgetMonths,
  categories,
  categoryGroups,
  customReports,
  dashboardPages,
  dashboardWidgets,
  goals,
  payees,
  rules,
  scheduleOccurrences,
  schedules,
  transactions,
} from '../db/schema.js';
import { ensureOccurrencesForAll } from '../services/scheduleService.js';
import { linkOccurrenceToTransaction } from '../services/matchingEngine.js';
import { buildDemoBudget } from './demoBudget.js';

/** Rows per INSERT: SQLite allows 32,766 bound values, and transactions have ~17 columns */
const CHUNK = 500;

/**
 * Fills an empty database with the demo budget, dated relative to `today`. Used by the
 * in-browser demo (server/src/browser) and `npm run db:seed-demo`.
 */
export function loadDemoBudget(today: Date): void {
  const demo = buildDemoBudget(today);

  db.transaction((tx) => {
    const insert = <T extends Parameters<typeof tx.insert>[0]>(
      table: T,
      rows: T['$inferInsert'][],
    ) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        tx.insert(table)
          .values(rows.slice(i, i + CHUNK))
          .run();
      }
    };
    // Parents before the rows that point at them
    insert(categoryGroups, demo.categoryGroups);
    insert(categories, demo.categories);
    insert(accounts, demo.accounts);
    insert(payees, demo.payees);
    insert(schedules, demo.schedules);
    insert(transactions, demo.transactions);
    insert(budgetMonths, demo.budgetMonths);
    insert(rules, demo.rules);
    insert(customReports, demo.customReports);
    insert(dashboardPages, demo.dashboardPages);
    insert(dashboardWidgets, demo.dashboardWidgets);
    insert(goals, demo.goals);
  });

  // Recurring items get their occurrences the way the app makes them (three months ahead,
  // like the server's startup task), then past ones are marked paid or skipped
  ensureOccurrencesForAll(format(addDays(today, 90), 'yyyy-MM-dd'));
  for (const link of demo.scheduleLinks) {
    const occurrence = db
      .select({ id: scheduleOccurrences.id })
      .from(scheduleOccurrences)
      .where(
        and(
          eq(scheduleOccurrences.scheduleId, link.scheduleId),
          eq(scheduleOccurrences.scheduledDate, link.scheduledDate),
        ),
      )
      .get();
    if (!occurrence) continue;
    if (link.transactionId) {
      linkOccurrenceToTransaction(occurrence.id, link.transactionId, 'automatic', 100);
    } else {
      db.update(scheduleOccurrences)
        .set({ status: 'skipped', skippedAt: link.scheduledDate })
        .where(eq(scheduleOccurrences.id, occurrence.id))
        .run();
    }
  }
}
