import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as txApi from '../api/transactions';
import { useUndoStore } from '../store/undoStore';
import { settleEach } from '../utils/batch';
import type { Transaction, TransactionQueryParams } from '../types';

function findTxInCache(qc: QueryClient, id: string): Transaction | undefined {
  const caches = qc.getQueriesData<Transaction[]>({ queryKey: ['transactions'] });
  for (const [, data] of caches) {
    const found = data?.find((t) => t.id === id);
    if (found) return found;
  }
}

export function useTransactions(params: TransactionQueryParams = {}) {
  return useQuery({
    queryKey: ['transactions', params],
    queryFn: () => txApi.getTransactions(params),
  });
}

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: txApi.createTransaction,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      useUndoStore.getState().push({
        description: `Create transaction`,
        undo: async () => {
          await txApi.deleteTransaction(created.id);
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
        redo: async () => {
          await txApi.createTransaction({
            accountId: created.accountId,
            date: created.date,
            amount: created.amount,
            payeeId: created.payeeId,
            payeeName: created.payeeName,
            categoryId: created.categoryId,
            notes: created.notes,
          });
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
      });
    },
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Parameters<typeof txApi.updateTransaction>[1];
    }) => txApi.updateTransaction(id, data),
    onMutate: async ({ id }) => {
      return { old: findTxInCache(qc, id) };
    },
    onSuccess: (_, { id, data }, ctx) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      if (!ctx?.old) return;
      const snapshot = ctx.old;
      useUndoStore.getState().push({
        description: `Edit transaction`,
        undo: async () => {
          await txApi.updateTransaction(id, {
            accountId: snapshot.accountId,
            date: snapshot.date,
            amount: snapshot.amount,
            payeeId: snapshot.payeeId,
            payeeName: snapshot.payeeName,
            categoryId: snapshot.categoryId,
            notes: snapshot.notes,
          });
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
        redo: async () => {
          await txApi.updateTransaction(id, data);
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
      });
    },
  });
}

/** The parts a split has now, as they're sent back to the server */
const partsOf = (tx: Transaction): txApi.SplitItem[] =>
  (tx.children ?? []).map((c) => ({ categoryId: c.categoryId, amount: c.amount, notes: c.notes }));

export function useSetTransactionSplits() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  };
  return useMutation({
    mutationFn: ({ id, splits }: { id: string; splits: txApi.SplitItem[] }) =>
      txApi.setTransactionSplits(id, splits),
    onMutate: async ({ id }) => ({ old: findTxInCache(qc, id) }),
    onSuccess: (_, { id, splits }, ctx) => {
      refresh();
      if (!ctx?.old) return;
      const snapshot = ctx.old;
      useUndoStore.getState().push({
        description: splits.length ? 'Split transaction' : 'Unsplit transaction',
        undo: async () => {
          await txApi.setTransactionSplits(id, snapshot.isParent === 1 ? partsOf(snapshot) : []);
          if (snapshot.isParent !== 1 && snapshot.categoryId) {
            await txApi.updateTransaction(id, { categoryId: snapshot.categoryId });
          }
          refresh();
        },
        redo: async () => {
          await txApi.setTransactionSplits(id, splits);
          refresh();
        },
      });
    },
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      const snapshot = findTxInCache(qc, id);
      return txApi.deleteTransaction(id).then(() => snapshot);
    },
    onSuccess: (snapshot) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      if (!snapshot) return;
      useUndoStore.getState().push({
        description: `Delete transaction`,
        undo: async () => {
          await txApi.createTransaction({
            accountId: snapshot.accountId,
            date: snapshot.date,
            amount: snapshot.amount,
            payeeId: snapshot.payeeId,
            payeeName: snapshot.payeeName,
            categoryId: snapshot.categoryId,
            notes: snapshot.notes,
          });
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
        redo: async () => {
          // Can't delete same id (new one was created), just re-delete latest
          // For simplicity, redo of delete is not supported after undo
          qc.invalidateQueries({ queryKey: ['transactions'] });
        },
      });
    },
  });
}

export function useReconcileAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, transactionIds }: { accountId: string; transactionIds: string[] }) =>
      txApi.reconcileAccount(accountId, transactionIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: txApi.createTransfer,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      const ids = created.map((t) => t.id);
      useUndoStore.getState().push({
        description: `Create transfer`,
        undo: async () => {
          for (const id of ids) await txApi.deleteTransaction(id);
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
        redo: async () => {
          if (created.length >= 2) {
            await txApi.createTransfer({
              fromAccountId: created[0].accountId,
              toAccountId: created[1].accountId,
              date: created[0].date,
              amount: Math.abs(created[0].amount),
              notes: created[0].notes,
            });
          }
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['accounts'] });
        },
      });
    },
  });
}

export function useImportConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, rows }: { accountId: string; rows: txApi.ImportRow[] }) =>
      txApi.importConfirm(accountId, rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

/** What a transaction had before a bulk change, so one undo puts every row back */
const restoreFields = (t: Transaction) => ({
  categoryId: t.categoryId,
  payeeId: t.payeeId,
  payeeName: t.payeeName,
});

/**
 * The same change to several transactions at once (the register's selection). Rows are
 * changed one by one through the ordinary routes, so every rule a single edit follows (splits,
 * transfers, reconciled rows) still applies. Edits get one undo for the whole batch; deleting
 * asks first and can't be undone, since recreating a row loses its splits, transfer link and
 * bank import id.
 */
export function useBulkTransactions() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  };
  const failure = (failed: number, total: number) =>
    new Error(`${failed} of ${total} couldn't be changed. The rest were saved.`);

  const update = useMutation({
    mutationFn: async ({
      ids,
      data,
    }: {
      ids: string[];
      data: Parameters<typeof txApi.updateTransaction>[1];
    }) => {
      const before = new Map(ids.map((id) => [id, findTxInCache(qc, id)]));
      const { done, errors } = await settleEach(ids, (id) => txApi.updateTransaction(id, data));
      refresh();
      const changed = done.map((id) => before.get(id)).filter((t): t is Transaction => !!t);
      if (changed.length) {
        useUndoStore.getState().push({
          description: `Edit ${changed.length} transactions`,
          undo: async () => {
            const { errors } = await settleEach(
              changed.map((t) => t.id),
              (id) => txApi.updateTransaction(id, restoreFields(before.get(id)!)),
            );
            refresh();
            // Kept where it is to be tried again: each row is set to a value, so twice is harmless
            if (errors.length) throw failure(errors.length, changed.length);
          },
          redo: async () => {
            const { errors } = await settleEach(
              changed.map((t) => t.id),
              (id) => txApi.updateTransaction(id, data),
            );
            refresh();
            // Kept where it is to be tried again: each row is set to a value, so twice is harmless
            if (errors.length) throw failure(errors.length, changed.length);
          },
        });
      }
      if (errors.length) throw failure(errors.length, ids.length);
    },
  });

  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      const { errors } = await settleEach(ids, (id) => txApi.deleteTransaction(id));
      refresh();
      if (errors.length) throw failure(errors.length, ids.length);
    },
  });

  return { update, remove };
}
