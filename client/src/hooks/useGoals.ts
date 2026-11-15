import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as goalsApi from '../api/goals';
import { t } from '../i18n';
import { useUndoStore } from '../store/undoStore';
import type { Goal } from '../types';

export function useGoals() {
  return useQuery({
    queryKey: ['goals'],
    queryFn: goalsApi.getGoals,
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: goalsApi.createGoal,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['goals'] });
      useUndoStore.getState().push({
        description: t('goals.undo.create', { name: created.name }),
        undo: async () => {
          await goalsApi.deleteGoal(created.id);
          qc.invalidateQueries({ queryKey: ['goals'] });
        },
        redo: async () => {
          await goalsApi.createGoal({
            name: created.name,
            targetAmount: created.targetAmount,
            currentAmount: created.currentAmount,
            targetDate: created.targetDate,
            accountId: created.accountId,
            icon: created.icon,
            color: created.color,
          });
          qc.invalidateQueries({ queryKey: ['goals'] });
        },
      });
    },
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof goalsApi.updateGoal>[1] }) =>
      goalsApi.updateGoal(id, data),
    onMutate: async ({ id }) => {
      const goals = qc.getQueryData<Goal[]>(['goals']);
      return { old: goals?.find((g) => g.id === id) };
    },
    onSuccess: (_, { id, data }, ctx) => {
      qc.invalidateQueries({ queryKey: ['goals'] });
      if (!ctx?.old) return;
      const snapshot = ctx.old;
      useUndoStore.getState().push({
        description: t('goals.undo.edit'),
        undo: async () => {
          await goalsApi.updateGoal(id, {
            name: snapshot.name,
            targetAmount: snapshot.targetAmount,
            currentAmount: snapshot.currentAmount,
            targetDate: snapshot.targetDate,
            accountId: snapshot.accountId,
            icon: snapshot.icon,
            color: snapshot.color,
          });
          qc.invalidateQueries({ queryKey: ['goals'] });
        },
        redo: async () => {
          await goalsApi.updateGoal(id, data);
          qc.invalidateQueries({ queryKey: ['goals'] });
        },
      });
    },
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      const goals = qc.getQueryData<Goal[]>(['goals']);
      const snapshot = goals?.find((g) => g.id === id);
      return goalsApi.deleteGoal(id).then(() => snapshot);
    },
    onSuccess: (snapshot) => {
      qc.invalidateQueries({ queryKey: ['goals'] });
      if (!snapshot) return;
      useUndoStore.getState().push({
        description: t('goals.undo.delete', { name: snapshot.name }),
        undo: async () => {
          await goalsApi.createGoal({
            name: snapshot.name,
            targetAmount: snapshot.targetAmount,
            currentAmount: snapshot.currentAmount,
            targetDate: snapshot.targetDate,
            accountId: snapshot.accountId,
            icon: snapshot.icon,
            color: snapshot.color,
          });
          qc.invalidateQueries({ queryKey: ['goals'] });
        },
        redo: async () => {
          qc.invalidateQueries({ queryKey: ['goals'] });
        },
      });
    },
  });
}
