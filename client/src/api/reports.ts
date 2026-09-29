import { apiFetch } from './client';
import type {
  NetWorthPoint,
  IncomeExpensesPoint,
  CashFlowPoint,
  SpendingByCategory,
  IncomeByCategoryItem,
  SpendingTrendPoint,
  SpendingComparisonData,
  DailyFlowPoint,
} from '../types';

const toQueryString = (from: string, to: string) => `?from=${from}&to=${to}`;

export const getNetWorth = (from: string, to: string, granularity?: 'daily' | 'monthly') =>
  apiFetch<NetWorthPoint[]>(
    `/reports/net-worth${toQueryString(from, to)}${granularity ? `&granularity=${granularity}` : ''}`,
  );

export const getIncomeVsExpenses = (from: string, to: string) =>
  apiFetch<IncomeExpensesPoint[]>(`/reports/income-vs-expenses${toQueryString(from, to)}`);

export const getCashFlow = (from: string, to: string) =>
  apiFetch<CashFlowPoint[]>(`/reports/cash-flow${toQueryString(from, to)}`);

export const getSpendingByCategory = (from: string, to: string) =>
  apiFetch<SpendingByCategory[]>(`/reports/spending-by-category${toQueryString(from, to)}`);

export const getIncomeByCategory = (from: string, to: string) =>
  apiFetch<IncomeByCategoryItem[]>(`/reports/income-by-category${toQueryString(from, to)}`);

/** `daily` puts the date (yyyy-MM-dd) in each point's `month`. */
export const getSpendingTrends = (
  categoryIds: string[],
  from: string,
  to: string,
  granularity?: 'daily' | 'monthly',
) =>
  apiFetch<SpendingTrendPoint[]>(
    `/reports/spending-trends?category_ids=${categoryIds.join(',')}&from=${from}&to=${to}${granularity ? `&granularity=${granularity}` : ''}`,
  );

export const getSpendingComparison = (mode: string) =>
  apiFetch<SpendingComparisonData>(`/reports/spending-comparison?mode=${mode}`);

export const getDailyFlow = (from: string, to: string) =>
  apiFetch<DailyFlowPoint[]>(`/reports/daily-flow${toQueryString(from, to)}`);
