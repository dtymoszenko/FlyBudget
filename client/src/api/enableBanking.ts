import { apiFetch } from './client';
import type {
  AccountType,
  EnableBankingAuthPoll,
  EnableBankingBank,
  EnableBankingConfigureResult,
  EnableBankingConnection,
  EnableBankingStatus,
  EnableBankingSyncResult,
} from '../types';

export const getEnableBankingStatus = () => apiFetch<EnableBankingStatus>('/enable-banking/status');

export const configureEnableBanking = (applicationId: string, privateKey: string) =>
  apiFetch<EnableBankingConfigureResult>('/enable-banking/configure', {
    method: 'POST',
    body: JSON.stringify({ applicationId, privateKey }),
  });

export const removeEnableBankingConfig = () =>
  apiFetch<void>('/enable-banking/configure', { method: 'DELETE' });

export const getEnableBankingBanks = (country: string) =>
  apiFetch<EnableBankingBank[]>(`/enable-banking/aspsps?country=${encodeURIComponent(country)}`);

export type EnableBankingLoginTarget =
  { aspspName: string; country: string } | { connectionId: string };

export const startEnableBankingLogin = (target: EnableBankingLoginTarget) =>
  apiFetch<{ authId: string; url: string }>('/enable-banking/auth', {
    method: 'POST',
    body: JSON.stringify(target),
  });

export const pollEnableBankingLogin = (authId: string) =>
  apiFetch<EnableBankingAuthPoll>(`/enable-banking/auth/${encodeURIComponent(authId)}`);

export const completeEnableBankingLogin = (authId: string, url: string) =>
  apiFetch<EnableBankingAuthPoll>(`/enable-banking/auth/${encodeURIComponent(authId)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });

export const cancelEnableBankingLogin = (authId: string) =>
  apiFetch<void>(`/enable-banking/auth/${encodeURIComponent(authId)}`, { method: 'DELETE' });

export interface EnableBankingMappingAction {
  mappingId: string;
  action: 'create' | 'link' | 'skip';
  accountId?: string;
  accountName?: string;
  accountType?: AccountType;
}

export const mapEnableBankingAccounts = (
  connectionId: string,
  mappings: EnableBankingMappingAction[],
) =>
  apiFetch<{ mapped: number; created: number; skipped: number }>(
    `/enable-banking/connections/${connectionId}/map-accounts`,
    { method: 'POST', body: JSON.stringify({ mappings }) },
  );

export const getEnableBankingConnections = () =>
  apiFetch<EnableBankingConnection[]>('/enable-banking/connections');

export const syncEnableBankingConnection = (connectionId: string, fullHistory?: string[]) =>
  apiFetch<EnableBankingSyncResult>(`/enable-banking/connections/${connectionId}/sync`, {
    method: 'POST',
    body: JSON.stringify(fullHistory ? { fullHistory } : {}),
  });

export const syncAllEnableBanking = () =>
  apiFetch<{ results: EnableBankingSyncResult[] }>('/enable-banking/sync-all', { method: 'POST' });

export const disconnectEnableBanking = (connectionId: string) =>
  apiFetch<void>(`/enable-banking/connections/${connectionId}`, { method: 'DELETE' });
