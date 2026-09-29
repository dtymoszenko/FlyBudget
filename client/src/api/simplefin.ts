import { apiFetch } from './client';
import type {
  SimplefinConnection,
  SimplefinSetupResult,
  SimplefinSyncResult,
  AccountType,
} from '../types';

export const setupSimplefin = (setupToken: string) =>
  apiFetch<SimplefinSetupResult>('/simplefin/setup', {
    method: 'POST',
    body: JSON.stringify({ setupToken }),
  });

export interface SimplefinAccountMappingAction {
  simplefinAccountId: string;
  action: 'create' | 'link' | 'skip';
  accountId?: string;
  accountName?: string;
  accountType?: AccountType;
  isOffBudget?: number;
}

export const mapSimplefinAccounts = (
  connectionId: string,
  mappings: SimplefinAccountMappingAction[],
) =>
  apiFetch<{ mapped: number; created: number; skipped: number }>(
    `/simplefin/connections/${connectionId}/map-accounts`,
    { method: 'POST', body: JSON.stringify({ mappings }) },
  );

export const getSimplefinConnections = () =>
  apiFetch<SimplefinConnection[]>('/simplefin/connections');

export const syncSimplefinConnection = (connectionId: string) =>
  apiFetch<SimplefinSyncResult>(`/simplefin/connections/${connectionId}/sync`, { method: 'POST' });

export const syncAllSimplefin = () =>
  apiFetch<{ results: SimplefinSyncResult[] }>('/simplefin/sync-all', { method: 'POST' });

export const disconnectSimplefin = (connectionId: string) =>
  apiFetch<void>(`/simplefin/connections/${connectionId}`, { method: 'DELETE' });
