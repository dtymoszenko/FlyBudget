import { apiFetch } from './client';
import type { Account, AccountType } from '../types';
import type { ImportSettings } from '../utils/csv';

export const getAccounts = () => apiFetch<Account[]>('/accounts');

export const createAccount = (data: {
  name: string;
  type: AccountType;
  startingBalance: number;
  isOffBudget?: number;
}) => apiFetch<Account>('/accounts', { method: 'POST', body: JSON.stringify(data) });

export const updateAccount = (
  id: string,
  data: Partial<{
    name: string;
    type: AccountType;
    startingBalance: number;
    isOffBudget: number;
    logo: string | null;
  }>,
) => apiFetch<Account>(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const closeAccount = (id: string) => apiFetch<void>(`/accounts/${id}`, { method: 'DELETE' });

export const reorderAccounts = (ids: string[]) =>
  apiFetch<{ ok: boolean }>('/accounts/reorder', { method: 'PUT', body: JSON.stringify({ ids }) });

export const getBalancesAgo = () => apiFetch<Record<string, number>>('/accounts/balances-ago');

/** How this account's bank writes CSV files, from the last import (null before the first) */
export const getImportSettings = (id: string) =>
  apiFetch<{ settings: ImportSettings | null }>(`/accounts/${id}/import-settings`);

export const saveImportSettings = (id: string, settings: ImportSettings) =>
  apiFetch<{ settings: ImportSettings }>(`/accounts/${id}/import-settings`, {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
