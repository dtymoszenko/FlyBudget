import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as budgetApi from '../api/budget';
import { useUndoStore } from '../store/undoStore';
import type { BudgetGroup } from '../types';

// Switching months keeps showing the previous month until the next one arrives, so the
// page doesn't collapse to an empty budget (and jump) in between
export function useBudget(month: string) {
  return useQuery({
    queryKey: ['budget', month],
    queryFn: () => budgetApi.getBudget(month),
    placeholderData: keepPreviousData,
  });
}

export function useBudgetSummary(month: string) {
  return useQuery({
    queryKey: ['budget-summary', month],
    queryFn: () => budgetApi.getBudgetSummary(month),
    placeholderData: keepPreviousData,
  });
}

export function useSetBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      month,
      categoryId,
      budgeted,
    }: {
      month: string;
      categoryId: string;
      budgeted: number;
    }) => budgetApi.setBudget(month, categoryId, budgeted),
    onMutate: async ({ month, categoryId }) => {
      const groups = qc.getQueryData<BudgetGroup[]>(['budget', month]);
      let oldBudgeted = 0;
      if (groups) {
        for (const g of groups) {
          const cat = g.categories.find((c) => c.id === categoryId);
          if (cat) {
            oldBudgeted = cat.budgeted;
            break;
          }
        }
      }
      return { oldBudgeted };
    },
    onSuccess: (_, { month, categoryId, budgeted }, ctx) => {
      qc.invalidateQueries({ queryKey: ['budget', month] });
      qc.invalidateQueries({ queryKey: ['budget-summary', month] });
      const oldBudgeted = ctx?.oldBudgeted ?? 0;
      useUndoStore.getState().push({
        description: `Set budget`,
        undo: async () => {
          await budgetApi.setBudget(month, categoryId, oldBudgeted);
          qc.invalidateQueries({ queryKey: ['budget', month] });
          qc.invalidateQueries({ queryKey: ['budget-summary', month] });
        },
        redo: async () => {
          await budgetApi.setBudget(month, categoryId, budgeted);
          qc.invalidateQueries({ queryKey: ['budget', month] });
          qc.invalidateQueries({ queryKey: ['budget-summary', month] });
        },
      });
    },
  });
}

export function useCategoryHistory(categoryId: string | null, currentMonth?: string) {
  return useQuery({
    queryKey: ['category-history', categoryId, currentMonth],
    queryFn: () => budgetApi.getCategoryHistory(categoryId!, currentMonth),
    enabled: !!categoryId,
  });
}

export function useSetBudgetBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      categoryId,
      budgeted,
      fromMonth,
    }: {
      categoryId: string;
      budgeted: number;
      fromMonth: string;
    }) => budgetApi.setBudgetBulk(categoryId, budgeted, fromMonth),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['budget-summary'] });
    },
  });
}
