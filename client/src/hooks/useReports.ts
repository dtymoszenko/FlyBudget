import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO, subDays } from 'date-fns';
import * as reportsApi from '../api/reports';
import { DAILY_MAX_MONTHS, dayBounds, monthCount } from '../utils/dateRange';

export const useNetWorth = (from: string, to: string, granularity?: 'daily' | 'monthly') =>
  useQuery({
    queryKey: ['reports', 'net-worth', from, to, granularity],
    queryFn: () => reportsApi.getNetWorth(from, to, granularity),
  });

/**
 * Net worth for a yyyy-MM range as the reports show it: a point per day for short ranges (up to
 * DAILY_MAX_MONTHS), starting at the previous month's close so the change covers the whole
 * range; a point per month otherwise.
 */
export function useNetWorthSeries(from: string, to: string) {
  const daily = monthCount(from, to) <= DAILY_MAX_MONTHS;
  const days = dayBounds(from, to);
  const start = format(subDays(parseISO(days.from), 1), 'yyyy-MM-dd');
  return useNetWorth(daily ? start : from, daily ? days.to : to, daily ? 'daily' : undefined);
}

export const useIncomeVsExpenses = (from: string, to: string) =>
  useQuery({
    queryKey: ['reports', 'income-expenses', from, to],
    queryFn: () => reportsApi.getIncomeVsExpenses(from, to),
  });

export const useDailyFlow = (from: string, to: string) =>
  useQuery({
    queryKey: ['reports', 'daily-flow', from, to],
    queryFn: () => reportsApi.getDailyFlow(from, to),
  });

export const useSpendingByCategory = (from: string, to: string) =>
  useQuery({
    queryKey: ['reports', 'spending-by-category', from, to],
    queryFn: () => reportsApi.getSpendingByCategory(from, to),
  });

/** How many categories Spending Trends shows when none are chosen, and the most it can show. */
export const TOP_TREND_CATEGORIES = 5;
export const MAX_TREND_CATEGORIES = 5;

/** The `count` categories with the most spending in the range, biggest first. */
export function useTopSpendingCategories(from: string, to: string, count: number) {
  const { data, isLoading } = useSpendingByCategory(from, to);
  const ids = useMemo(
    () =>
      [...(data ?? [])]
        .filter((d) => d.categoryId)
        .sort((a, b) => b.totalSpent - a.totalSpent)
        .slice(0, count)
        .map((d) => d.categoryId!),
    [data, count],
  );
  return { ids, isLoading };
}

export const useIncomeByCategory = (from: string, to: string) =>
  useQuery({
    queryKey: ['reports', 'income-by-category', from, to],
    queryFn: () => reportsApi.getIncomeByCategory(from, to),
  });

export const useSpendingTrends = (
  categoryIds: string[],
  from: string,
  to: string,
  granularity?: 'daily' | 'monthly',
) =>
  useQuery({
    queryKey: ['reports', 'spending-trends', categoryIds.join(','), from, to, granularity],
    queryFn: () => reportsApi.getSpendingTrends(categoryIds, from, to, granularity),
    enabled: categoryIds.length > 0,
  });

export const useSpendingComparison = (mode: string) =>
  useQuery({
    queryKey: ['reports', 'spending-comparison', mode],
    queryFn: () => reportsApi.getSpendingComparison(mode),
  });
