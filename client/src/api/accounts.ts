import { apiFetch } from './client';
import type { Account, AccountType } from '../types';

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
    closedAt: null;
  }>,
) => apiFetch<Account>(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const closeAccount = (id: string) => apiFetch<void>(`/accounts/${id}`, { method: 'DELETE' });

export const reorderAccounts = (ids: string[]) =>
  apiFetch<{ ok: boolean }>('/accounts/reorder', { method: 'PUT', body: JSON.stringify({ ids }) });

export const getBalancesAgo = () => apiFetch<Record<string, number>>('/accounts/balances-ago');
