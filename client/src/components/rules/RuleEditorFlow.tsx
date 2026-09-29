import { useState } from 'react';
import { RuleEditorModal } from './RuleEditorModal';
import { ApplyRulesModal } from './ApplyRulesModal';
import { useCreateRule, useRules, useUpdateRule } from '../../hooks/useRules';
import type { Rule, RuleInput } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Edit this rule; otherwise create a new one from `initial` */
  rule?: Rule;
  initial?: RuleInput;
  title?: string;
}

const emptyRule = (): RuleInput => ({
  conditionsOp: 'and',
  conditions: [{ field: 'payee_name', op: 'contains', value: '' }],
  actions: [{ type: 'set_category', value: '' }],
  enabled: true,
});

/** Rule editor that saves the rule, then optionally previews applying it to existing transactions */
export function RuleEditorFlow({ isOpen, onClose, rule, initial, title }: Props) {
  const { data: rules = [] } = useRules();
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const [applyRuleId, setApplyRuleId] = useState<string | null>(null);

  function handleSave(input: RuleInput, applyToExisting: boolean) {
    const done = (saved: Rule) => (applyToExisting ? setApplyRuleId(saved.id) : onClose());
    if (rule) updateRule.mutate({ id: rule.id, ...input }, { onSuccess: done });
    else createRule.mutate({ ...input, sortOrder: rules.length }, { onSuccess: done });
  }

  return (
    <>
      <RuleEditorModal
        isOpen={isOpen && !applyRuleId}
        onClose={onClose}
        title={title ?? (rule ? 'Edit rule' : 'New rule')}
        initial={rule ?? initial ?? emptyRule()}
        saving={createRule.isPending || updateRule.isPending}
        onSave={handleSave}
      />
      {applyRuleId && (
        <ApplyRulesModal
          isOpen={isOpen}
          onClose={onClose}
          ruleIds={[applyRuleId]}
          initialScope="all"
          title="Apply rule to existing transactions"
        />
      )}
    </>
  );
}
