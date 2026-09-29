import { format, parseISO } from 'date-fns';
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

export const CONDITION_FIELDS: Array<{
  value: RuleConditionField;
  label: string;
  ops: RuleConditionOp[];
}> = [
  { value: 'payee', label: 'Payee', ops: [...ID_OPS, 'is_empty', 'is_not_empty'] },
  { value: 'payee_name', label: 'Payee name', ops: TEXT_OPS },
  { value: 'imported_payee', label: 'Imported description', ops: TEXT_OPS },
  { value: 'notes', label: 'Notes', ops: TEXT_OPS },
  {
    value: 'amount',
    label: 'Amount',
    ops: ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'between', 'approx'],
  },
  { value: 'direction', label: 'Inflow / outflow', ops: ['is'] },
  { value: 'category', label: 'Category', ops: [...ID_OPS, 'is_empty', 'is_not_empty'] },
  { value: 'account', label: 'Account', ops: ID_OPS },
  { value: 'date', label: 'Date', ops: ['is', 'before', 'after', 'between'] },
];

export const FIELD_HINTS: Partial<Record<RuleConditionField, string>> = {
  payee_name: 'The payee name as shown on the transaction',
  imported_payee: 'The original text from your bank or CSV, before any renaming',
  amount: 'Compares the amount without its sign; add "Inflow / outflow" to tell them apart',
};

export function opLabel(field: RuleConditionField, op: RuleConditionOp): string {
  if (field === 'date') {
    if (op === 'is') return 'is on';
  }
  if (field === 'category' && op === 'is_empty') return 'is uncategorized';
  if (field === 'category' && op === 'is_not_empty') return 'is categorized';
  const labels: Record<RuleConditionOp, string> = {
    is: 'is',
    is_not: 'is not',
    contains: 'contains',
    not_contains: "doesn't contain",
    starts_with: 'starts with',
    ends_with: 'ends with',
    regex: 'matches regex',
    one_of: 'is one of',
    not_one_of: 'is not one of',
    is_empty: 'is empty',
    is_not_empty: 'is not empty',
    gt: 'is more than',
    gte: 'is at least',
    lt: 'is less than',
    lte: 'is at most',
    between: 'is between',
    approx: 'is about',
    before: 'is before',
    after: 'is after',
  };
  return labels[op];
}

export const ACTION_TYPES: Array<{ value: RuleAction['type']; label: string }> = [
  { value: 'set_category', label: 'Set category' },
  { value: 'set_payee', label: 'Rename payee' },
  { value: 'set_notes', label: 'Set notes' },
  { value: 'prepend_notes', label: 'Add text before notes' },
  { value: 'append_notes', label: 'Add text after notes' },
  { value: 'split', label: 'Split transaction' },
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

const quote = (s: string) => `"${s}"`;
const shortDate = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) ? format(parseISO(d), 'MMM d, yyyy') : d;

function nameOf(field: RuleConditionField, id: string, l: RuleLookups): string {
  const name =
    field === 'payee' ? l.payee(id) : field === 'account' ? l.account(id) : l.category(id);
  return name ?? '(deleted)';
}

export function conditionText(c: RuleCondition, l: RuleLookups): string {
  const field = CONDITION_FIELDS.find((f) => f.value === c.field)?.label ?? c.field;
  if (c.field === 'direction') return c.value === 'inflow' ? 'Is an inflow' : 'Is an outflow';
  const op = opLabel(c.field, c.op);
  if (!('value' in c)) return `${field} ${op}`;
  const isId = c.field === 'payee' || c.field === 'account' || c.field === 'category';
  const one = (v: string) => (isId ? nameOf(c.field, v, l) : quote(v));

  let value: string;
  if (c.field === 'amount') {
    value = Array.isArray(c.value)
      ? `${formatCurrency(c.value[0])} and ${formatCurrency(c.value[1])}`
      : formatCurrency(c.value);
  } else if (c.field === 'date') {
    value = Array.isArray(c.value)
      ? `${shortDate(c.value[0])} and ${shortDate(c.value[1])}`
      : shortDate(c.value);
  } else if (Array.isArray(c.value)) {
    value = c.value.map(one).join(', ');
  } else {
    value = c.op === 'regex' ? `/${c.value}/` : one(c.value);
  }
  return `${field} ${op} ${value}`;
}

function splitPartText(p: RuleSplitPart, l: RuleLookups): string {
  const amount =
    p.kind === 'fixed'
      ? formatCurrency(p.value)
      : p.kind === 'percent'
        ? `${p.value}%`
        : 'the rest';
  return `${amount} to ${p.categoryId ? (l.category(p.categoryId) ?? '(deleted)') : 'uncategorized'}`;
}

export function actionText(a: RuleAction, l: RuleLookups): string {
  switch (a.type) {
    case 'set_category':
      return `Set category to ${l.category(a.value) ?? '(deleted)'}`;
    case 'set_payee':
      return `Rename payee to ${l.payee(a.value) ?? '(deleted)'}`;
    case 'set_notes':
      return a.value ? `Set notes to ${quote(a.value)}` : 'Clear notes';
    case 'prepend_notes':
      return `Add ${quote(a.value)} before notes`;
    case 'append_notes':
      return `Add ${quote(a.value)} after notes`;
    case 'split':
      return `Split: ${a.parts.map((p) => splitPartText(p, l)).join(', ')}`;
  }
}

/** Plain text of a whole rule, for search */
export function ruleSearchText(r: Rule, l: RuleLookups): string {
  return [
    ...r.conditions.map((c) => conditionText(c, l)),
    ...r.actions.map((a) => actionText(a, l)),
  ]
    .join(' ')
    .toLowerCase();
}
