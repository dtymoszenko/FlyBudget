import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as rulesApi from '../api/rules';
import { useUndoStore } from '../store/undoStore';
import type { Rule, RuleInput } from '../types';

const QK = ['rules'];

const toInput = (r: Rule): RuleInput => ({
  conditionsOp: r.conditionsOp,
  conditions: r.conditions,
  actions: r.actions,
  enabled: r.enabled,
  sortOrder: r.sortOrder,
});

export function useRules() {
  return useQuery({ queryKey: QK, queryFn: rulesApi.getRules });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: RuleInput) => rulesApi.createRule(data),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: QK });
      let current = created;
      useUndoStore.getState().push({
        description: `Create rule`,
        undo: async () => {
          await rulesApi.deleteRule(current.id);
          qc.invalidateQueries({ queryKey: QK });
        },
        redo: async () => {
          current = await rulesApi.createRule(toInput(created));
          qc.invalidateQueries({ queryKey: QK });
        },
      });
    },
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<RuleInput>) =>
      rulesApi.updateRule(id, data),
    onMutate: async ({ id }) => {
      const rules = qc.getQueryData<Rule[]>(QK);
      return { old: rules?.find((r) => r.id === id) };
    },
    onSuccess: (_, { id, ...data }, ctx) => {
      qc.invalidateQueries({ queryKey: QK });
      if (!ctx?.old) return;
      const snapshot = toInput(ctx.old);
      useUndoStore.getState().push({
        description: data.enabled !== undefined && Object.keys(data).length === 1
          ? `${data.enabled ? 'Enable' : 'Disable'} rule`
          : `Edit rule`,
        undo: async () => {
          await rulesApi.updateRule(id, snapshot);
          qc.invalidateQueries({ queryKey: QK });
        },
        redo: async () => {
          await rulesApi.updateRule(id, data);
          qc.invalidateQueries({ queryKey: QK });
        },
      });
    },
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      const rules = qc.getQueryData<Rule[]>(QK);
      const snapshot = rules?.find((r) => r.id === id);
      return rulesApi.deleteRule(id).then(() => snapshot);
    },
    onSuccess: (snapshot) => {
      qc.invalidateQueries({ queryKey: QK });
      if (!snapshot) return;
      let current = snapshot;
      useUndoStore.getState().push({
        description: `Delete rule`,
        undo: async () => {
          current = await rulesApi.createRule(toInput(snapshot));
          qc.invalidateQueries({ queryKey: QK });
        },
        redo: async () => {
          await rulesApi.deleteRule(current.id);
          qc.invalidateQueries({ queryKey: QK });
        },
      });
    },
  });
}

export function useReorderRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => {
      const rules = qc.getQueryData<Rule[]>(QK);
      const oldIds = rules?.map((r) => r.id) ?? [];
      return rulesApi.reorderRules(ids).then(() => oldIds);
    },
    onSuccess: (oldIds, newIds) => {
      qc.invalidateQueries({ queryKey: QK });
      useUndoStore.getState().push({
        description: `Reorder rules`,
        undo: async () => {
          await rulesApi.reorderRules(oldIds);
          qc.invalidateQueries({ queryKey: QK });
        },
        redo: async () => {
          await rulesApi.reorderRules(newIds);
          qc.invalidateQueries({ queryKey: QK });
        },
      });
    },
  });
}

/** Apply rules to existing transactions (the ones ticked in the preview) */
export function useApplyRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rulesApi.applyRules,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['budget'] });
      qc.invalidateQueries({ queryKey: ['payees'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}
