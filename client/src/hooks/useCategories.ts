import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as categoriesApi from '../api/categories';
import { useUndoStore } from '../store/undoStore';
import type { CategoryGroup, Category } from '../types';
import { t } from '../i18n';

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: categoriesApi.getCategories });
}

function findCategory(groups: CategoryGroup[] | undefined, id: string): Category | undefined {
  if (!groups) return;
  for (const g of groups) {
    const c = g.categories.find((cat) => cat.id === id);
    if (c) return c;
  }
}

function findGroup(groups: CategoryGroup[] | undefined, id: string): CategoryGroup | undefined {
  return groups?.find((g) => g.id === id);
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: categoriesApi.createGroup,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      useUndoStore.getState().push({
        description: t('settings.categories.undo.createGroup', { name: created.name }),
        undo: async () => {
          await categoriesApi.deleteGroup(created.id);
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
        redo: async () => {
          await categoriesApi.createGroup({ name: created.name, isIncome: created.isIncome });
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
      });
    },
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string } }) =>
      categoriesApi.updateGroup(id, data),
    onMutate: async ({ id }) => {
      const groups = qc.getQueryData<CategoryGroup[]>(['categories']);
      return { old: findGroup(groups, id) };
    },
    onSuccess: (_, { id, data }, ctx) => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      if (!ctx?.old) return;
      const snapshot = ctx.old;
      useUndoStore.getState().push({
        description: t('settings.categories.undo.renameGroup'),
        undo: async () => {
          await categoriesApi.updateGroup(id, { name: snapshot.name });
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
        redo: async () => {
          await categoriesApi.updateGroup(id, data);
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
      });
    },
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      const groups = qc.getQueryData<CategoryGroup[]>(['categories']);
      const snapshot = findGroup(groups, id);
      return categoriesApi.deleteGroup(id).then(() => snapshot);
    },
    onSuccess: (snapshot) => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
      if (!snapshot) return;
      useUndoStore.getState().push({
        description: t('settings.categories.undo.deleteGroup', { name: snapshot.name }),
        undo: async () => {
          await categoriesApi.createGroup({ name: snapshot.name, isIncome: snapshot.isIncome });
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
        redo: async () => {
          qc.invalidateQueries({ queryKey: ['categories'] });
          qc.invalidateQueries({ queryKey: ['budget'] });
        },
      });
    },
  });
}

export function useReorderGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => {
      const groups = qc.getQueryData<CategoryGroup[]>(['categories']);
      const oldIds = groups?.map((g) => g.id) ?? [];
      return categoriesApi.reorderGroups(ids).then(() => oldIds);
    },
    onSuccess: (oldIds, newIds) => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      useUndoStore.getState().push({
        description: t('settings.categories.undo.reorderGroups'),
        undo: async () => {
          await categoriesApi.reorderGroups(oldIds);
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
        redo: async () => {
          await categoriesApi.reorderGroups(newIds);
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
      });
    },
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: categoriesApi.createCategory,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      useUndoStore.getState().push({
        description: t('settings.categories.undo.createCategory', { name: created.name }),
        undo: async () => {
          await categoriesApi.deleteCategory(created.id);
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
        redo: async () => {
          await categoriesApi.createCategory({
            groupId: created.groupId,
            name: created.name,
            icon: created.icon ?? undefined,
            budgetType: created.budgetType,
          });
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
      });
    },
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { name?: string; groupId?: string; icon?: string; budgetType?: string | null };
    }) => categoriesApi.updateCategory(id, data),
    onMutate: async ({ id }) => {
      const groups = qc.getQueryData<CategoryGroup[]>(['categories']);
      return { old: findCategory(groups, id) };
    },
    onSuccess: (_, { id, data }, ctx) => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      if (!ctx?.old) return;
      const snapshot = ctx.old;
      useUndoStore.getState().push({
        description: t('settings.categories.undo.editCategory'),
        undo: async () => {
          await categoriesApi.updateCategory(id, {
            name: snapshot.name,
            groupId: snapshot.groupId,
            icon: snapshot.icon ?? undefined,
            budgetType: snapshot.budgetType,
          });
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
        redo: async () => {
          await categoriesApi.updateCategory(id, data);
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
      });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reassignTo }: { id: string; reassignTo?: string }) =>
      categoriesApi.deleteCategory(id, reassignTo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useReorderCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => {
      const groups = qc.getQueryData<CategoryGroup[]>(['categories']);
      const oldIds = groups?.flatMap((g) => g.categories.map((c) => c.id)) ?? [];
      return categoriesApi.reorderCategories(ids).then(() => oldIds);
    },
    onSuccess: (oldIds, newIds) => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      useUndoStore.getState().push({
        description: t('settings.categories.undo.reorderCategories'),
        undo: async () => {
          await categoriesApi.reorderCategories(oldIds);
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
        redo: async () => {
          await categoriesApi.reorderCategories(newIds);
          qc.invalidateQueries({ queryKey: ['categories'] });
        },
      });
    },
  });
}
