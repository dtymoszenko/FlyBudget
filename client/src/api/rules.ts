import { apiFetch } from './client';
import type {
  Rule,
  RuleApplyScope,
  RuleCondition,
  RuleInput,
  RulePreviewItem,
  RuleTestResult,
} from '../types';

/** Which rules to run over existing transactions: every enabled rule, or just `ruleIds` */
export type RuleRunTarget = { ruleIds?: string[]; scope: RuleApplyScope };

export const getRules = () => apiFetch<Rule[]>('/rules');
export const createRule = (data: RuleInput) =>
  apiFetch<Rule>('/rules', { method: 'POST', body: JSON.stringify(data) });
export const updateRule = (id: string, data: Partial<RuleInput>) =>
  apiFetch<Rule>(`/rules/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteRule = (id: string) => apiFetch<void>(`/rules/${id}`, { method: 'DELETE' });
export const reorderRules = (ids: string[]) =>
  apiFetch<{ ok: boolean }>('/rules/reorder', { method: 'PUT', body: JSON.stringify({ ids }) });
export const testConditions = (conditionsOp: Rule['conditionsOp'], conditions: RuleCondition[]) =>
  apiFetch<RuleTestResult>('/rules/test', {
    method: 'POST',
    body: JSON.stringify({ conditionsOp, conditions }),
  });
export const previewRules = (target: RuleRunTarget) =>
  apiFetch<RulePreviewItem[]>('/rules/preview', { method: 'POST', body: JSON.stringify(target) });
export const applyRules = (target: RuleRunTarget & { transactionIds: string[] }) =>
  apiFetch<{ updated: number }>('/rules/apply', { method: 'POST', body: JSON.stringify(target) });
