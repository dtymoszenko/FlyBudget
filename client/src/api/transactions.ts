import { apiFetch } from './client';
import type { Transaction, TransactionQueryParams, ImportPreviewRow } from '../types';

export interface SplitItem {
  categoryId: string | null;
  amount: number;
  notes?: string | null;
}

export interface CreateTransactionData {
  /** Chosen on this device so a resend can't create it twice (see utils/offline.ts) */
  id?: string;
  accountId: string;
  date: string;
  amount: number;
  payeeId?: string | null;
  payeeName?: string | null;
  categoryId?: string | null;
  notes?: string | null;
  splits?: SplitItem[];
}

export interface CreateTransferData {
  id?: string;
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amount: number;
  notes?: string | null;
}

export interface ImportRow {
  date: string;
  amount: number;
  payeeName?: string | null;
  notes?: string | null;
  importedId: string;
}

export function getTransactions(params: TransactionQueryParams = {}) {
  const q = new URLSearchParams();
  if (params.accountId) q.set('account_id', params.accountId);
  if (params.month) q.set('month', params.month);
  if (params.from) q.set('from', params.from);
  if (params.to) q.set('to', params.to);
  if (params.categoryIds?.length) q.set('category_ids', params.categoryIds.join(','));
  else if (params.categoryId) q.set('category_id', params.categoryId);
  if (params.categoryGroupId) q.set('category_group_id', params.categoryGroupId);
  if (params.search) q.set('search', params.search);
  if (params.reconciled !== undefined) q.set('reconciled', String(params.reconciled));
  if (params.limit) q.set('limit', String(params.limit));
  if (params.offset) q.set('offset', String(params.offset));
  const qs = q.toString();
  return apiFetch<Transaction[]>(`/transactions${qs ? `?${qs}` : ''}`);
}

export const createTransaction = (data: CreateTransactionData) =>
  apiFetch<Transaction>('/transactions', { method: 'POST', body: JSON.stringify(data) });

export const updateTransaction = (id: string, data: Partial<CreateTransactionData>) =>
  apiFetch<Transaction>(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const deleteTransaction = (id: string) =>
  apiFetch<void>(`/transactions/${id}`, { method: 'DELETE' });

export const reconcileAccount = (accountId: string, transactionIds: string[]) =>
  apiFetch<{ reconciled: number }>(`/accounts/${accountId}/reconcile`, {
    method: 'PUT',
    body: JSON.stringify({ transactionIds }),
  });

export const createTransfer = (data: CreateTransferData) =>
  apiFetch<Transaction[]>('/transactions/transfer', { method: 'POST', body: JSON.stringify(data) });

export const importPreview = (accountId: string, rows: ImportRow[]) =>
  apiFetch<ImportPreviewRow[]>('/transactions/import/preview', {
    method: 'POST',
    body: JSON.stringify({ accountId, rows }),
  });

export const importConfirm = (accountId: string, rows: ImportRow[]) =>
  apiFetch<{ imported: number; skipped: number }>('/transactions/import/confirm', {
    method: 'POST',
    body: JSON.stringify({ accountId, rows }),
  });
