import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/customReports';
import { useUndoStore } from '../store/undoStore';
import type { CustomReportConfig, SavedCustomReport } from '../types';

export function useCustomReportData(config: CustomReportConfig) {
  return useQuery({
    queryKey: ['reports', 'custom', config],
    queryFn: () => api.getCustomReportData(config),
  });
}

export function useSavedReports() {
  return useQuery({ queryKey: ['custom-reports'], queryFn: api.getSavedReports });
}

export function useSavedReport(id: string | undefined) {
  return useQuery({
    queryKey: ['custom-reports', id],
    queryFn: () => api.getSavedReport(id!),
    enabled: !!id,
  });
}

export function useCreateSavedReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createSavedReport,
    onSuccess: (created, { dashboardPageId }) => {
      // Saving a new report also adds it to a dashboard
      const refresh = () => {
        qc.invalidateQueries({ queryKey: ['custom-reports'] });
        qc.invalidateQueries({ queryKey: ['dashboards'] });
      };
      refresh();
      useUndoStore.getState().push({
        description: `Create report "${created.name}"`,
        undo: async () => {
          await api.deleteSavedReport(created.id);
          refresh();
        },
        redo: async () => {
          await api.createSavedReport({
            name: created.name,
            config: created.config,
            dashboardPageId,
          });
          refresh();
        },
      });
    },
  });
}

export function useUpdateSavedReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { name?: string; config?: CustomReportConfig };
    }) => api.updateSavedReport(id, data),
    onMutate: async ({ id }) => {
      const reports = qc.getQueryData<SavedCustomReport[]>(['custom-reports']);
      return { old: reports?.find((r) => r.id === id) };
    },
    onSuccess: (_, { id, data }, ctx) => {
      qc.invalidateQueries({ queryKey: ['custom-reports'] });
      if (!ctx?.old) return;
      const snapshot = ctx.old;
      useUndoStore.getState().push({
        description: `Edit report`,
        undo: async () => {
          await api.updateSavedReport(id, { name: snapshot.name, config: snapshot.config });
          qc.invalidateQueries({ queryKey: ['custom-reports'] });
        },
        redo: async () => {
          await api.updateSavedReport(id, data);
          qc.invalidateQueries({ queryKey: ['custom-reports'] });
        },
      });
    },
  });
}

export function useDeleteSavedReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      const reports = qc.getQueryData<SavedCustomReport[]>(['custom-reports']);
      const snapshot = reports?.find((r) => r.id === id);
      return api.deleteSavedReport(id).then(() => snapshot);
    },
    onSuccess: (snapshot) => {
      qc.invalidateQueries({ queryKey: ['custom-reports'] });
      // Deleting a report removes its dashboard widgets
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      if (!snapshot) return;
      useUndoStore.getState().push({
        description: `Delete report "${snapshot.name}"`,
        undo: async () => {
          await api.createSavedReport({ name: snapshot.name, config: snapshot.config });
          qc.invalidateQueries({ queryKey: ['custom-reports'] });
        },
        redo: async () => {
          qc.invalidateQueries({ queryKey: ['custom-reports'] });
        },
      });
    },
  });
}
