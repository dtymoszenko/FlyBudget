import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/dashboards';
import { useUndoStore } from '../store/undoStore';
import type { DashboardWidget } from '../types';

const widgetsKey = (pageId: string) => ['dashboards', pageId, 'widgets'];

export function useDashboards() {
  return useQuery({ queryKey: ['dashboards'], queryFn: api.getDashboards });
}

export function useDashboardWidgets(pageId: string | undefined) {
  return useQuery({
    queryKey: widgetsKey(pageId ?? ''),
    queryFn: () => api.getWidgets(pageId!),
    enabled: !!pageId,
  });
}

export function useDashboardWidget(id: string | undefined) {
  return useQuery({
    queryKey: ['dashboards', 'widget', id],
    queryFn: () => api.getWidget(id!),
    enabled: !!id,
  });
}

export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createDashboard,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}

export function useRenameDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameDashboard(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteDashboard,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
}

export function useAddWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, data }: { pageId: string; data: Parameters<typeof api.addWidget>[1] }) =>
      api.addWidget(pageId, data),
    onSuccess: (_, { pageId }) => qc.invalidateQueries({ queryKey: widgetsKey(pageId) }),
  });
}

/** Saves positions after a drag/resize, updating the cache first so the grid doesn't jump. */
export function useSaveLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, items }: { pageId: string; items: api.WidgetLayoutItem[] }) =>
      api.saveLayout(pageId, items),
    onMutate: ({ pageId, items }) => {
      const byId = new Map(items.map((i) => [i.id, i]));
      qc.setQueryData<DashboardWidget[]>(widgetsKey(pageId), (old) =>
        old?.map((w) => ({ ...w, ...byId.get(w.id) })),
      );
    },
    onError: (_, { pageId }) => qc.invalidateQueries({ queryKey: widgetsKey(pageId) }),
  });
}

export function useUpdateWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      widget,
      data,
    }: {
      widget: DashboardWidget;
      data: Parameters<typeof api.updateWidget>[1];
    }) => api.updateWidget(widget.id, data),
    onSuccess: (_, { widget, data }) => {
      qc.invalidateQueries({ queryKey: ['dashboards'] });
      // Moves between dashboards aren't undoable; date range and name edits are
      if (!data.meta) return;
      useUndoStore.getState().push({
        description: 'Edit report widget',
        undo: async () => {
          await api.updateWidget(widget.id, { meta: widget.meta });
          qc.invalidateQueries({ queryKey: ['dashboards'] });
        },
        redo: async () => {
          await api.updateWidget(widget.id, { meta: data.meta });
          qc.invalidateQueries({ queryKey: ['dashboards'] });
        },
      });
    },
  });
}

export function useDeleteWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (widget: DashboardWidget) => api.deleteWidget(widget.id),
    onSuccess: (_, widget) => {
      qc.invalidateQueries({ queryKey: widgetsKey(widget.pageId) });
      let restoredId = widget.id;
      useUndoStore.getState().push({
        description: 'Remove report widget',
        undo: async () => {
          const restored = await api.addWidget(widget.pageId, {
            type: widget.type,
            meta: widget.type === 'custom-report' ? undefined : widget.meta,
            customReportId: widget.customReportId ?? undefined,
          });
          restoredId = restored.id;
          // Put it back where it was
          await api.saveLayout(widget.pageId, [
            {
              id: restored.id,
              x: widget.x,
              y: widget.y,
              width: widget.width,
              height: widget.height,
            },
          ]);
          qc.invalidateQueries({ queryKey: widgetsKey(widget.pageId) });
        },
        redo: async () => {
          await api.deleteWidget(restoredId);
          qc.invalidateQueries({ queryKey: widgetsKey(widget.pageId) });
        },
      });
    },
  });
}
