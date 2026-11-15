import { formatCurrency } from './currency';
import type {
  Rule,
  RuleAction,
  RuleCondition,
  RuleConditionField,
  RuleConditionOp,
  RuleInput,
  RuleSplitPart,
} from '../types';
import { formatDay } from './dates';
import { t } from '../i18n';

const TEXT_OPS: RuleConditionOp[] = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'one_of',
  'not_one_of',
  'regex',
  'is_empty',
  'is_not_empty',
];
const ID_OPS: RuleConditionOp[] = ['is', 'is_not', 'one_of', 'not_one_of'];

// Fields, operators and actions are ids: their names are in en.json (rules.fields, rules.ops,
// rules.actionTypes)
export const CONDITION_FIELDS: Array<{
  value: RuleConditionField;
  ops: RuleConditionOp[];
}> = [
  { value: 'payee', ops: [...ID_OPS, 'is_empty', 'is_not_empty'] },
  { value: 'payee_name', ops: TEXT_OPS },
  { value: 'imported_payee', ops: TEXT_OPS },
  { value: 'notes', ops: TEXT_OPS },
  { value: 'amount', ops: ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'between', 'approx'] },
  { value: 'direction', ops: ['is'] },
  { value: 'category', ops: [...ID_OPS, 'is_empty', 'is_not_empty'] },
  { value: 'account', ops: ID_OPS },
  { value: 'date', ops: ['is', 'before', 'after', 'between'] },
];

/** What a field compares, for the fields whose name doesn't say it all */
export function fieldHint(field: RuleConditionField): string | undefined {
  switch (field) {
    case 'payee_name':
    case 'imported_payee':
      return t(`rules.fieldHints.${field}`);
    case 'amount':
      return t('rules.fieldHints.amount', { direction: t('rules.fields.direction') });
    default:
      return undefined;
  }
}

export function opLabel(field: RuleConditionField, op: RuleConditionOp): string {
  if (field === 'date' && op === 'is') return t('rules.ops.isOn');
  if (field === 'category' && op === 'is_empty') return t('rules.ops.isUncategorized');
  if (field === 'category' && op === 'is_not_empty') return t('rules.ops.isCategorized');
  return t(`rules.ops.${op}`);
}

export const ACTION_TYPES: RuleAction['type'][] = [
  'set_category',
  'set_payee',
  'set_notes',
  'prepend_notes',
  'append_notes',
  'split',
];

const today = () => new Date().toISOString().slice(0, 10);
const isTextField = (f: RuleConditionField) =>
  f === 'payee_name' || f === 'imported_payee' || f === 'notes';

/** A condition with a sensible starting value, keeping the old value when it still fits */
export function makeCondition(
  field: RuleConditionField,
  op: RuleConditionOp,
  prev?: RuleCondition,
): RuleCondition {
  const compatible =
    prev && (prev.field === field || (isTextField(prev.field) && isTextField(field)));
  const old = compatible && 'value' in prev ? prev.value : undefined;
  const first = Array.isArray(old) ? old[0] : old;
  const num = typeof first === 'number' ? first : 0;
  const str = typeof first === 'string' ? first : '';

  if (op === 'is_empty' || op === 'is_not_empty') return { field, op } as RuleCondition;
  if (op === 'one_of' || op === 'not_one_of') {
    const list =
      Array.isArray(old) && typeof old[0] === 'string' ? (old as string[]) : str ? [str] : [];
    return { field, op, value: list } as RuleCondition;
  }
  switch (field) {
    case 'amount':
      return op === 'between'
        ? { field, op, value: Array.isArray(old) ? (old as [number, number]) : [num, num] }
        : ({ field, op, value: num } as RuleCondition);
    case 'direction':
      return { field, op: 'is', value: old === 'inflow' ? 'inflow' : 'outflow' };
    case 'date': {
      const d = str || today();
      return op === 'between'
        ? { field, op, value: Array.isArray(old) ? (old as [string, string]) : [d, d] }
        : ({ field, op, value: d } as RuleCondition);
    }
    default:
      return { field, op, value: str } as RuleCondition;
  }
}

export const newCondition = (): RuleCondition => ({
  field: 'payee_name',
  op: 'contains',
  value: '',
});
export const newAction = (): RuleAction => ({ type: 'set_category', value: '' });
export const newSplitPart = (kind: RuleSplitPart['kind'] = 'remainder'): RuleSplitPart => ({
  kind,
  value: kind === 'percent' ? 50 : 0,
  categoryId: null,
  notes: null,
});

export function makeAction(type: RuleAction['type'], prev?: RuleAction): RuleAction {
  if (type === 'split')
    return { type, parts: [newSplitPart('percent'), newSplitPart('remainder')] };
  const keepText =
    prev && prev.type !== 'split' && prev.type.endsWith('notes') && type.endsWith('notes');
  return { type, value: keepText ? (prev as { value: string }).value : '' } as RuleAction;
}

export function isConditionComplete(c: RuleCondition): boolean {
  if (!('value' in c)) return true;
  const v = c.value;
  if (Array.isArray(v))
    return v.length > 0 && v.every((x) => (typeof x === 'string' ? x.trim() !== '' : x >= 0));
  if (typeof v === 'number') return v >= 0;
  return v.trim() !== '';
}

function isActionComplete(a: RuleAction): boolean {
  if (a.type === 'split')
    return a.parts.length > 0 && a.parts.every((p) => p.kind !== 'percent' || p.value <= 100);
  if (a.type === 'set_notes') return true; // empty clears the notes
  return a.value.trim() !== '';
}

export function isRuleComplete(r: Pick<RuleInput, 'conditions' | 'actions'>): boolean {
  return (
    r.actions.length > 0 &&
    r.conditions.every(isConditionComplete) &&
    r.actions.every(isActionComplete)
  );
}

// ---------------------------------------------------------------------------
// Summaries

export type RuleLookups = {
  payee: (id: string) => string | undefined;
  account: (id: string) => string | undefined;
  category: (id: string) => string | undefined;
};

const quote = (text: string) => t('rules.summary.quoted', { text });
const shortDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? formatDay(d) : d);
const deleted = () => t('rules.names.deleted');

function nameOf(field: RuleConditionField, id: string, l: RuleLookups): string {
  const name =
    field === 'payee' ? l.payee(id) : field === 'account' ? l.account(id) : l.category(id);
  return name ?? deleted();
}

// Each kind of condition and action is one phrase in en.json, with the field and values in it
export function conditionText(c: RuleCondition, l: RuleLookups): string {
  if (c.field === 'direction') return t(`rules.direction.${c.value}`);
  const field = t(`rules.fields.${c.field}`);
  if (!('value' in c)) {
    if (c.field === 'category') {
      return t(
        c.op === 'is_empty'
          ? 'rules.summary.condition.isUncategorized'
          : 'rules.summary.condition.isCategorized',
        { field },
      );
    }
    return t(`rules.summary.condition.${c.op}`, { field });
  }
  const isId = c.field === 'payee' || c.field === 'account' || c.field === 'category';
  const one = (v: string) => (isId ? nameOf(c.field, v, l) : quote(v));

  let value: string;
  if (c.field === 'amount') {
    if (Array.isArray(c.value)) {
      const [from, to] = c.value.map((v) => formatCurrency(v));
      return t('rules.summary.condition.between', { field, from, to });
    }
    value = formatCurrency(c.value);
  } else if (c.field === 'date') {
    if (Array.isArray(c.value)) {
      const [from, to] = c.value.map(shortDate);
      return t('rules.summary.condition.between', { field, from, to });
    }
    value = shortDate(c.value);
    if (c.op === 'is') return t('rules.summary.condition.isOn', { field, value });
  } else if (Array.isArray(c.value)) {
    value = c.value.map(one).join(', ');
  } else {
    value = c.op === 'regex' ? `/${c.value}/` : one(c.value);
  }
  return t(`rules.summary.condition.${c.op}`, { field, value });
}

function splitPartText(p: RuleSplitPart, l: RuleLookups): string {
  const category = p.categoryId
    ? (l.category(p.categoryId) ?? deleted())
    : t('rules.summary.action.uncategorized');
  if (p.kind === 'remainder') return t('rules.summary.action.splitRest', { category });
  const amount = p.kind === 'fixed' ? formatCurrency(p.value) : `${p.value}%`;
  return t('rules.summary.action.splitPart', { amount, category });
}

export function actionText(a: RuleAction, l: RuleLookups): string {
  switch (a.type) {
    case 'set_category':
      return t('rules.summary.action.setCategory', { category: l.category(a.value) ?? deleted() });
    case 'set_payee':
      return t('rules.summary.action.setPayee', { payee: l.payee(a.value) ?? deleted() });
    case 'set_notes':
      return a.value
        ? t('rules.summary.action.setNotes', { text: a.value })
        : t('rules.summary.action.clearNotes');
    case 'prepend_notes':
      return t('rules.summary.action.prependNotes', { text: a.value });
    case 'append_notes':
      return t('rules.summary.action.appendNotes', { text: a.value });
    case 'split':
      return t('rules.summary.action.split', {
        parts: a.parts.map((p) => splitPartText(p, l)).join(', '),
      });
  }
}

/** Plain text of a whole rule, for search (in the language it's shown in) */
export function ruleSearchText(r: Rule, l: RuleLookups): string {
  return [
    ...r.conditions.map((c) => conditionText(c, l)),
    ...r.actions.map((a) => actionText(a, l)),
  ]
    .join(' ')
    .toLowerCase();
}
