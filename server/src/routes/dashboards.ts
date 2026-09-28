import { Router } from 'express';
import { and, asc, count, eq, max } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db/index.js';
import { customReports, dashboardPages, dashboardWidgets } from '../db/schema.js';
import {
  GRID_COLS,
  WIDGET_TYPES,
  dateRangeSchema,
  ensureDefaultDashboard,
  insertWidget,
  metaSchemaFor,
  nextPosition,
} from '../services/dashboardService.js';

export const dashboardsRouter = Router();

const pageSchema = z.object({
  name: z.string().trim().min(1).max(100),
  // The range widgets on this dashboard follow unless they have their own; null = last 6 months
  dateRange: dateRangeSchema.nullable().optional(),
});

const createWidgetSchema = z.object({
  type: z.enum(WIDGET_TYPES),
  meta: z.unknown().optional(),
  customReportId: z.string().optional(),
});

const layoutSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        x: z
          .number()
          .int()
          .min(0)
          .max(GRID_COLS - 1),
        y: z.number().int().min(0).max(10_000),
        width: z.number().int().min(1).max(GRID_COLS),
        height: z.number().int().min(1).max(20),
      }),
    )
    .max(500),
});

const updateWidgetSchema = z.object({
  meta: z.unknown().optional(),
  // Moves the widget to another dashboard, placed in its first free slot
  pageId: z.string().optional(),
});

function parseWidget(w: typeof dashboardWidgets.$inferSelect) {
  return { ...w, meta: JSON.parse(w.meta) };
}

function parsePage(p: typeof dashboardPages.$inferSelect) {
  return { ...p, dateRange: p.dateRange ? JSON.parse(p.dateRange) : null };
}

function getPage(id: string) {
  return db.select().from(dashboardPages).where(eq(dashboardPages.id, id)).get();
}

dashboardsRouter.get('/', (_req, res) => {
  ensureDefaultDashboard();
  const pages = db
    .select()
    .from(dashboardPages)
    .orderBy(asc(dashboardPages.sortOrder), asc(dashboardPages.createdAt))
    .all();
  res.json(pages.map(parsePage));
});

dashboardsRouter.post('/', (req, res) => {
  const parsed = pageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const last = db
    .select({ value: max(dashboardPages.sortOrder) })
    .from(dashboardPages)
    .get();
  const { name, dateRange } = parsed.data;
  const row = {
    id: nanoid(),
    name,
    sortOrder: (last?.value ?? -1) + 1,
    dateRange: dateRange ? JSON.stringify(dateRange) : null,
  };
  db.insert(dashboardPages).values(row).run();
  res.status(201).json(parsePage(getPage(row.id)!));
});

dashboardsRouter.put('/:id', (req, res) => {
  const parsed = pageSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, dateRange } = parsed.data;
  const update: Partial<typeof dashboardPages.$inferInsert> = {};
  if (name !== undefined) update.name = name;
  if (dateRange !== undefined) update.dateRange = dateRange ? JSON.stringify(dateRange) : null;
  if (Object.keys(update).length) {
    db.update(dashboardPages).set(update).where(eq(dashboardPages.id, req.params.id)).run();
  }
  const page = getPage(req.params.id);
  if (!page) return res.status(404).json({ error: 'Not found' });
  res.json(parsePage(page));
});

dashboardsRouter.delete('/:id', (req, res) => {
  const total = db.select({ value: count() }).from(dashboardPages).get()?.value ?? 0;
  if (total <= 1) return res.status(400).json({ error: 'Cannot delete the last dashboard' });
  db.delete(dashboardPages).where(eq(dashboardPages.id, req.params.id)).run();
  res.status(204).send();
});

dashboardsRouter.get('/:id/widgets', (req, res) => {
  if (!getPage(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const rows = db
    .select()
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.pageId, req.params.id))
    .orderBy(asc(dashboardWidgets.y), asc(dashboardWidgets.x))
    .all();
  res.json(rows.map(parseWidget));
});

dashboardsRouter.post('/:id/widgets', (req, res) => {
  const parsed = createWidgetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { type, customReportId } = parsed.data;
  const meta = metaSchemaFor(type).safeParse(parsed.data.meta ?? {});
  if (!meta.success) return res.status(400).json({ error: meta.error.flatten() });
  if (!getPage(req.params.id)) return res.status(404).json({ error: 'Not found' });

  if (type === 'custom-report') {
    if (!customReportId) return res.status(400).json({ error: 'customReportId is required' });
    const report = db
      .select({ id: customReports.id })
      .from(customReports)
      .where(eq(customReports.id, customReportId))
      .get();
    if (!report) return res.status(400).json({ error: 'Unknown custom report' });
  }

  const row = db.transaction((tx) =>
    insertWidget(
      tx,
      req.params.id,
      type,
      meta.data,
      type === 'custom-report' ? customReportId! : null,
    ),
  );
  res.status(201).json(parseWidget({ ...row, createdAt: new Date().toISOString() }));
});

// Saves positions and sizes after a drag or resize. Only widgets on this page are touched.
dashboardsRouter.put('/:id/layout', (req, res) => {
  const parsed = layoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  db.transaction((tx) => {
    for (const { id, x, y, width, height } of parsed.data.items) {
      tx.update(dashboardWidgets)
        .set({ x: Math.min(x, GRID_COLS - width), y, width, height })
        .where(and(eq(dashboardWidgets.id, id), eq(dashboardWidgets.pageId, req.params.id)))
        .run();
    }
  });
  res.status(204).send();
});

dashboardsRouter.get('/widgets/:widgetId', (req, res) => {
  const widget = db
    .select()
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.id, req.params.widgetId))
    .get();
  if (!widget) return res.status(404).json({ error: 'Not found' });
  res.json(parseWidget(widget));
});

dashboardsRouter.patch('/widgets/:widgetId', (req, res) => {
  const parsed = updateWidgetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const widget = db
    .select()
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.id, req.params.widgetId))
    .get();
  if (!widget) return res.status(404).json({ error: 'Not found' });

  const update: Partial<typeof dashboardWidgets.$inferInsert> = {};
  if (parsed.data.meta !== undefined) {
    const meta = metaSchemaFor(widget.type as (typeof WIDGET_TYPES)[number]).safeParse(
      parsed.data.meta,
    );
    if (!meta.success) return res.status(400).json({ error: meta.error.flatten() });
    update.meta = JSON.stringify(meta.data);
  }
  if (parsed.data.pageId && parsed.data.pageId !== widget.pageId) {
    if (!getPage(parsed.data.pageId)) return res.status(400).json({ error: 'Unknown dashboard' });
    const existing = db
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.pageId, parsed.data.pageId))
      .all();
    update.pageId = parsed.data.pageId;
    Object.assign(update, nextPosition(existing, widget));
  }
  if (Object.keys(update).length) {
    db.update(dashboardWidgets).set(update).where(eq(dashboardWidgets.id, widget.id)).run();
  }
  const updated = db
    .select()
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.id, widget.id))
    .get()!;
  res.json(parseWidget(updated));
});

dashboardsRouter.delete('/widgets/:widgetId', (req, res) => {
  db.delete(dashboardWidgets).where(eq(dashboardWidgets.id, req.params.widgetId)).run();
  res.status(204).send();
});
