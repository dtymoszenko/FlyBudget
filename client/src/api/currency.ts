import { apiFetch } from './client';
import type { CurrencySettings, ExchangeRate, MissingRates, Transaction } from '../types';

export const getCurrencySettings = () => apiFetch<CurrencySettings>('/currency');

/** The budget's currency: chosen once, or corrected while no account in another one has history */
export const setBudgetCurrency = (currency: string) =>
  apiFetch<CurrencySettings>('/currency', { method: 'PUT', body: JSON.stringify({ currency }) });

/** Downloading ECB rates: on or off, and from which server (null = the default) */
export const setRateDownload = (data: { enabled?: boolean; url?: string | null }) =>
  apiFetch<CurrencySettings>('/currency/download', { method: 'PUT', body: JSON.stringify(data) });

export const downloadRates = () =>
  apiFetch<{ stored: number; unsupported: string[]; settings: CurrencySettings }>(
    '/currency/download',
    { method: 'POST' },
  );

export const getRates = (
  params: { base?: string; quote?: string; source?: 'manual' | 'ecb'; limit?: number } = {},
) => {
  const query = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
  );
  return apiFetch<ExchangeRate[]>(`/currency/rates${query.size ? `?${query}` : ''}`);
};

export const addRate = (data: { date: string; base: string; quote: string; rate: string }) =>
  apiFetch<ExchangeRate>('/currency/rates', { method: 'POST', body: JSON.stringify(data) });

export const deleteRate = (id: string) =>
  apiFetch<void>(`/currency/rates/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** An amount at the day's rate in another currency (null amount: no rate for that day) */
export const convertAmount = (params: { from: string; to: string; date: string; amount: number }) =>
  apiFetch<{
    amount: number | null;
    rate: string | null;
    date: string | null;
    source: string | null;
  }>(`/currency/convert?${new URLSearchParams({ ...params, amount: String(params.amount) })}`);

export const recalculate = (data: { from?: string; to?: string; dryRun?: boolean } = {}) =>
  apiFetch<{ changed: number; missing: MissingRates }>('/currency/recalculate', {
    method: 'POST',
    body: JSON.stringify(data),
  });

/** Records an account's currency difference as a correction in a category (or none) */
export const recordCurrencyDifference = (data: { accountId: string; categoryId: string | null }) =>
  apiFetch<Transaction>('/currency/difference', { method: 'POST', body: JSON.stringify(data) });
