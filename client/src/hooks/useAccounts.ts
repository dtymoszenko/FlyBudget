import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as accountsApi from '../api/accounts';
import { useUndoStore } from '../store/undoStore';
import type { Account } from '../types';

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.getAccounts,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: accountsApi.createAccount,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      useUndoStore.getState().push({
        description: `Create account "${created.name}"`,
        undo: async () => {
          await accountsApi.closeAccount(created.id);
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
        redo: async () => {
          await accountsApi.createAccount({
            name: created.name,
            type: created.type,
            startingBalance: created.startingBalance,
            isOffBudget: created.isOffBudget,
          });
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
      });
    },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Parameters<typeof accountsApi.updateAccount>[1];
    }) => accountsApi.updateAccount(id, data),
    onMutate: async ({ id }) => {
      const accounts = qc.getQueryData<Account[]>(['accounts']);
      return { old: accounts?.find((a) => a.id === id) };
    },
    onSuccess: (_, { id, data }, ctx) => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      if (!ctx?.old) return;
      const snapshot = ctx.old;
      useUndoStore.getState().push({
        description: `Edit account`,
        undo: async () => {
          await accountsApi.updateAccount(id, {
            name: snapshot.name,
            type: snapshot.type,
            isOffBudget: snapshot.isOffBudget,
          });
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
        redo: async () => {
          await accountsApi.updateAccount(id, data);
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
      });
    },
  });
}

export function useCloseAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      const accounts = qc.getQueryData<Account[]>(['accounts']);
      const snapshot = accounts?.find((a) => a.id === id);
      return accountsApi.closeAccount(id).then(() => snapshot);
    },
    onSuccess: (snapshot) => {
      // Reports too: closed accounts leave net worth
      const refresh = () => {
        qc.invalidateQueries({ queryKey: ['accounts'] });
        qc.invalidateQueries({ queryKey: ['reports'] });
      };
      refresh();
      if (!snapshot) return;
      useUndoStore.getState().push({
        description: `Close account "${snapshot.name}"`,
        undo: async () => {
          await accountsApi.updateAccount(snapshot.id, { closedAt: null });
          refresh();
        },
        redo: async () => {
          await accountsApi.closeAccount(snapshot.id);
          refresh();
        },
      });
    },
  });
}

export function useBalancesAgo() {
  return useQuery({
    queryKey: ['accounts', 'balances-ago'],
    queryFn: accountsApi.getBalancesAgo,
  });
}

export function useReorderAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => {
      const accounts = qc.getQueryData<Account[]>(['accounts']);
      const oldIds = accounts?.map((a) => a.id) ?? [];
      return accountsApi.reorderAccounts(ids).then(() => oldIds);
    },
    onSuccess: (oldIds, newIds) => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      useUndoStore.getState().push({
        description: `Reorder accounts`,
        undo: async () => {
          await accountsApi.reorderAccounts(oldIds);
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
        redo: async () => {
          await accountsApi.reorderAccounts(newIds);
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
      });
    },
  });
}
