import { asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db/index.js';
import { customReports, dashboardPages, dashboardWidgets } from '../db/schema.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const DATE_PRESETS = ['1m', '3m', '6m', '12m', 'ytd', 'last-year', 'all', 'custom'] as const;

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

// Shared by widgets and custom reports. `preset: 'custom'` is a frozen range: `from`/`to`
// are used as-is. Any other preset is live and the client recomputes it from today.
export const dateRangeSchema = z
  .object({ preset: z.enum(DATE_PRESETS), from: month, to: month })
  .refine((r) => r.from <= r.to, { message: '`from` must not be after `to`' });

export const WIDGET_TYPES = [
  'summary',
  'net-worth',
  'income-expenses',
  'spending',
  'spending-trends',
  'calendar',
  'custom-report',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

// A widget without `dateRange` follows its dashboard's range. With one, it has its own range:
// a live preset, or frozen months that no dashboard change affects.
const builtinMetaSchema = z.object({
  name: z.string().trim().max(100).optional(),
  dateRange: dateRangeSchema.optional(),
  // Spending Trends: the categories to chart. Without it, the biggest spending categories
  categoryIds: z.array(z.string().min(1).max(64)).min(1).max(5).optional(),
});
// Custom report widgets take their name from the report itself
const customReportMetaSchema = z.object({ dateRange: dateRangeSchema.optional() });

export function metaSchemaFor(type: WidgetType) {
  return type === 'custom-report' ? customReportMetaSchema : builtinMetaSchema;
}

export const GRID_COLS = 12;
export const DEFAULT_SIZE: Record<WidgetType, { width: number; height: number }> = {
  summary: { width: 12, height: 1 },
  'net-worth': { width: 6, height: 4 },
  'income-expenses': { width: 6, height: 4 },
  spending: { width: 6, height: 4 },
  'spending-trends': { width: 6, height: 4 },
  calendar: { width: 6, height: 4 },
  'custom-report': { width: 6, height: 4 },
};

type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The first free slot, scanning top-to-bottom then left-to-right, that fits `size`. */
export function nextPosition(existing: Rect[], size: { width: number; height: number }) {
  const bottom = Math.max(0, ...existing.map((w) => w.y + w.height));
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + size.width <= GRID_COLS; x++) {
      const rect = { x, y, width: size.width, height: size.height };
      if (!existing.some((w) => overlaps(w, rect))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

export function insertWidget(
  tx: Tx,
  pageId: string,
  type: WidgetType,
  meta: object,
  customReportId: string | null = null,
) {
  const size = DEFAULT_SIZE[type];
  const existing = tx
    .select({
      x: dashboardWidgets.x,
      y: dashboardWidgets.y,
      width: dashboardWidgets.width,
      height: dashboardWidgets.height,
    })
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.pageId, pageId))
    .all();
  const row = {
    id: nanoid(),
    pageId,
    type,
    customReportId,
    ...nextPosition(existing, size),
    ...size,
    meta: JSON.stringify(meta),
  };
  tx.insert(dashboardWidgets).values(row).run();
  return row;
}

/**
 * The first visit to Reports gets an "Overview" dashboard with the built-in reports and every
 * saved custom report, matching what the page showed before dashboards existed.
 */
export function ensureDefaultDashboard() {
  db.transaction((tx) => {
    if (tx.select({ id: dashboardPages.id }).from(dashboardPages).limit(1).get()) return;
    const pageId = nanoid();
    tx.insert(dashboardPages).values({ id: pageId, name: 'Overview', sortOrder: 0 }).run();
    for (const type of [
      'summary',
      'net-worth',
      'income-expenses',
      'spending',
      'spending-trends',
      'calendar',
    ] as const) {
      insertWidget(tx, pageId, type, {});
    }
    const reports = tx
      .select({ id: customReports.id })
      .from(customReports)
      .orderBy(asc(customReports.sortOrder), asc(customReports.createdAt))
      .all();
    for (const r of reports) insertWidget(tx, pageId, 'custom-report', {}, r.id);
  });
}

/** Adds a widget for a newly saved custom report to `pageId`, or the first dashboard. */
export function addCustomReportWidget(tx: Tx, reportId: string, pageId?: string) {
  const page =
    (pageId &&
      tx
        .select({ id: dashboardPages.id })
        .from(dashboardPages)
        .where(eq(dashboardPages.id, pageId))
        .get()) ||
    tx
      .select({ id: dashboardPages.id })
      .from(dashboardPages)
      .orderBy(asc(dashboardPages.sortOrder), asc(dashboardPages.createdAt))
      .get();
  if (page) insertWidget(tx, page.id, 'custom-report', {}, reportId);
}
