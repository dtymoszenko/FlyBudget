import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { readFileSync } from 'fs';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, sql as sqlRaw } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { format } from 'date-fns';
import { db } from '../db/index.js';
import { dashboardPages, dashboardWidgets } from '../db/schema.js';
import { GRID_COLS, nextPosition } from '../services/dashboardService.js';
import { customReportsRouter } from './customReports.js';
import { dashboardsRouter } from './dashboards.js';

let server: Server;
let base: string;

beforeAll(async () => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  const app = express();
  app.use(express.json());
  app.use('/api/custom-reports', customReportsRouter);
  app.use('/api/dashboards', dashboardsRouter);
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => server.close());

const call = (method: string, path: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (method: string, path: string, body?: unknown) =>
  (await call(method, path, body)).json();

const reportConfig = {
  chartType: 'bar',
  mode: 'total',
  groupBy: 'category',
  balanceType: 'expense',
  dateRange: { preset: '6m', from: '2026-04', to: '2026-09' },
  filters: { accountIds: [], categoryIds: [], categoryGroupIds: [] },
};

type Rect = { x: number; y: number; width: number; height: number };
const arbRect: fc.Arbitrary<Rect> = fc
  .record({
    width: fc.integer({ min: 1, max: GRID_COLS }),
    height: fc.integer({ min: 1, max: 6 }),
    y: fc.integer({ min: 0, max: 20 }),
    x: fc.nat(),
  })
  .map((r) => ({ ...r, x: r.x % (GRID_COLS - r.width + 1) }));

describe('nextPosition (property-based)', () => {
  it('always returns an in-bounds slot that overlaps no existing widget', () => {
    fc.assert(
      fc.property(fc.array(arbRect, { maxLength: 15 }), arbRect, (existing, size) => {
        const pos = nextPosition(existing, size);
        const placed = { ...pos, width: size.width, height: size.height };
        expect(placed.x).toBeGreaterThanOrEqual(0);
        expect(placed.x + placed.width).toBeLessThanOrEqual(GRID_COLS);
        for (const w of existing) {
          const overlap =
            placed.x < w.x + w.width &&
            w.x < placed.x + placed.width &&
            placed.y < w.y + w.height &&
            w.y < placed.y + placed.height;
          expect(overlap).toBe(false);
        }
      }),
    );
  });
});

describe('dashboards API', () => {
  it('creates one default dashboard with the built-in reports, once', async () => {
    const pages = await json('GET', '/dashboards');
    expect(pages).toHaveLength(1);
    expect(await json('GET', '/dashboards')).toHaveLength(1);
    const widgets = await json('GET', `/dashboards/${pages[0].id}/widgets`);
    expect(widgets.map((w: { type: string }) => w.type).sort()).toEqual(
      ['calendar', 'income-expenses', 'net-worth', 'spending', 'spending-trends', 'summary'].sort(),
    );
    // A new budget's reports start on this month (a live range, recomputed from today)
    const thisMonth = format(new Date(), 'yyyy-MM');
    expect((pages[0] as { dateRange: unknown }).dateRange).toEqual({
      preset: '1m',
      from: thisMonth,
      to: thisMonth,
    });
  });

  it('adds a new custom report to the chosen dashboard and removes it with the report', async () => {
    const page = await json('POST', '/dashboards', { name: 'Second' });
    const report = await json('POST', '/custom-reports', {
      name: 'Groceries',
      config: reportConfig,
      dashboardPageId: page.id,
    });
    let widgets = await json('GET', `/dashboards/${page.id}/widgets`);
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({ type: 'custom-report', customReportId: report.id });

    await call('DELETE', `/custom-reports/${report.id}`);
    widgets = await json('GET', `/dashboards/${page.id}/widgets`);
    expect(widgets).toHaveLength(0);
  });

  it('refuses to delete the last dashboard', async () => {
    const pages: { id: string }[] = await json('GET', '/dashboards');
    for (const p of pages.slice(1))
      expect((await call('DELETE', `/dashboards/${p.id}`)).status).toBe(204);
    expect((await call('DELETE', `/dashboards/${pages[0].id}`)).status).toBe(400);
  });

  it('validates widget date ranges', async () => {
    const [page] = await json('GET', '/dashboards');
    const bad = [
      { preset: 'custom', from: '2026-09', to: '2026-01' },
      { preset: 'custom', from: '2026-13', to: '2026-12' },
      { preset: 'forever', from: '2026-01', to: '2026-02' },
    ];
    for (const dateRange of bad) {
      const res = await call('POST', `/dashboards/${page.id}/widgets`, {
        type: 'net-worth',
        meta: { dateRange },
      });
      expect(res.status).toBe(400);
    }
    const frozen = { preset: 'custom', from: '2025-01', to: '2025-12' };
    const widget = await json('POST', `/dashboards/${page.id}/widgets`, {
      type: 'net-worth',
      meta: { dateRange: frozen },
    });
    expect(widget.meta.dateRange).toEqual(frozen);
  });

  it('only updates layout for widgets on the given page', async () => {
    const [first] = await json('GET', '/dashboards');
    const other = await json('POST', '/dashboards', { name: 'Other' });
    const [widget] = await json('GET', `/dashboards/${first.id}/widgets`);
    const res = await call('PUT', `/dashboards/${other.id}/layout`, {
      items: [{ id: widget.id, x: 3, y: 9, width: 3, height: 3 }],
    });
    expect(res.status).toBe(204);
    const after = (await json('GET', `/dashboards/${first.id}/widgets`)).find(
      (w: { id: string }) => w.id === widget.id,
    );
    expect(after).toMatchObject({ x: widget.x, y: widget.y, width: widget.width });

    expect(
      (
        await call('PUT', `/dashboards/${first.id}/layout`, {
          items: [{ id: widget.id, x: 0, y: 0, width: 13, height: 3 }],
        })
      ).status,
    ).toBe(400);
  });

  it('saves and validates the dashboard date range', async () => {
    const page = await json('POST', '/dashboards', { name: 'Ranges' });
    expect(page.dateRange).toBeNull();
    const ytd = { preset: 'ytd', from: '2026-01', to: '2026-09' };
    expect((await json('PUT', `/dashboards/${page.id}`, { dateRange: ytd })).dateRange).toEqual(
      ytd,
    );
    // Renaming leaves the range alone
    const renamed = await json('PUT', `/dashboards/${page.id}`, { name: 'Renamed' });
    expect(renamed).toMatchObject({ name: 'Renamed', dateRange: ytd });
    const bad = { preset: 'custom', from: '2026-05', to: '2026-01' };
    expect((await call('PUT', `/dashboards/${page.id}`, { dateRange: bad })).status).toBe(400);
    expect((await json('PUT', `/dashboards/${page.id}`, { dateRange: null })).dateRange).toBeNull();
  });

  it('lets widgets follow the dashboard (no range) or keep their own', async () => {
    const page = await json('POST', '/dashboards', { name: 'Follow' });
    const follows = await json('POST', `/dashboards/${page.id}/widgets`, { type: 'spending' });
    expect(follows.meta).toEqual({});
    const own = { preset: '12m', from: '2025-10', to: '2026-09' };
    const updated = await json('PATCH', `/dashboards/widgets/${follows.id}`, {
      meta: { dateRange: own },
    });
    expect(updated.meta.dateRange).toEqual(own);
    // Dropping the range makes it follow the dashboard again
    expect((await json('PATCH', `/dashboards/widgets/${follows.id}`, { meta: {} })).meta).toEqual(
      {},
    );
  });

  it('migration 0015 keeps only frozen widget ranges', () => {
    const sql = readFileSync('src/db/migrations/0015_dashboard_date_range.sql', 'utf8')
      .split('--> statement-breakpoint')[1]
      .trim();
    const pageId = db.select().from(dashboardPages).get()!.id;
    const live = { preset: '6m', from: '2026-04', to: '2026-09' };
    const frozen = { preset: 'custom', from: '2025-01', to: '2025-12' };
    const rows = [{ dateRange: live, name: 'Mine' }, { dateRange: frozen }, {}].map((meta) => ({
      id: nanoid(),
      pageId,
      type: 'net-worth',
      meta: JSON.stringify(meta),
    }));
    db.insert(dashboardWidgets).values(rows).run();
    db.run(sqlRaw.raw(sql));
    const metas = rows.map((r) =>
      JSON.parse(
        db.select().from(dashboardWidgets).where(eq(dashboardWidgets.id, r.id)).get()!.meta,
      ),
    );
    expect(metas).toEqual([{ name: 'Mine' }, { dateRange: frozen }, {}]);
  });

  it('moves a widget to another dashboard', async () => {
    const [first] = await json('GET', '/dashboards');
    const target = await json('POST', '/dashboards', { name: 'Target' });
    const [widget] = await json('GET', `/dashboards/${first.id}/widgets`);
    const moved = await json('PATCH', `/dashboards/widgets/${widget.id}`, { pageId: target.id });
    expect(moved).toMatchObject({ pageId: target.id, x: 0, y: 0 });
  });
});
