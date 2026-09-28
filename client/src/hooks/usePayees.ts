import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as payeesApi from '../api/payees';
import { useUndoStore } from '../store/undoStore';
import type { PayeeWithCount } from '../types';

const QK = ['payees'];

export function usePayees() {
  return useQuery({ queryKey: QK, queryFn: payeesApi.getPayees });
}

export function useCreatePayee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      defaultCategoryId,
    }: {
      name: string;
      defaultCategoryId?: string | null;
    }) => payeesApi.createPayee(name, defaultCategoryId),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: QK });
      useUndoStore.getState().push({
        description: `Create payee "${created.name}"`,
        undo: async () => {
          await payeesApi.deletePayee(created.id);
          qc.invalidateQueries({ queryKey: QK });
        },
        redo: async () => {
          await payeesApi.createPayee(created.name, created.defaultCategoryId);
          qc.invalidateQueries({ queryKey: QK });
        },
      });
    },
  });
}

export function useUpdatePayee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      defaultCategoryId?: string | null;
      logo?: string | null;
    }) => payeesApi.updatePayee(id, data),
    onMutate: async ({ id }) => {
      const payees = qc.getQueryData<PayeeWithCount[]>(QK);
      return { old: payees?.find((p) => p.id === id) };
    },
    onSuccess: (_, { id, ...data }, ctx) => {
      qc.invalidateQueries({ queryKey: QK });
      if (!ctx?.old) return;
      const snapshot = ctx.old;
      useUndoStore.getState().push({
        description: `Edit payee`,
        undo: async () => {
          await payeesApi.updatePayee(id, {
            name: snapshot.name,
            defaultCategoryId: snapshot.defaultCategoryId,
            logo: snapshot.logo ?? null,
          });
          qc.invalidateQueries({ queryKey: QK });
        },
        redo: async () => {
          await payeesApi.updatePayee(id, data);
          qc.invalidateQueries({ queryKey: QK });
        },
      });
    },
  });
}

export function useDeletePayee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      const payees = qc.getQueryData<PayeeWithCount[]>(QK);
      const snapshot = payees?.find((p) => p.id === id);
      return payeesApi.deletePayee(id).then(() => snapshot);
    },
    onSuccess: (snapshot) => {
      qc.invalidateQueries({ queryKey: QK });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      if (!snapshot) return;
      useUndoStore.getState().push({
        description: `Delete payee "${snapshot.name}"`,
        undo: async () => {
          await payeesApi.createPayee(snapshot.name, snapshot.defaultCategoryId);
          qc.invalidateQueries({ queryKey: QK });
          qc.invalidateQueries({ queryKey: ['transactions'] });
        },
        redo: async () => {
          qc.invalidateQueries({ queryKey: QK });
          qc.invalidateQueries({ queryKey: ['transactions'] });
        },
      });
    },
  });
}

export function useMergePayees() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ keepId, mergeIds }: { keepId: string; mergeIds: string[] }) =>
      payeesApi.mergePayees(keepId, mergeIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
