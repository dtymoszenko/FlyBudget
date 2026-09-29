import { useMemo, useState } from 'react';
import { Plus, ChevronDown, ChevronRight, Target } from 'lucide-react';
import { differenceInCalendarDays, differenceInCalendarMonths, format, parseISO } from 'date-fns';
import { useGoals, useCreateGoal, useUpdateGoal, useDeleteGoal } from '../hooks/useGoals';
import { useAccounts } from '../hooks/useAccounts';
import { GoalFormModal } from '../components/goals/GoalFormModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useModalValue } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { docsUrl } from '../utils/project';
import { Card } from '../components/ui/Card';
import { StatCardRow } from '../components/reports/ChartHelpers';
import RowMenu from '../components/ui/RowMenu';
import { formatCurrency } from '../utils/currency';
import { usePreferencesStore } from '../store/preferencesStore';
import type { Goal } from '../types';

function progressOf(goal: Goal) {
  const pct =
    goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
  return { pct, remaining: Math.max(0, goal.targetAmount - goal.currentAmount) };
}

/** Target date status, plus the monthly amount needed to get there on time (Monarch-style). */
function scheduleOf(goal: Goal, remaining: number) {
  if (!goal.targetDate) return null;
  const target = parseISO(goal.targetDate);
  const today = new Date();
  const days = differenceInCalendarDays(target, today);
  const date = format(target, 'MMM d, yyyy');
  if (remaining === 0) return { date, overdue: false, perMonth: null };
  if (days < 0) return { date, overdue: true, perMonth: null };
  const months = Math.max(1, differenceInCalendarMonths(target, today));
  // Rounded up to whole dollars, so following it always gets there on time
  return { date, overdue: false, perMonth: Math.ceil(remaining / months / 100) * 100 };
}

function GoalIcon({ goal }: { goal: Goal }) {
  const showIcons = usePreferencesStore((s) => s.showCategoryIcons);
  return (
    <div className="w-9 h-9 rounded-lg bg-surface-alt border border-border-light flex items-center justify-center shrink-0">
      {showIcons ? (
        <span className="text-lg leading-none">{goal.icon}</span>
      ) : (
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: goal.color }} />
      )}
    </div>
  );
}

function GoalRow({
  goal,
  accountName,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  accountName: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { pct, remaining } = progressOf(goal);
  const complete = remaining === 0 && goal.targetAmount > 0;
  const schedule = scheduleOf(goal, remaining);
  const details = [schedule && `Target ${schedule.date}`, accountName].filter(Boolean).join(' · ');

  return (
    <div
      onClick={onEdit}
      className="px-5 py-4 hover:bg-hover cursor-pointer transition-colors last:rounded-b-lg"
    >
      <div className="flex items-center gap-3">
        <GoalIcon goal={goal} />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-text truncate block">{goal.name}</span>
          {details && <span className="text-xs text-text-tertiary mt-0.5 block">{details}</span>}
        </div>
        <div className="text-right shrink-0">
          <span className="text-sm font-medium tabular-nums text-text block">
            {formatCurrency(goal.currentAmount)}
          </span>
          <span className="text-xs text-text-tertiary tabular-nums block mt-0.5">
            of {formatCurrency(goal.targetAmount)}
          </span>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <RowMenu
            items={[
              { label: 'Edit goal', onClick: onEdit },
              { label: 'Delete goal', onClick: onDelete, danger: true },
            ]}
          />
        </div>
      </div>

      <div className="mt-3 pl-12">
        <div className="h-1.5 rounded-full bg-surface-alt overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${complete ? 'bg-positive' : ''}`}
            style={complete ? { width: '100%' } : { width: `${pct}%`, backgroundColor: goal.color }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-xs">
          <span className={complete ? 'text-positive font-medium' : 'text-text-secondary'}>
            {complete ? (
              'Goal reached'
            ) : schedule?.overdue ? (
              <span className="text-negative">
                Past target date · {formatCurrency(remaining)} to go
              </span>
            ) : (
              <>
                {formatCurrency(remaining)} to go
                {schedule?.perMonth != null && (
                  <span className="text-text-tertiary">
                    {' '}
                    · {formatCurrency(schedule.perMonth)}/mo to reach it on time
                  </span>
                )}
              </>
            )}
          </span>
          <span className="tabular-nums text-text-tertiary">{Math.floor(pct)}%</span>
        </div>
      </div>
    </div>
  );
}

function GoalGroup({
  label,
  goals,
  accountNames,
  onEdit,
  onDelete,
  defaultCollapsed = false,
}: {
  label: string;
  goals: Goal[];
  accountNames: Map<string, string>;
  onEdit: (g: Goal) => void;
  onDelete: (g: Goal) => void;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const saved = goals.reduce((s, g) => s + g.currentAmount, 0);

  return (
    <Card padding="none">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={`w-full flex items-center justify-between px-5 py-3.5 hover:bg-hover transition-colors ${
          collapsed ? 'rounded-lg' : 'rounded-t-lg border-b border-border'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-text-tertiary">
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </span>
          <span className="text-base font-semibold text-text">{label}</span>
          <span className="text-xs text-text-tertiary">
            {goals.length} goal{goals.length !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="text-base font-semibold tabular-nums text-text">
          {formatCurrency(saved)}
        </span>
      </button>
      {!collapsed && (
        <div className="divide-y divide-border-light">
          {goals.map((goal) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              accountName={goal.accountId ? (accountNames.get(goal.accountId) ?? null) : null}
              onEdit={() => onEdit(goal)}
              onDelete={() => onDelete(goal)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

export default function GoalsPage() {
  const { data: goals = [], isLoading } = useGoals();
  const { data: accounts = [] } = useAccounts();
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();

  const [addOpen, setAddOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const editModal = useModalValue(editGoal);
  const [deleting, setDeleting] = useState<Goal | null>(null);

  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const inProgress = goals.filter((g) => progressOf(g).remaining > 0 || g.targetAmount <= 0);
  const completed = goals.filter((g) => progressOf(g).remaining === 0 && g.targetAmount > 0);

  const totalSaved = goals.reduce((s, g) => s + g.currentAmount, 0);
  const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0);
  const leftToSave = goals.reduce((s, g) => s + progressOf(g).remaining, 0);
  const overallPct = totalTarget > 0 ? Math.floor((totalSaved / totalTarget) * 100) : 0;

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-surface">
        <div className="px-6 py-4 border-b border-border shrink-0">
          <div className="h-5 w-32 bg-surface-alt rounded animate-pulse" />
        </div>
        <div className="p-6 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-surface-alt rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 py-4 border-b border-border shrink-0 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text">Goals</h1>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={14} /> Add Goal
        </Button>
      </div>

      {goals.length === 0 ? (
        <div className="flex-1 flex items-center justify-center overflow-y-auto">
          <EmptyState
            icon={<Target size={26} />}
            title="Save for what matters"
            description="Set a target like an emergency fund, a trip or a new car, and see how close you are and how much to set aside each month."
            learnMoreHref={docsUrl('goals')}
            actions={
              <Button onClick={() => setAddOpen(true)}>
                <Plus size={14} /> Add Goal
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 pt-5 pb-6 space-y-4">
            <StatCardRow
              variant="hero"
              cards={[
                {
                  label: 'Saved',
                  value: formatCurrency(totalSaved),
                  sub: `${overallPct}% of target`,
                },
                { label: 'Target', value: formatCurrency(totalTarget) },
                { label: 'Left to save', value: formatCurrency(leftToSave) },
                {
                  label: 'Goals reached',
                  value: `${completed.length} of ${goals.length}`,
                  tone: completed.length > 0 ? 'positive' : undefined,
                },
              ]}
            />
            {inProgress.length > 0 && (
              <GoalGroup
                label="In progress"
                goals={inProgress}
                accountNames={accountNames}
                onEdit={setEditGoal}
                onDelete={setDeleting}
              />
            )}
            {completed.length > 0 && (
              <GoalGroup
                label="Completed"
                goals={completed}
                accountNames={accountNames}
                onEdit={setEditGoal}
                onDelete={setDeleting}
              />
            )}
          </div>
        </div>
      )}

      <GoalFormModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={(data) => createGoal.mutate(data)}
      />

      {editModal.value && (
        <GoalFormModal
          key={editModal.value.id}
          isOpen={editModal.isOpen}
          onClose={() => setEditGoal(null)}
          onSave={(data) => updateGoal.mutate({ id: editModal.value!.id, data })}
          editGoal={editModal.value}
        />
      )}

      <ConfirmModal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteGoal.mutate(deleting.id);
        }}
        title="Delete Goal"
        message={`Delete "${deleting?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
