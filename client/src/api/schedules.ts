import { apiFetch } from './client';
import type {
  Schedule,
  ScheduleOccurrence,
  MatchSuggestion,
  DiscoveredSchedule,
  Transaction,
  RecurrenceType,
  AmountType,
  WeekendAdjust,
  RecurrenceRule,
} from '../types';

export interface CreateScheduleData {
  name: string;
  amount: number;
  amountType?: AmountType;
  recurrenceType: RecurrenceType;
  recurrenceRule?: RecurrenceRule;
  startDate: string;
  endDate?: string | null;
  weekendAdjust?: WeekendAdjust;
  dateFlexibility?: number;
  accountId?: string | null;
  transferAccountId?: string | null;
  categoryId?: string | null;
  payeeId?: string | null;
  notes?: string | null;
  status?: string;
  autoCreate?: number;
}

export const getSchedules = (status?: string) => {
  const q = status ? `?status=${status}` : '';
  return apiFetch<Schedule[]>(`/schedules${q}`);
};

export const createSchedule = (data: CreateScheduleData) =>
  apiFetch<Schedule>('/schedules', { method: 'POST', body: JSON.stringify(data) });

export const updateSchedule = (id: string, data: Partial<CreateScheduleData>) =>
  apiFetch<Schedule>(`/schedules/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const deleteSchedule = (id: string, hard = false) =>
  apiFetch<void>(`/schedules/${id}${hard ? '?hard=1' : ''}`, { method: 'DELETE' });

export const getScheduleOccurrences = (from: string, to: string) => {
  const q = new URLSearchParams({ from, to });
  return apiFetch<ScheduleOccurrence[]>(`/schedules/occurrences?${q}`);
};

export const markOccurrencePaid = (
  scheduleId: string,
  date: string,
  amount?: number,
  occurrenceId?: string,
) =>
  apiFetch<Transaction>(`/schedules/${scheduleId}/mark-paid`, {
    method: 'POST',
    body: JSON.stringify({
      date,
      ...(amount !== undefined ? { amount } : {}),
      ...(occurrenceId ? { occurrenceId } : {}),
    }),
  });

export const skipOccurrence = (occurrenceId: string) =>
  apiFetch<{ ok: boolean }>(`/schedules/occurrences/${occurrenceId}/skip`, { method: 'POST' });

export const matchOccurrence = (occurrenceId: string, transactionId: string) =>
  apiFetch<{ ok: boolean }>(`/schedules/occurrences/${occurrenceId}/match`, {
    method: 'POST',
    body: JSON.stringify({ transactionId }),
  });

export const unmatchOccurrence = (occurrenceId: string) =>
  apiFetch<{ ok: boolean }>(`/schedules/occurrences/${occurrenceId}/unmatch`, { method: 'POST' });

export const unmatchByTransaction = (transactionId: string) =>
  apiFetch<{ ok: boolean }>('/schedules/unmatch-transaction', {
    method: 'POST',
    body: JSON.stringify({ transactionId }),
  });

export const dismissMatch = (occurrenceId: string, transactionId: string) =>
  apiFetch<{ ok: boolean }>(`/schedules/occurrences/${occurrenceId}/dismiss`, {
    method: 'POST',
    body: JSON.stringify({ transactionId }),
  });

export const getMatchSuggestions = () =>
  apiFetch<MatchSuggestion[]>('/schedules/match-suggestions');

export const discoverSchedules = () => apiFetch<DiscoveredSchedule[]>('/schedules/discover');

export const createDiscoveredSchedules = (items: DiscoveredSchedule[]) =>
  apiFetch<{ created: number; ids: string[] }>('/schedules/discover/create', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
