import { useState, useEffect } from 'react';
import { GripVertical, Pencil, Trash2, Plus, Play } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  useRules,
  useCreateRule,
  useUpdateRule,
  useDeleteRule,
  useReorderRules,
  useRunRules,
} from '../hooks/useRules';
import { useCategories } from '../hooks/useCategories';
import { usePreferencesStore } from '../store/preferencesStore';
import { usePayees } from '../hooks/usePayees';
import { previewRules } from '../api/rules';
import { formatCurrency } from '../utils/currency';
import { format, parseISO } from 'date-fns';
import { AddRuleModal } from '../components/rules/AddRuleModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { Modal, useModalValue } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import type { Rule, RuleCondition, RuleAction, RunRulesPreviewItem } from '../types';

function conditionSummary(conditions: RuleCondition[]): string {
  if (!conditions.length) return 'No conditions';
  const c = conditions[0];
  const fieldLabel = c.field === 'payee_name' ? 'Payee' : c.field === 'amount' ? 'Amount' : 'Notes';
  const opLabel = c.op.replace('_', ' ');
  const summary = `${fieldLabel} ${opLabel} "${c.value}"`;
  return conditions.length > 1 ? `${summary} +${conditions.length - 1} more` : summary;
}

function actionSummary(actions: RuleAction[], categories: any[], payees: any[], showCategoryIcons = true): string {
  if (!actions.length) return 'No actions';
  const a = actions[0];
  let val = a.value;
  if (a.field === 'category_id') {
    const cat = categories.find((c: any) => c.id === a.value);
    val = cat ? `${showCategoryIcons && cat.icon ? cat.icon + ' ' : ''}${cat.name}` : a.value;
  } else if (a.field === 'payee_id') {
    val = payees.find((p: any) => p.id === a.value)?.name ?? a.value;
  }
  const label = a.field === 'category_id' ? 'Category' : a.field === 'payee_id' ? 'Payee' : 'Notes';
  const summary = `Set ${label} → ${val}`;
  return actions.length > 1 ? `${summary} +${actions.length - 1} more` : summary;
}

function RunRulesPreviewModal({
  isOpen,
  items,
  onConfirm,
  onClose,
  running,
}: {
  isOpen: boolean;
  items: RunRulesPreviewItem[];
  onConfirm: () => void;
  onClose: () => void;
  running: boolean;
}) {
  const shown = items.slice(0, 10);
  const extra = items.length - shown.length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Run Rules Preview" size="lg">
      <div>
        {items.length === 0 ? (
          <p className="text-sm text-text-secondary py-4 text-center">
            No uncategorized transactions match any rules.
          </p>
        ) : (
          <>
            <p className="text-sm text-text-secondary mb-3">
              <span className="font-semibold text-text">{items.length}</span> transaction
              {items.length !== 1 ? 's' : ''} will be updated:
            </p>
            <div className="rounded-md border border-border-light overflow-hidden mb-3">
              <table className="w-full">
                <thead className="bg-surface-alt border-b border-border-light">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-tertiary">
                      Date
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-tertiary">
                      Payee
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-tertiary">
                      Amount
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-text-tertiary">
                      New category
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {shown.map((item) => (
                    <tr key={item.transactionId}>
                      <td className="px-3 py-2 text-xs text-text-tertiary">
                        {format(parseISO(item.date), 'MMM d')}
                      </td>
                      <td className="px-3 py-2 text-xs text-text max-w-[140px] truncate">
                        {item.payeeName ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-text tabular-nums">
                        {formatCurrency(item.amount)}
                      </td>
                      <td className="px-3 py-2 text-xs font-medium text-positive">
                        {item.newCategoryName ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {extra > 0 && (
                <div className="px-3 py-2 bg-surface-alt text-xs text-text-tertiary border-t border-border-light">
                  + {extra} more
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end gap-3 pt-4">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {items.length > 0 && (
          <Button onClick={onConfirm} disabled={running}>
            {running
              ? 'Applying...'
              : `Apply ${items.length} Change${items.length !== 1 ? 's' : ''}`}
          </Button>
        )}
      </div>
    </Modal>
  );
}

function SortableRuleRow({
  rule,
  categories,
  payees,
  onEdit,
  onDelete,
}: {
  rule: Rule;
  categories: any[];
  payees: any[];
  onEdit: (rule: Rule) => void;
  onDelete: (id: string) => void;
}) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-2.5 border-b border-border-light hover:bg-hover group transition-colors"
    >
      <button
        {...attributes}
        {...listeners}
        className="text-text-disabled hover:text-text-tertiary cursor-grab active:cursor-grabbing touch-none"
        aria-label="Drag to reorder"
      >
        <GripVertical size={16} />
      </button>

      <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-4">
        <div>
          <p className="text-xs text-text-tertiary mb-0.5">If</p>
          <p className="text-sm text-text truncate">{conditionSummary(rule.conditions)}</p>
        </div>
        <div>
          <p className="text-xs text-text-tertiary mb-0.5">Then</p>
          <p className="text-sm text-text truncate">
            {actionSummary(rule.actions, categories, payees, showCategoryIcons)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(rule)}
          className="p-1 text-text-tertiary hover:text-brand-600 rounded transition-colors"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={() => onDelete(rule.id)}
          className="p-1 text-text-tertiary hover:text-negative rounded transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export default function RulesPage() {
  const { data: rulesData = [], isLoading } = useRules();
  const { data: groups = [] } = useCategories();
  const { data: payees = [] } = usePayees();
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const reorderRules = useReorderRules();
  const runRules = useRunRules();

  const [localRules, setLocalRules] = useState<Rule[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<RunRulesPreviewItem[] | null>(null);
  const editModal = useModalValue(editRule);
  const previewModal = useModalValue(previewItems);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    setLocalRules(rulesData);
  }, [rulesData]);

  const allCategories = (groups as any[]).flatMap((g: any) =>
    g.categories.map((c: any) => ({ ...c, groupName: g.name })),
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localRules.findIndex((r) => r.id === active.id);
    const newIndex = localRules.findIndex((r) => r.id === over.id);
    const reordered = arrayMove(localRules, oldIndex, newIndex);
    setLocalRules(reordered);
    reorderRules.mutate(reordered.map((r) => r.id));
  }

  function handleSaveNew(conditions: RuleCondition[], actions: RuleAction[]) {
    createRule.mutate({ conditions, actions, sortOrder: localRules.length });
  }

  function handleSaveEdit(conditions: RuleCondition[], actions: RuleAction[]) {
    if (!editRule) return;
    updateRule.mutate({ id: editRule.id, conditions, actions });
    setEditRule(null);
  }

  async function handleRunRulesClick() {
    setPreviewing(true);
    try {
      const items = await previewRules();
      setPreviewItems(items);
    } finally {
      setPreviewing(false);
    }
  }

  function handleConfirmRun() {
    runRules.mutate(undefined, {
      onSuccess: () => setPreviewItems(null),
    });
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-text">Rules</h1>
            <p className="text-xs text-text-tertiary mt-0.5">
              Rules run automatically on new transactions and can be applied to existing ones.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRunRulesClick}
              disabled={previewing || localRules.length === 0}
            >
              <Play size={12} />
              {previewing ? 'Loading...' : 'Run Rules'}
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus size={13} /> Add Rule
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-sm text-text-tertiary">
            Loading...
          </div>
        ) : localRules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <p className="text-sm text-text-tertiary">
              No rules yet. Add one to start auto-categorizing transactions.
            </p>
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-600 border border-brand-200 rounded-md hover:bg-brand-50 transition-colors"
            >
              <Plus size={13} /> Add your first rule
            </button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-4">
            <div className="bg-surface rounded-lg shadow-card border border-border-light overflow-hidden">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={localRules.map((r) => r.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {localRules.map((rule) => (
                    <SortableRuleRow
                      key={rule.id}
                      rule={rule}
                      categories={allCategories}
                      payees={payees}
                      onEdit={(r) => {
                        setEditRule(r);
                      }}
                      onDelete={(id) => setDeleteId(id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        )}
      </div>

      <AddRuleModal isOpen={addOpen} onClose={() => setAddOpen(false)} onSave={handleSaveNew} />

      {editModal.value && (
        <AddRuleModal
          key={editModal.value.id}
          isOpen={editModal.isOpen}
          onClose={() => setEditRule(null)}
          onSave={handleSaveEdit}
          editRule={editModal.value}
        />
      )}

      <ConfirmModal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteRule.mutate(deleteId);
        }}
        title="Delete Rule"
        message="Delete this rule? Transactions that were already categorized by it will not be changed."
        confirmLabel="Delete"
        danger
      />

      {previewModal.value && (
        <RunRulesPreviewModal
          isOpen={previewModal.isOpen}
          items={previewModal.value}
          onConfirm={handleConfirmRun}
          onClose={() => setPreviewItems(null)}
          running={runRules.isPending}
        />
      )}
    </div>
  );
}
