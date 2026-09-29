import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/schedules';
import { deleteTransaction } from '../api/transactions';
import { useUndoStore } from '../store/undoStore';
import type { CreateScheduleData } from '../api/schedules';
import type { Schedule } from '../types';

const SKK = ['schedules'];
const OQK = ['schedule-occurrences'];
const SQK = ['schedule-summary'];
const MQK = ['match-suggestions'];

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: SKK });
  qc.invalidateQueries({ queryKey: OQK });
  qc.invalidateQueries({ queryKey: SQK });
  qc.invalidateQueries({ queryKey: MQK });
  qc.invalidateQueries({ queryKey: ['transactions'] });
  qc.invalidateQueries({ queryKey: ['accounts'] });
}

export function useSchedules(status?: string) {
  return useQuery({
    queryKey: ['schedules', { status }],
    queryFn: () => api.getSchedules(status),
  });
}

export function useScheduleOccurrences(from: string, to: string) {
  return useQuery({
    queryKey: ['schedule-occurrences', { from, to }],
    queryFn: () => api.getScheduleOccurrences(from, to),
    enabled: Boolean(from && to),
  });
}

export function useMatchSuggestions() {
  return useQuery({
    queryKey: MQK,
    queryFn: () => api.getMatchSuggestions(),
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateScheduleData) => api.createSchedule(data),
    onSuccess: (created) => {
      invalidateAll(qc);
      useUndoStore.getState().push({
        description: `Create schedule "${created.name}"`,
        undo: async () => {
          await api.deleteSchedule(created.id, true);
          invalidateAll(qc);
        },
        redo: async () => {
          await api.createSchedule({
            name: created.name,
            amount: created.amount,
            amountType: created.amountType as any,
            recurrenceType: created.recurrenceType as any,
            startDate: created.startDate,
            endDate: created.endDate,
            weekendAdjust: created.weekendAdjust as any,
            dateFlexibility: created.dateFlexibility,
            accountId: created.accountId,
            categoryId: created.categoryId,
            payeeId: created.payeeId,
            notes: created.notes,
            autoCreate: created.autoCreate,
          });
          invalidateAll(qc);
        },
      });
    },
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<CreateScheduleData>) =>
      api.updateSchedule(id, data),
    onMutate: async ({ id }) => {
      const all = qc.getQueryData<Schedule[]>(['schedules', { status: undefined }]);
      const active = qc.getQueryData<Schedule[]>(['schedules', { status: 'active' }]);
      const snapshot = all?.find((s) => s.id === id) ?? active?.find((s) => s.id === id);
      return { old: snapshot };
    },
    onSuccess: (_, { id, ...data }, ctx) => {
      invalidateAll(qc);
      if (!ctx?.old) return;
      const snapshot = ctx.old;
      useUndoStore.getState().push({
        description: `Edit schedule`,
        undo: async () => {
          await api.updateSchedule(id, {
            name: snapshot.name,
            amount: snapshot.amount,
            amountType: snapshot.amountType as any,
            recurrenceType: snapshot.recurrenceType as any,
            startDate: snapshot.startDate,
            endDate: snapshot.endDate,
            weekendAdjust: snapshot.weekendAdjust as any,
            dateFlexibility: snapshot.dateFlexibility,
            accountId: snapshot.accountId,
            categoryId: snapshot.categoryId,
            payeeId: snapshot.payeeId,
            notes: snapshot.notes,
            autoCreate: snapshot.autoCreate,
            status: snapshot.status,
          });
          invalidateAll(qc);
        },
        redo: async () => {
          await api.updateSchedule(id, data);
          invalidateAll(qc);
        },
      });
    },
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hard }: { id: string; hard?: boolean }) => {
      const all = qc.getQueryData<Schedule[]>(['schedules', { status: undefined }]);
      const snapshot = all?.find((s) => s.id === id);
      return api.deleteSchedule(id, hard).then(() => ({ snapshot, hard }));
    },
    onSuccess: ({ snapshot, hard }) => {
      invalidateAll(qc);
      if (!snapshot) return;
      if (!hard) {
        useUndoStore.getState().push({
          description: `Cancel schedule "${snapshot.name}"`,
          undo: async () => {
            await api.updateSchedule(snapshot.id, { status: 'active' });
            invalidateAll(qc);
          },
          redo: async () => {
            await api.deleteSchedule(snapshot.id);
            invalidateAll(qc);
          },
        });
      }
    },
  });
}

export function useMarkOccurrencePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      scheduleId,
      date,
      amount,
      occurrenceId,
    }: {
      scheduleId: string;
      date: string;
      amount?: number;
      occurrenceId?: string;
    }) => api.markOccurrencePaid(scheduleId, date, amount, occurrenceId),
    onSuccess: (createdTx) => {
      invalidateAll(qc);
      useUndoStore.getState().push({
        description: `Mark as paid`,
        undo: async () => {
          await deleteTransaction(createdTx.id);
          invalidateAll(qc);
        },
        redo: async () => {
          invalidateAll(qc);
        },
      });
    },
  });
}

export function useSkipOccurrence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (occurrenceId: string) => api.skipOccurrence(occurrenceId),
    onSuccess: () => {
      invalidateAll(qc);
    },
  });
}

export function useMatchOccurrence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      occurrenceId,
      transactionId,
    }: {
      occurrenceId: string;
      transactionId: string;
    }) => api.matchOccurrence(occurrenceId, transactionId),
    onSuccess: () => {
      invalidateAll(qc);
    },
  });
}

export function useUnmatchOccurrence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (occurrenceId: string) => api.unmatchOccurrence(occurrenceId),
    onSuccess: () => {
      invalidateAll(qc);
    },
  });
}

export function useUnmatchByTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (transactionId: string) => api.unmatchByTransaction(transactionId),
    onSuccess: () => {
      invalidateAll(qc);
    },
  });
}

export function useDismissMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      occurrenceId,
      transactionId,
    }: {
      occurrenceId: string;
      transactionId: string;
    }) => api.dismissMatch(occurrenceId, transactionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MQK });
    },
  });
}

/** Runs discovery only while `enabled` (e.g. the Find recurring modal is open). */
export function useDiscoverSchedules(enabled: boolean) {
  return useQuery({
    queryKey: ['schedule-discover'],
    queryFn: api.discoverSchedules,
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useCreateDiscoveredSchedules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createDiscoveredSchedules,
    onSuccess: () => {
      invalidateAll(qc);
      qc.removeQueries({ queryKey: ['schedule-discover'] });
    },
  });
}
