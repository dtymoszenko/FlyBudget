import { apiFetch } from './client';
import type { PlaidItem, PlaidExchangeResult, PlaidSyncResult, AccountType } from '../types';

export const getPlaidStatus = () =>
  apiFetch<{ configured: boolean; environment: string | null }>('/plaid/status');

export const configurePlaid = (data: { clientId: string; secret: string; environment: string }) =>
  apiFetch<{ ok: boolean }>('/plaid/configure', { method: 'POST', body: JSON.stringify(data) });

// Plaid Hosted Link: the user completes Link in their own browser while the app polls.
export interface HostedLinkStart {
  sessionId: string;
  url: string;
}

export type HostedLinkPoll =
  | { status: 'pending' | 'exited' | 'expired' }
  | { status: 'success'; result: PlaidExchangeResult | null };

export const startHostedLink = () =>
  apiFetch<HostedLinkStart>('/plaid/hosted-link', { method: 'POST' });

export const startUpdateHostedLink = (itemId: string) =>
  apiFetch<HostedLinkStart>(`/plaid/items/${itemId}/hosted-link`, { method: 'POST' });

export const pollHostedLink = (sessionId: string) =>
  apiFetch<HostedLinkPoll>(`/plaid/hosted-link/${sessionId}`);

export const cancelHostedLink = (sessionId: string) =>
  apiFetch<void>(`/plaid/hosted-link/${sessionId}`, { method: 'DELETE' });

export interface AccountMappingAction {
  plaidAccountId: string;
  action: 'create' | 'link' | 'skip';
  accountId?: string;
  accountName?: string;
  accountType?: AccountType;
  isOffBudget?: number;
}

export const mapAccounts = (itemId: string, mappings: AccountMappingAction[]) =>
  apiFetch<{ mapped: number; created: number; skipped: number }>(
    `/plaid/items/${itemId}/map-accounts`,
    { method: 'POST', body: JSON.stringify({ mappings }) },
  );

export const getPlaidItems = () => apiFetch<PlaidItem[]>('/plaid/items');

export const syncItem = (itemId: string) =>
  apiFetch<PlaidSyncResult>(`/plaid/items/${itemId}/sync`, { method: 'POST' });

export const syncAll = () =>
  apiFetch<{ results: PlaidSyncResult[] }>('/plaid/sync-all', { method: 'POST' });

export const disconnectItem = (itemId: string) =>
  apiFetch<void>(`/plaid/items/${itemId}`, { method: 'DELETE' });
