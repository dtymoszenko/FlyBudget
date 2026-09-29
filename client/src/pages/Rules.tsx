import { useEffect, useMemo, useState } from 'react';
import { Copy, GripVertical, Pencil, Play, Plus, Search, Trash2, Wand2 } from 'lucide-react';
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
import { useRules, useDeleteRule, useReorderRules, useUpdateRule } from '../hooks/useRules';
import { RuleEditorFlow } from '../components/rules/RuleEditorFlow';
import { ApplyRulesModal } from '../components/rules/ApplyRulesModal';
import { useRuleLookups } from '../components/rules/useRuleLookups';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useModalValue } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import RowMenu from '../components/ui/RowMenu';
import { useIsPhone } from '../hooks/useIsPhone';
import { actionText, conditionText, ruleSearchText, type RuleLookups } from '../utils/ruleFormat';
import type { Rule, RuleInput } from '../types';

type Editing = { key: string; rule?: Rule; initial?: RuleInput; title?: string };
type Applying = { key: string; ruleIds?: string[]; title: string; scope: 'uncategorized' | 'all' };

function RuleRow({
  rule,
  lookups,
  sortable,
  onToggle,
  onEdit,
  onDuplicate,
  onApply,
  onDelete,
  phone,
  onMove,
}: {
  rule: Rule;
  lookups: RuleLookups;
  sortable: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onApply: () => void;
  onDelete: () => void;
  /** Phones: actions in a ⋮ menu (there's no hover) and moving instead of dragging */
  phone: boolean;
  /** Moves the rule one place up (-1) or down (1); absent where it can't move */
  onMove: { up?: () => void; down?: () => void };
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
    disabled: !sortable,
  });
  const joiner = rule.conditionsOp === 'or' ? 'or' : 'and';

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      className="group flex items-start gap-3 px-4 py-3 border-b border-border-light last:border-b-0 hover:bg-hover transition-colors"
    >
      {!phone && (
        <button
          {...attributes}
          {...listeners}
          className={`mt-0.5 text-text-disabled hover:text-text-tertiary touch-none ${sortable ? 'cursor-grab active:cursor-grabbing' : 'invisible'}`}
          aria-label="Drag to reorder"
        >
          <GripVertical size={16} />
        </button>
      )}

      <button
        type="button"
        role="switch"
        aria-checked={rule.enabled}
        aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
        title={rule.enabled ? 'Enabled' : 'Disabled'}
        onClick={onToggle}
        className={
          phone
            ? '-my-3 -ml-2 min-w-11 min-h-11 flex items-center justify-center shrink-0 cursor-pointer'
            : `mt-0.5 relative w-8 h-[18px] rounded-full shrink-0 transition-colors cursor-pointer ${rule.enabled ? 'bg-brand-600' : 'bg-border'}`
        }
      >
        {phone ? (
          <span
            className={`relative w-9 h-5 rounded-full transition-colors ${rule.enabled ? 'bg-brand-600' : 'bg-border'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${rule.enabled ? 'translate-x-4' : ''}`}
            />
          </span>
        ) : (
          <span
            className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${rule.enabled ? 'translate-x-3.5' : ''}`}
          />
        )}
      </button>

      <button
        type="button"
        onClick={onEdit}
        className={`flex-1 min-w-0 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-left cursor-pointer ${rule.enabled ? '' : 'opacity-50'}`}
      >
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary mb-1">
            If
          </p>
          {rule.conditions.length ? (
            <div className="flex flex-wrap items-center gap-1">
              {rule.conditions.map((c, i) => (
                <span key={i} className="contents">
                  {i > 0 && <span className="text-[11px] text-text-tertiary">{joiner}</span>}
                  <span className="px-2 py-0.5 rounded-md bg-surface-alt text-xs text-text break-all">
                    {conditionText(c, lookups)}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-text-secondary">Every transaction</span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary mb-1">
            Then
          </p>
          <div className="flex flex-wrap gap-1">
            {rule.actions.map((a, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded-md bg-brand-50 text-xs text-brand-700 break-all"
              >
                {actionText(a, lookups)}
              </span>
            ))}
          </div>
        </div>
      </button>

      {phone ? (
        <div className="-my-2 -mr-2">
          <RowMenu
            label="Rule actions"
            items={[
              { label: 'Edit', onClick: onEdit },
              { label: 'Duplicate', onClick: onDuplicate },
              { label: 'Apply to existing transactions', onClick: onApply },
              { label: 'Move up', onClick: () => onMove.up?.(), hidden: !onMove.up },
              { label: 'Move down', onClick: () => onMove.down?.(), hidden: !onMove.down },
              { label: 'Delete', danger: true, onClick: onDelete },
            ]}
          />
        </div>
      ) : (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {[
            { icon: Play, label: 'Apply to existing transactions', onClick: onApply },
            { icon: Copy, label: 'Duplicate', onClick: onDuplicate },
            { icon: Pencil, label: 'Edit', onClick: onEdit },
          ].map(({ icon: Icon, label, onClick }) => (
            <button
              key={label}
              onClick={onClick}
              title={label}
              aria-label={label}
              className="p-1.5 text-text-tertiary hover:text-brand-600 rounded transition-colors cursor-pointer"
            >
              <Icon size={14} />
            </button>
          ))}
          <button
            onClick={onDelete}
            title="Delete"
            aria-label="Delete"
            className="p-1.5 text-text-tertiary hover:text-negative rounded transition-colors cursor-pointer"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// Stable while loading: a new [] each render would re-run the effect below forever
const NO_RULES: Rule[] = [];

export default function RulesPage() {
  const { data: rulesData = NO_RULES, isLoading } = useRules();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const reorderRules = useReorderRules();
  const { lookups } = useRuleLookups();

  const [localRules, setLocalRules] = useState<Rule[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [applying, setApplying] = useState<Applying | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const editModal = useModalValue(editing);
  const applyModal = useModalValue(applying);

  useEffect(() => setLocalRules(rulesData), [rulesData]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? localRules.filter((r) => ruleSearchText(r, lookups).includes(q)) : localRules;
  }, [localRules, search, lookups]);
  const enabledCount = localRules.filter((r) => r.enabled).length;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const reordered = arrayMove(
      localRules,
      localRules.findIndex((r) => r.id === active.id),
      localRules.findIndex((r) => r.id === over.id),
    );
    setLocalRules(reordered);
    reorderRules.mutate(reordered.map((r) => r.id));
  }

  const isPhone = useIsPhone();

  /** Phones: move a rule one place up or down (the same order change as dragging) */
  function move(ruleId: string, by: -1 | 1) {
    const from = localRules.findIndex((r) => r.id === ruleId);
    const to = from + by;
    if (from < 0 || to < 0 || to >= localRules.length) return;
    const reordered = arrayMove(localRules, from, to);
    setLocalRules(reordered);
    reorderRules.mutate(reordered.map((r) => r.id));
  }

  const newRule = () => setEditing({ key: `new-${Date.now()}` });

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-text">Rules</h1>
            <p className="text-xs text-text-tertiary mt-0.5">
              Rules run on new and imported transactions, top to bottom. Each matching rule applies,
              and a rule higher up wins when two set the same thing.
            </p>
          </div>
          {/* Phones: the search takes its own line above the buttons */}
          <div className="flex flex-wrap items-center gap-2 max-md:w-full">
            {localRules.length > 0 && (
              <div className="relative max-md:w-full">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search rules…"
                  className="w-44 max-md:w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-full bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
                />
              </div>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setApplying({
                  key: `all-${Date.now()}`,
                  title: 'Run rules',
                  scope: 'uncategorized',
                })
              }
              disabled={enabledCount === 0}
            >
              <Play size={12} /> Run rules
            </Button>
            <Button size="sm" onClick={newRule}>
              <Plus size={13} /> Add rule
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
          <div className="flex flex-col items-center justify-center text-center h-56 gap-3 px-6">
            <Wand2 size={22} className="text-text-tertiary" />
            <p className="text-sm text-text-secondary max-w-md">
              Rules categorize, rename and split transactions for you as they come in. You can also
              make one from any transaction.
            </p>
            <Button size="sm" variant="secondary" onClick={newRule}>
              <Plus size={13} /> Add your first rule
            </Button>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto px-6 py-4">
            <p className="text-xs text-text-tertiary mb-2">
              {search
                ? `${shown.length} of ${localRules.length} rules`
                : `${localRules.length} rule${localRules.length === 1 ? '' : 's'} · ${enabledCount} enabled`}
            </p>
            <div className="bg-surface rounded-lg shadow-card border border-border-light overflow-hidden">
              {shown.length === 0 && (
                <p className="px-4 py-6 text-sm text-text-tertiary text-center">
                  No rules match your search.
                </p>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={shown.map((r) => r.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {shown.map((rule, index) => (
                    <RuleRow
                      key={rule.id}
                      rule={rule}
                      lookups={lookups}
                      sortable={!search}
                      phone={isPhone}
                      onMove={
                        search
                          ? {}
                          : {
                              up: index > 0 ? () => move(rule.id, -1) : undefined,
                              down: index < shown.length - 1 ? () => move(rule.id, 1) : undefined,
                            }
                      }
                      onToggle={() => updateRule.mutate({ id: rule.id, enabled: !rule.enabled })}
                      onEdit={() => setEditing({ key: rule.id, rule })}
                      onDuplicate={() =>
                        setEditing({
                          key: `dup-${rule.id}-${Date.now()}`,
                          title: 'Duplicate rule',
                          initial: {
                            conditionsOp: rule.conditionsOp,
                            conditions: rule.conditions,
                            actions: rule.actions,
                            enabled: rule.enabled,
                          },
                        })
                      }
                      onApply={() =>
                        setApplying({
                          key: `rule-${rule.id}-${Date.now()}`,
                          ruleIds: [rule.id],
                          title: 'Apply rule to existing transactions',
                          scope: 'all',
                        })
                      }
                      onDelete={() => setDeleteId(rule.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        )}
      </div>

      {editModal.value && (
        <RuleEditorFlow
          key={editModal.value.key}
          isOpen={editModal.isOpen}
          onClose={() => setEditing(null)}
          rule={editModal.value.rule}
          initial={editModal.value.initial}
          title={editModal.value.title}
        />
      )}

      {applyModal.value && (
        <ApplyRulesModal
          key={applyModal.value.key}
          isOpen={applyModal.isOpen}
          onClose={() => setApplying(null)}
          ruleIds={applyModal.value.ruleIds}
          initialScope={applyModal.value.scope}
          title={applyModal.value.title}
        />
      )}

      <ConfirmModal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteRule.mutate(deleteId);
        }}
        title="Delete rule"
        message="Delete this rule? Transactions it already changed stay as they are."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
