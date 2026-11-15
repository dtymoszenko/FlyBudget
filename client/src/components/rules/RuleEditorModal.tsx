import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { Plus, Trash2, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CurrencyInput } from '../ui/CurrencyInput';
import { AmountFields, useAmountValidity } from '../ui/amountValidity';
import { CategorySelectButton } from '../transactions/CategorySelectButton';
import { MerchantSelect } from '../transactions/MerchantSelect';
import { OptionPicker, type PickerOption } from './OptionPicker';
import { useRuleLookups } from './useRuleLookups';
import { testConditions } from '../../api/rules';
import { useDebounce } from '../../hooks/useDebounce';
import { useCanSave } from '../../hooks/useConnection';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import { formatCurrency } from '../../utils/currency';
import {
  ACTION_TYPES,
  CONDITION_FIELDS,
  fieldHint,
  isConditionComplete,
  isRuleComplete,
  makeAction,
  makeCondition,
  newAction,
  newCondition,
  newSplitPart,
  opLabel,
} from '../../utils/ruleFormat';
import type {
  RuleAction,
  RuleCondition,
  RuleConditionField,
  RuleConditionOp,
  RuleInput,
  RuleSplitPart,
} from '../../types';
import { formatDay } from '../../utils/dates';

const fieldClass =
  'text-sm border border-border rounded-lg px-2 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-400';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  initial: RuleInput;
  /** Offer "apply to existing transactions" (checked by default when true) */
  applyDefault?: boolean;
  saving?: boolean;
  onSave: (rule: RuleInput, applyToExisting: boolean) => void;
}

export function RuleEditorModal({
  isOpen,
  onClose,
  title,
  initial,
  applyDefault = false,
  saving,
  onSave,
}: Props) {
  const { t } = useTranslation();
  const [conditionsOp, setConditionsOp] = useState(initial.conditionsOp);
  const [conditions, setConditions] = useState<RuleCondition[]>(initial.conditions);
  const [actions, setActions] = useState<RuleAction[]>(
    initial.actions.length ? initial.actions : [newAction()],
  );
  const [applyExisting, setApplyExisting] = useState(applyDefault);
  const options = useRuleLookups();
  const canSave = useCanSave();

  const rule: RuleInput = { ...initial, conditionsOp, conditions, actions };
  const complete = isRuleComplete(rule);
  // Amounts in conditions or split parts that can't be read: the rule would keep the old ones
  const { allValid: amountsValid, report } = useAmountValidity();

  const setCondition = (i: number, c: RuleCondition) =>
    setConditions((cs) => cs.map((x, j) => (j === i ? c : x)));
  const setAction = (i: number, a: RuleAction) =>
    setActions((as) => as.map((x, j) => (j === i ? a : x)));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      <AmountFields report={report}>
        <div className="space-y-6">
          <section>
            <div className="flex items-center gap-2 mb-2 text-sm text-text-secondary">
              {/* One sentence with the all/any choice in it, so it can change places */}
              <Trans
                i18nKey="rules.editor.match"
                components={{
                  strong: <span className="font-medium" />,
                  choice: (
                    <select
                      value={conditionsOp}
                      onChange={(e) => setConditionsOp(e.target.value as 'and' | 'or')}
                      className={`${fieldClass} py-1`}
                      aria-label={t('rules.editor.matchLabel')}
                    >
                      <option value="and">{t('rules.editor.matchAll')}</option>
                      <option value="or">{t('rules.editor.matchAny')}</option>
                    </select>
                  ),
                }}
              />
            </div>
            <div className="space-y-2">
              {conditions.map((c, i) => (
                <ConditionRow
                  key={i}
                  condition={c}
                  options={options}
                  onChange={(next) => setCondition(i, next)}
                  onRemove={() => setConditions((cs) => cs.filter((_, j) => j !== i))}
                />
              ))}
              {!conditions.length && (
                <p className="text-xs text-caution bg-surface-alt rounded-lg px-3 py-2">
                  {t('rules.editor.noConditions')}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setConditions((cs) => [...cs, newCondition()])}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 cursor-pointer"
            >
              <Plus size={12} /> {t('rules.editor.addCondition')}
            </button>
          </section>

          <section>
            <p className="text-sm font-medium text-text-secondary mb-2">{t('rules.editor.then')}</p>
            <div className="space-y-2">
              {actions.map((a, i) => (
                <ActionRow
                  key={i}
                  action={a}
                  canRemove={actions.length > 1}
                  onChange={(next) => setAction(i, next)}
                  onRemove={() => setActions((as) => as.filter((_, j) => j !== i))}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setActions((as) => [...as, newAction()])}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 cursor-pointer"
            >
              <Plus size={12} /> {t('rules.editor.addAction')}
            </button>
          </section>

          <MatchPreview conditionsOp={conditionsOp} conditions={conditions} options={options} />

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border-light">
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={applyExisting}
                onChange={(e) => setApplyExisting(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-brand-600"
              />
              {t('rules.editor.applyAfterSave')}
            </label>
            <div className="flex items-center gap-3 ml-auto">
              <SavingPausedHint />
              <Button variant="secondary" onClick={onClose}>
                {t('common.actions.cancel')}
              </Button>
              <Button
                onClick={() => onSave(rule, applyExisting)}
                disabled={!complete || !amountsValid || saving || !canSave}
              >
                {t(saving ? 'rules.editor.saving' : 'rules.editor.save')}
              </Button>
            </div>
          </div>
        </div>
      </AmountFields>
    </Modal>
  );
}

type Options = ReturnType<typeof useRuleLookups>;

function ConditionRow({
  condition: c,
  options,
  onChange,
  onRemove,
}: {
  condition: RuleCondition;
  options: Options;
  onChange: (c: RuleCondition) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const fieldDef = CONDITION_FIELDS.find((f) => f.value === c.field)!;
  const hint = fieldHint(c.field);

  return (
    <div className="flex flex-wrap items-start gap-2">
      <select
        value={c.field}
        title={hint}
        onChange={(e) => {
          const field = e.target.value as RuleConditionField;
          const ops = CONDITION_FIELDS.find((f) => f.value === field)!.ops;
          onChange(makeCondition(field, ops.includes(c.op) ? c.op : ops[0], c));
        }}
        className={`${fieldClass} w-44`}
        aria-label={t('rules.editor.field')}
      >
        {CONDITION_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>
            {t(`rules.fields.${f.value}`)}
          </option>
        ))}
      </select>
      {c.field !== 'direction' && (
        <select
          value={c.op}
          onChange={(e) => onChange(makeCondition(c.field, e.target.value as RuleConditionOp, c))}
          className={`${fieldClass} w-40`}
          aria-label={t('rules.editor.operator')}
        >
          {fieldDef.ops.map((op) => (
            <option key={op} value={op}>
              {opLabel(c.field, op)}
            </option>
          ))}
        </select>
      )}
      <div className="flex-1 min-w-48 flex gap-2 items-center">
        <ConditionValue condition={c} options={options} onChange={onChange} />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="p-1.5 text-text-tertiary hover:text-negative transition-colors cursor-pointer"
        aria-label={t('rules.editor.removeCondition')}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function ConditionValue({
  condition: c,
  options,
  onChange,
}: {
  condition: RuleCondition;
  options: Options;
  onChange: (c: RuleCondition) => void;
}) {
  const { t } = useTranslation();
  if (!('value' in c)) return null;
  const set = (value: unknown) => onChange({ ...c, value } as RuleCondition);

  if (c.field === 'direction') {
    return (
      <select
        value={c.value}
        onChange={(e) => set(e.target.value)}
        className={`${fieldClass} w-40`}
      >
        <option value="outflow">{t('rules.direction.outflow')}</option>
        <option value="inflow">{t('rules.direction.inflow')}</option>
      </select>
    );
  }
  if (c.field === 'amount') {
    const money = (value: number, onValue: (n: number) => void) => (
      <CurrencyInput value={value} onChange={onValue} className={`${fieldClass} w-full`} />
    );
    if (Array.isArray(c.value)) {
      const [lo, hi] = c.value;
      return (
        <>
          {money(lo, (n) => set([n, hi]))}
          <span className="text-xs text-text-tertiary">{t('rules.editor.rangeAnd')}</span>
          {money(hi, (n) => set([lo, n]))}
        </>
      );
    }
    return money(c.value, set);
  }
  if (c.field === 'date') {
    const input = (value: string, onValue: (v: string) => void) => (
      <input
        type="date"
        value={value}
        onChange={(e) => onValue(e.target.value)}
        className={`${fieldClass} w-full`}
      />
    );
    if (Array.isArray(c.value)) {
      const [a, b] = c.value;
      return (
        <>
          {input(a, (v) => set([v, b]))}
          <span className="text-xs text-text-tertiary">{t('rules.editor.rangeAnd')}</span>
          {input(b, (v) => set([a, v]))}
        </>
      );
    }
    return input(c.value, set);
  }

  const idOptions: Record<string, PickerOption[]> = {
    payee: options.payeeOptions,
    account: options.accountOptions,
    category: options.categoryOptions,
  };
  const pickFrom = idOptions[c.field];
  if (pickFrom) {
    return Array.isArray(c.value) ? (
      <OptionPicker
        multiple
        options={pickFrom}
        value={c.value}
        onChange={set}
        placeholder={t('rules.editor.chooseMany')}
      />
    ) : (
      <OptionPicker
        options={pickFrom}
        value={c.value}
        onChange={set}
        placeholder={t('rules.editor.chooseOne')}
      />
    );
  }
  if (Array.isArray(c.value)) return <TagInput value={c.value} onChange={set} />;
  return (
    <input
      value={c.value}
      onChange={(e) => set(e.target.value)}
      placeholder={t(c.op === 'regex' ? 'rules.editor.regexExample' : 'rules.editor.text')}
      maxLength={c.op === 'regex' ? 200 : 500}
      className={`${fieldClass} w-full ${c.op === 'regex' ? 'font-mono' : ''}`}
    />
  );
}

/** Free-text list: Enter or comma adds an entry, Backspace on an empty box removes the last */
function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const add = () => {
    const text = draft.trim();
    if (text && !value.some((v) => v.toLowerCase() === text.toLowerCase())) {
      onChange([...value, text]);
    }
    setDraft('');
  };
  return (
    <div
      className={`${fieldClass} w-full flex flex-wrap items-center gap-1 py-1 focus-within:ring-1 focus-within:ring-brand-400`}
    >
      {value.map((v) => (
        <span
          key={v}
          className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-surface-alt text-xs text-text"
        >
          {v}
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x !== v))}
            className="text-text-tertiary hover:text-negative cursor-pointer"
            aria-label={t('rules.editor.removeValue', { value: v })}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={add}
        placeholder={value.length ? '' : t('rules.editor.addValue')}
        className="flex-1 min-w-24 bg-transparent outline-none text-sm py-0.5"
      />
    </div>
  );
}

function ActionRow({
  action: a,
  canRemove,
  onChange,
  onRemove,
}: {
  action: RuleAction;
  canRemove: boolean;
  onChange: (a: RuleAction) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { lookups } = useRuleLookups();
  return (
    <div className="rounded-lg">
      <div className="flex flex-wrap items-start gap-2">
        <select
          value={a.type}
          onChange={(e) => onChange(makeAction(e.target.value as RuleAction['type'], a))}
          className={`${fieldClass} w-52`}
          aria-label={t('rules.editor.action')}
        >
          {ACTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`rules.actionTypes.${type}`)}
            </option>
          ))}
        </select>
        <div className="flex-1 min-w-48">
          {a.type === 'set_category' && (
            <CategorySelectButton
              value={a.value || null}
              onChange={(id) => onChange({ ...a, value: id ?? '' })}
              placeholder={t('rules.editor.chooseCategory')}
            />
          )}
          {a.type === 'set_payee' && (
            <MerchantSelect
              value={{ id: a.value || null, name: (a.value && lookups.payee(a.value)) || '' }}
              onChange={(v) => onChange({ ...a, value: v.id ?? '' })}
              placeholder={t('rules.editor.choosePayee')}
            />
          )}
          {(a.type === 'set_notes' || a.type === 'prepend_notes' || a.type === 'append_notes') && (
            <input
              value={a.value}
              onChange={(e) => onChange({ ...a, value: e.target.value })}
              placeholder={t(
                a.type === 'set_notes'
                  ? 'rules.editor.clearNotesHint'
                  : 'rules.editor.notesExample',
              )}
              maxLength={5000}
              className={`${fieldClass} w-full`}
            />
          )}
          {a.type === 'split' && (
            <p className="text-xs text-text-tertiary pt-2">{t('rules.editor.splitHint')}</p>
          )}
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 text-text-tertiary hover:text-negative transition-colors cursor-pointer"
            aria-label={t('rules.editor.removeAction')}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {a.type === 'split' && (
        <SplitEditor parts={a.parts} onChange={(parts) => onChange({ ...a, parts })} />
      )}
    </div>
  );
}

function SplitEditor({
  parts,
  onChange,
}: {
  parts: RuleSplitPart[];
  onChange: (p: RuleSplitPart[]) => void;
}) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<RuleSplitPart>) =>
    onChange(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const pctTotal = parts.filter((p) => p.kind === 'percent').reduce((s, p) => s + p.value, 0);
  const hasRemainder = parts.some((p) => p.kind === 'remainder');

  return (
    <div className="mt-2 ml-2 pl-4 border-l-2 border-border-light space-y-2">
      {parts.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select
            value={p.kind}
            onChange={(e) => {
              const kind = e.target.value as RuleSplitPart['kind'];
              set(i, { kind, value: kind === 'percent' ? 50 : 0 });
            }}
            className={`${fieldClass} w-32`}
            aria-label={t('rules.split.kind')}
          >
            <option value="fixed">{t('rules.split.kinds.fixed')}</option>
            <option value="percent">{t('rules.split.kinds.percent')}</option>
            <option value="remainder">{t('rules.split.kinds.remainder')}</option>
          </select>
          <div className="w-28">
            {p.kind === 'fixed' && (
              <CurrencyInput
                value={p.value}
                onChange={(n) => set(i, { value: n })}
                className={`${fieldClass} w-full`}
              />
            )}
            {p.kind === 'percent' && (
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={p.value}
                  onChange={(e) =>
                    set(i, { value: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })
                  }
                  className={`${fieldClass} w-full pr-6`}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-tertiary">
                  %
                </span>
              </div>
            )}
            {p.kind === 'remainder' && (
              <span className="text-xs text-text-tertiary">{t('rules.split.whatsLeft')}</span>
            )}
          </div>
          <div className="flex-1 min-w-40">
            <CategorySelectButton
              value={p.categoryId}
              onChange={(id) => set(i, { categoryId: id })}
              placeholder={t('rules.split.category')}
            />
          </div>
          <input
            value={p.notes ?? ''}
            onChange={(e) => set(i, { notes: e.target.value || null })}
            placeholder={t('rules.split.notes')}
            maxLength={5000}
            className={`${fieldClass} w-32`}
          />
          <button
            type="button"
            onClick={() => onChange(parts.filter((_, j) => j !== i))}
            disabled={parts.length === 1}
            className="p-1.5 text-text-tertiary hover:text-negative disabled:opacity-30 transition-colors cursor-pointer"
            aria-label={t('rules.split.remove')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onChange([...parts, newSplitPart(hasRemainder ? 'fixed' : 'remainder')])}
          className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 cursor-pointer"
        >
          <Plus size={12} /> {t('rules.split.add')}
        </button>
        {pctTotal > 100 ? (
          <span className="text-xs text-negative">{t('rules.split.over100')}</span>
        ) : (
          !hasRemainder && (
            <span className="text-xs text-text-tertiary">{t('rules.split.leftover')}</span>
          )
        )}
      </div>
    </div>
  );
}

function MatchPreview({
  conditionsOp,
  conditions,
  options,
}: {
  conditionsOp: 'and' | 'or';
  conditions: RuleCondition[];
  options: Options;
}) {
  const { t } = useTranslation();
  const ready = conditions.every(isConditionComplete);
  const key = useDebounce(JSON.stringify({ conditionsOp, conditions }), 350);
  const { data, isFetching } = useQuery({
    queryKey: ['rules', 'test', key],
    queryFn: () => {
      const parsed = JSON.parse(key) as { conditionsOp: 'and' | 'or'; conditions: RuleCondition[] };
      return testConditions(parsed.conditionsOp, parsed.conditions);
    },
    enabled: ready,
    placeholderData: (prev) => prev,
  });
  const shown = useMemo(() => data?.matches.slice(0, 5) ?? [], [data]);

  return (
    <section className="rounded-lg border border-border-light overflow-hidden">
      <div className="px-3 py-2 bg-surface-alt border-b border-border-light text-xs font-medium text-text-secondary">
        {!ready
          ? t('rules.preview.incomplete')
          : !data
            ? t('rules.preview.checking')
            : data.count === 0
              ? t('rules.preview.none')
              : data.count > shown.length
                ? t('rules.preview.latest', {
                    matches: t('rules.preview.matches', { count: data.count }),
                    count: shown.length,
                  })
                : t('rules.preview.matches', { count: data.count })}
        {isFetching && data && (
          <span className="ml-2 text-text-tertiary">{t('rules.preview.updating')}</span>
        )}
      </div>
      {ready &&
        shown.map((tx) => (
          <div
            key={tx.id}
            className="flex items-center gap-3 px-3 py-1.5 text-xs border-b last:border-b-0 border-border-light"
          >
            <span className="w-20 shrink-0 text-text-tertiary">{formatDay(tx.date)}</span>
            <span className="flex-1 truncate text-text">{tx.payeeName ?? '—'}</span>
            <span className="hidden sm:block w-40 truncate text-text-tertiary">
              {(tx.categoryId && options.lookups.category(tx.categoryId)) ||
                t('rules.names.uncategorized')}
            </span>
            <span
              className={`w-24 text-right tabular-nums ${tx.amount < 0 ? 'text-text' : 'text-positive'}`}
            >
              {formatCurrency(tx.amount)}
            </span>
          </div>
        ))}
    </section>
  );
}
