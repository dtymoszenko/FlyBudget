import { useState } from 'react';
import { ChevronDown, Trash2, X } from 'lucide-react';
import { useBulkTransactions } from '../../hooks/useTransactions';
import { useCanSave } from '../../hooks/useConnection';
import { CategoryPicker } from './CategoryPicker';
import { PayeePicker } from './PayeePicker';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import type { CategoryGroup, PayeeWithCount, Transaction } from '../../types';

interface Props {
  /** The selected transactions that are still listed */
  txs: Transaction[];
  /** How many are listed in all, for "Select all" */
  total: number;
  groups: CategoryGroup[];
  payees: PayeeWithCount[];
  onSelectAll: () => void;
  /** Clears the selection (after an action, or the ✕) */
  onDone: () => void;
}

/**
 * Replaces the register's toolbar while transactions are selected: one change for all of
 * them. Rows that can't take a change are skipped and counted, not refused: reconciled
 * rows take nothing, transfers keep their category and payee, and a split's category lives
 * in its parts.
 */
export function BulkActionBar({ txs, total, groups, payees, onSelectAll, onDone }: Props) {
  const [picker, setPicker] = useState<'category' | 'payee' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { update, remove } = useBulkTransactions();
  const canSave = useCanSave();
  const busy = !canSave || update.isPending || remove.isPending;
  // A failed batch leaves the selection in place: say so, instead of nothing happening
  const failure = (update.error ?? remove.error) as Error | null;

  const unlocked = txs.filter((t) => !t.reconciled);
  const deletable = unlocked.map((t) => t.id);
  const deleting = `${deletable.length} transaction${deletable.length === 1 ? '' : 's'}`;
  const payeeable = unlocked.filter((t) => !t.transferTransactionId).map((t) => t.id);
  const categorizable = unlocked
    .filter((t) => !t.transferTransactionId && t.isParent !== 1)
    .map((t) => t.id);
  const locked = txs.length - unlocked.length;

  const pickerButton = (which: 'category' | 'payee', label: string, enabled: boolean) => (
    <Button
      variant="secondary"
      size="sm"
      disabled={busy || !enabled}
      onClick={() => setPicker(picker === which ? null : which)}
      aria-expanded={picker === which}
    >
      {label} <ChevronDown size={12} />
    </Button>
  );

  return (
    <>
      <span className="text-sm font-medium text-text">
        {txs.length} selected
        {locked > 0 && (
          <span className="font-normal text-text-tertiary"> ({locked} reconciled, left as is)</span>
        )}
      </span>
      {txs.length < total && (
        <button
          onClick={onSelectAll}
          className="text-xs text-brand-600 hover:text-brand-700 font-medium max-md:min-h-11 max-md:px-2"
        >
          Select all {total}
        </button>
      )}
      {failure && (
        <span role="alert" className="text-xs text-negative">
          {failure.message}
        </span>
      )}
      <SavingPausedHint />
      <div className="flex items-center gap-2 ml-auto">
        <div className="relative">
          {pickerButton('category', 'Set category', categorizable.length > 0)}
          {picker === 'category' && (
            <CategoryPicker
              value={null}
              groups={groups}
              onClose={() => setPicker(null)}
              onChange={(categoryId) => {
                setPicker(null);
                remove.reset(); // only the latest action's failure is shown
                update.mutate({ ids: categorizable, data: { categoryId } }, { onSuccess: onDone });
              }}
            />
          )}
        </div>
        <div className="relative">
          {pickerButton('payee', 'Set payee', payeeable.length > 0)}
          {picker === 'payee' && (
            <PayeePicker
              value={null}
              payeeName={null}
              payees={payees}
              onClose={() => setPicker(null)}
              onChange={(payeeId, payeeName) => {
                setPicker(null);
                remove.reset(); // only the latest action's failure is shown
                update.mutate(
                  { ids: payeeable, data: { payeeId, payeeName } },
                  { onSuccess: onDone },
                );
              }}
            />
          )}
        </div>
        <Button
          variant="danger"
          size="sm"
          disabled={busy || deletable.length === 0}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 size={13} /> Delete
        </Button>
        <button
          onClick={onDone}
          aria-label="Clear selection"
          className="p-1.5 max-md:min-w-11 max-md:min-h-11 flex items-center justify-center rounded hover:bg-hover text-text-tertiary hover:text-text-secondary"
        >
          <X size={14} />
        </button>
      </div>
      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          update.reset();
          remove.mutate(deletable, { onSuccess: onDone });
        }}
        title={`Delete ${deleting}`}
        message={`Delete ${deleting}? This can't be undone.`}
        confirmLabel="Delete"
        danger
      />
    </>
  );
}
