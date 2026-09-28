import { apiFetch } from './client';
import type { DashboardPage, DashboardWidget, ReportDateRange, WidgetType } from '../types';

export interface WidgetLayoutItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const getDashboards = () => apiFetch<DashboardPage[]>('/dashboards');

export const createDashboard = (name: string) =>
  apiFetch<DashboardPage>('/dashboards', { method: 'POST', body: JSON.stringify({ name }) });

export const updateDashboard = (
  id: string,
  data: { name?: string; dateRange?: ReportDateRange | null },
) => apiFetch<DashboardPage>(`/dashboards/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const deleteDashboard = (id: string) =>
  apiFetch<void>(`/dashboards/${id}`, { method: 'DELETE' });

export const getWidgets = (pageId: string) =>
  apiFetch<DashboardWidget[]>(`/dashboards/${pageId}/widgets`);

export const getWidget = (id: string) => apiFetch<DashboardWidget>(`/dashboards/widgets/${id}`);

export const addWidget = (
  pageId: string,
  data: { type: WidgetType; meta?: DashboardWidget['meta']; customReportId?: string },
) =>
  apiFetch<DashboardWidget>(`/dashboards/${pageId}/widgets`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const saveLayout = (pageId: string, items: WidgetLayoutItem[]) =>
  apiFetch<void>(`/dashboards/${pageId}/layout`, {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });

export const updateWidget = (
  id: string,
  data: { meta?: DashboardWidget['meta']; pageId?: string },
) =>
  apiFetch<DashboardWidget>(`/dashboards/widgets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const deleteWidget = (id: string) =>
  apiFetch<void>(`/dashboards/widgets/${id}`, { method: 'DELETE' });
