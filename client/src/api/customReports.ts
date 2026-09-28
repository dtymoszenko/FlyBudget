import { apiFetch } from './client';
import type { CustomReportConfig, CustomReportData, SavedCustomReport } from '../types';

function configToQueryString(c: CustomReportConfig): string {
  const p = new URLSearchParams({
    mode: c.mode,
    group_by: c.groupBy,
    balance_type: c.balanceType,
    from: c.dateRange.from,
    to: c.dateRange.to,
  });
  if (c.filters.accountIds.length) p.set('account_ids', c.filters.accountIds.join(','));
  if (c.filters.categoryIds.length) p.set('category_ids', c.filters.categoryIds.join(','));
  if (c.filters.categoryGroupIds.length)
    p.set('category_group_ids', c.filters.categoryGroupIds.join(','));
  return p.toString();
}

export const getCustomReportData = (config: CustomReportConfig) =>
  apiFetch<CustomReportData>(`/reports/custom?${configToQueryString(config)}`);

export const getSavedReports = () => apiFetch<SavedCustomReport[]>('/custom-reports');

export const getSavedReport = (id: string) => apiFetch<SavedCustomReport>(`/custom-reports/${id}`);

export const createSavedReport = (data: {
  name: string;
  config: CustomReportConfig;
  /** Dashboard to add the new report to; the server uses the first one if omitted */
  dashboardPageId?: string;
}) =>
  apiFetch<SavedCustomReport>('/custom-reports', { method: 'POST', body: JSON.stringify(data) });

export const updateSavedReport = (
  id: string,
  data: { name?: string; config?: CustomReportConfig },
) =>
  apiFetch<SavedCustomReport>(`/custom-reports/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteSavedReport = (id: string) =>
  apiFetch<void>(`/custom-reports/${id}`, { method: 'DELETE' });
