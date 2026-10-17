import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as txApi from '../api/transactions';
import { ApiError } from '../api/client';
import { useUndoStore } from '../store/undoStore';
import type { Transaction, TransferLinkResult } from '../types';

// Existing transactions as transfers: suggestions, linking, "Transfer: account" on one, and
// "Not a transfer". Suggestions live under ['transactions'], so every change to transactions
// (edits, imports, bank syncs) refreshes them too.

const refresh = (qc: QueryClient) => {
  qc.invalidateQueries({ queryKey: ['transactions'] });
  qc.invalidateQueries({ queryKey: ['accounts'] });
};

/** Pairs that look like one transfer; with `accountId`, those with a side in that account */
export function useTransferSuggestions(accountId?: string) {
  return useQuery({
    queryKey: ['transactions', 'transfer-suggestions', accountId ?? null],
    queryFn: () => txApi.getTransferSuggestions(accountId),
  });
}

/** Puts a row back the way it was before it became a transfer (category and payee) */
async function restore(row: Transaction) {
  await txApi.updateTransaction(row.id, {
    payeeId: row.payeeId,
    payeeName: row.payeeName,
    categoryId: row.categoryId,
  });
}

/** Undo for "Transfer: account": unlink and restore both rows, or delete a created side */
function pushUndo(qc: QueryClient, result: TransferLinkResult, redo: () => Promise<unknown>) {
  const [tx, other] = result.transactions;
  const [txBefore, otherBefore] = result.previous;
  useUndoStore.getState().push({
    description: 'Make transfer',
    undo: async () => {
      if (result.created) {
        await txApi.deleteTransaction(other.id);
      } else {
        await txApi.unlinkTransfer(tx.id);
        if (otherBefore) await restore(otherBefore);
      }
      await restore(txBefore);
      refresh(qc);
    },
    redo: async () => {
      await redo();
      refresh(qc);
    },
  });
}

/**
 * Links every given pair, one after another. A pair the server refuses (changed since it was
 * suggested) is counted in `failed`; losing the connection stops there (`interrupted`), keeping
 * the ones already linked so they can still be undone.
 */
export function useLinkTransfers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pairs: { transactionId: string; otherTransactionId: string }[]) => {
      const linked: TransferLinkResult[] = [];
      let failed = 0;
      for (const p of pairs) {
        try {
          linked.push(await txApi.linkTransfer(p.transactionId, p.otherTransactionId));
        } catch (err) {
          if (err instanceof ApiError) {
            failed++;
            continue;
          }
          if (!linked.length) throw err;
          return { linked, failed, interrupted: true };
        }
      }
      return { linked, failed, interrupted: false };
    },
    onSettled: () => refresh(qc),
    onSuccess: ({ linked }) => {
      if (!linked.length) return;
      useUndoStore.getState().push({
        description: `Link ${linked.length} transfer${linked.length === 1 ? '' : 's'}`,
        undo: async () => {
          for (const result of linked) {
            await txApi.unlinkTransfer(result.transactions[0].id);
            for (const row of result.previous) if (row) await restore(row);
          }
          refresh(qc);
        },
        redo: async () => {
          for (const {
            transactions: [a, b],
          } of linked)
            await txApi.linkTransfer(a.id, b.id);
          refresh(qc);
        },
      });
    },
  });
}

export function useTransferToAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accountId }: { id: string; accountId: string }) =>
      txApi.transferToAccount(id, accountId),
    onSuccess: (result, { id, accountId }) => {
      refresh(qc);
      pushUndo(qc, result, () => txApi.transferToAccount(id, accountId));
    },
  });
}

export function useUnlinkTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tx: Transaction) => txApi.unlinkTransfer(tx.id),
    onSuccess: ([, other], tx) => {
      refresh(qc);
      if (!other) return;
      useUndoStore.getState().push({
        description: 'Not a transfer',
        undo: async () => {
          await txApi.linkTransfer(tx.id, other.id);
          refresh(qc);
        },
        redo: async () => {
          await txApi.unlinkTransfer(tx.id);
          refresh(qc);
        },
      });
    },
  });
}

export function useDismissTransferSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      transactionId,
      otherTransactionId,
    }: {
      transactionId: string;
      otherTransactionId: string;
    }) => txApi.dismissTransferSuggestion(transactionId, otherTransactionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions', 'transfer-suggestions'] }),
  });
}
