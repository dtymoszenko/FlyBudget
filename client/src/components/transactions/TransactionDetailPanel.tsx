import { useState, useEffect } from 'react';
import { X, ArrowLeftRight, Lock, Trash2, Repeat, Unlink, Wand2 } from 'lucide-react';
import { useUpdateTransaction, useDeleteTransaction } from '../../hooks/useTransactions';
import { useSchedules, useUnmatchByTransaction } from '../../hooks/useSchedules';
import { CategoryPicker } from './CategoryPicker';
import { PayeeCombobox } from './PayeeCombobox';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useModalValue } from '../ui/Modal';
import { RuleEditorFlow } from '../rules/RuleEditorFlow';
import { PayeeIcon } from '../payees/PayeeIcon';
import { useUpdatePayee } from '../../hooks/usePayees';
import { usePreferencesStore } from '../../store/preferencesStore';
import { AccountIcon } from '../accounts/AccountIcon';
import { formatCurrency } from '../../utils/currency';
import { RECURRENCE_TYPE_LABELS } from '../../types';
import type {
  Transaction,
  CategoryGroup,
  Payee,
  Account,
  RuleCondition,
  RuleInput,
} from '../../types';

interface Props {
  transaction: Transaction;
  categoryMap: Map<string, { name: string; icon: string | null }>;
  groups: CategoryGroup[];
  payees: Payee[];
  accounts: Account[];
  accountName?: string;
  accountType?: string;
  accountLogo?: string | null;
  onClose: () => void;
}

export function TransactionDetailPanel({
  transaction: tx,
  categoryMap,
  groups,
  payees,
  accounts,
  accountName,
  accountType,
  accountLogo,
  onClose,
}: Props) {
  const updateTx = useUpdateTransaction();
  const updatePayee = useUpdatePayee();
  const deleteTx = useDeleteTransaction();
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { data: schedules = [] } = useSchedules();
  const unmatchByTx = useUnmatchByTransaction();
  const linkedSchedule = tx.scheduleId ? schedules.find((s) => s.id === tx.scheduleId) : null;
  const freqMap = new Map(RECURRENCE_TYPE_LABELS.map((f) => [f.value, f.label]));

  const [localDate, setLocalDate] = useState(tx.date);
  const [localNotes, setLocalNotes] = useState(tx.notes ?? '');
  const [localPayee, setLocalPayee] = useState({ id: tx.payeeId, name: tx.payeeName ?? '' });
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<RuleInput | null>(null);
  const ruleModal = useModalValue(ruleDraft);

  useEffect(() => {
    setLocalDate(tx.date);
    setLocalNotes(tx.notes ?? '');
    setLocalPayee({ id: tx.payeeId, name: tx.payeeName ?? '' });
    setShowCategoryPicker(false);
  }, [tx.id, tx.date, tx.notes, tx.payeeId, tx.payeeName]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !showCategoryPicker && !showDeleteConfirm && !ruleDraft) onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, showCategoryPicker, showDeleteConfirm, ruleDraft]);

  const isReconciled = tx.reconciled === 1;
  const isTransfer = !!tx.transferTransactionId;
  const isSplitParent = tx.isParent === 1 && tx.children && tx.children.length > 0;
  const canEditCategory = !isReconciled && !isTransfer && !isSplitParent;

  const payeeName = tx.payeeName || (isTransfer ? 'Transfer' : '—');
  const payee = tx.payeeId ? payees.find((p) => p.id === tx.payeeId) : undefined;
  const categoryEntry = tx.categoryId ? (categoryMap.get(tx.categoryId) ?? null) : null;

  function saveDate() {
    if (localDate !== tx.date) {
      updateTx.mutate({ id: tx.id, data: { date: localDate } });
    }
  }

  function saveNotes() {
    const val = localNotes || null;
    if (val !== tx.notes) {
      updateTx.mutate({ id: tx.id, data: { notes: val } });
    }
  }

  function handlePayeeChange(v: { id: string | null; name: string }) {
    setLocalPayee(v);
    if (v.id !== null) {
      updateTx.mutate({ id: tx.id, data: { payeeId: v.id, payeeName: v.name || null } });
    }
  }

  function savePayeeOnBlur() {
    if (localPayee.id !== tx.payeeId || localPayee.name !== (tx.payeeName ?? '')) {
      updateTx.mutate({
        id: tx.id,
        data: { payeeId: localPayee.id, payeeName: localPayee.name || null },
      });
    }
  }

  function handleCategoryChange(catId: string | null) {
    updateTx.mutate({ id: tx.id, data: { categoryId: catId } });
    setShowCategoryPicker(false);
  }

  /** A rule matching this transaction's payee that sets its current category */
  function startRule() {
    const condition: RuleCondition = tx.payeeId
      ? { field: 'payee', op: 'is', value: tx.payeeId }
      : { field: 'payee_name', op: 'is', value: tx.payeeName ?? '' };
    setRuleDraft({
      conditionsOp: 'and',
      conditions: [condition],
      actions: [{ type: 'set_category', value: tx.categoryId ?? '' }],
      enabled: true,
    });
  }

  function handleDelete() {
    deleteTx.mutate(tx.id, { onSuccess: onClose });
  }

  const inputCls =
    'w-full text-sm border border-border rounded-lg px-3 py-2 bg-surface text-text focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <aside
      aria-label="Transaction details"
      className="w-96 shrink-0 border-l border-border bg-surface flex flex-col h-full"
    >
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium text-text-secondary">Transaction Details</span>
        <button
          onClick={onClose}
          aria-label="Close details"
          className="p-1 rounded hover:bg-hover text-text-tertiary hover:text-text-secondary"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <PayeeIcon
              name={payeeName}
              logo={payee?.logo}
              transfer={isTransfer}
              size="lg"
              onLogoChange={
                payee ? (logo) => updatePayee.mutate({ id: payee.id, logo }) : undefined
              }
            />
            <div>
              <div className="text-base font-semibold text-text">{payeeName}</div>
              {accountName && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <AccountIcon name={accountName} type={accountType} logo={accountLogo} size="xs" />
                  <span className="text-xs text-text-tertiary">{accountName}</span>
                </div>
              )}
            </div>
          </div>
          <span
            className={`text-lg font-semibold tabular-nums ${tx.amount > 0 ? 'text-positive' : 'text-text'}`}
          >
            {formatCurrency(Math.abs(tx.amount))}
          </span>
        </div>

        {isReconciled && (
          <div className="flex items-center gap-2 px-3 py-2 bg-surface-alt rounded-lg text-text-tertiary text-xs">
            <Lock size={12} />
            <span>This transaction is reconciled and cannot be edited.</span>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-text-secondary mb-1.5 block">Date</label>
          <input
            type="date"
            aria-label="Date"
            value={localDate}
            onChange={(e) => setLocalDate(e.target.value)}
            onBlur={saveDate}
            disabled={isReconciled}
            className={inputCls}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-text-secondary mb-1.5 block">Category</label>
          {isSplitParent ? (
            <div className="space-y-2">
              <div className="text-sm text-brand-600 font-medium">
                Split ({tx.children!.length})
              </div>
              {tx.children!.map((child) => {
                const childCat = child.categoryId ? categoryMap.get(child.categoryId) : null;
                return (
                  <div key={child.id} className="flex items-center justify-between text-sm pl-2">
                    <div className="flex items-center gap-1.5">
                      {showCategoryIcons && childCat?.icon && (
                        <span className="text-sm">{childCat.icon}</span>
                      )}
                      <span className="text-text-secondary">
                        {childCat?.name ?? 'Uncategorized'}
                      </span>
                    </div>
                    <span className="tabular-nums text-text-tertiary">
                      {formatCurrency(Math.abs(child.amount))}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : isTransfer ? (
            <div className="text-sm text-brand-500 px-3 py-2 border border-border rounded-lg bg-surface-alt">
              Transfer
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={() => canEditCategory && setShowCategoryPicker(!showCategoryPicker)}
                disabled={isReconciled}
                className={`${inputCls} text-left flex items-center gap-2 ${canEditCategory ? 'cursor-pointer' : ''}`}
              >
                {showCategoryIcons && categoryEntry?.icon && (
                  <span className="text-base">{categoryEntry.icon}</span>
                )}
                <span className={categoryEntry ? '' : 'text-text-tertiary'}>
                  {categoryEntry?.name ?? 'Uncategorized'}
                </span>
              </button>
              {showCategoryPicker && (
                <CategoryPicker
                  value={tx.categoryId}
                  onChange={handleCategoryChange}
                  groups={groups}
                  onClose={() => setShowCategoryPicker(false)}
                />
              )}
            </div>
          )}
        </div>

        {!isTransfer && (
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1.5 block">Payee</label>
            <div onBlur={savePayeeOnBlur}>
              <PayeeCombobox
                value={localPayee}
                onChange={handlePayeeChange}
                payees={payees}
                className={`border border-border rounded-lg px-3 py-2 focus:border-brand-600 focus:ring-1 focus:ring-brand-600 ${isReconciled ? 'opacity-60 pointer-events-none' : ''}`}
              />
            </div>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-text-secondary mb-1.5 block">Notes</label>
          <textarea
            value={localNotes}
            onChange={(e) => setLocalNotes(e.target.value)}
            onBlur={saveNotes}
            disabled={isReconciled}
            placeholder="Add notes to this transaction..."
            aria-label="Notes"
            rows={3}
            className={`${inputCls} resize-none`}
          />
        </div>

        {linkedSchedule && (
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1.5 block">
              Recurring
            </label>
            <div className="flex items-center gap-3 px-3 py-2.5 bg-surface-alt rounded-lg border border-border-light">
              <Repeat size={14} className="text-brand-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text truncate">{linkedSchedule.name}</p>
                <p className="text-xs text-text-tertiary">
                  {freqMap.get(linkedSchedule.recurrenceType) || linkedSchedule.recurrenceType}
                </p>
              </div>
              {!isReconciled && (
                <button
                  onClick={() => unmatchByTx.mutate(tx.id)}
                  className="p-1 rounded text-text-tertiary hover:text-caution hover:bg-caution-subtle transition-colors"
                  title="Unlink from recurring"
                >
                  <Unlink size={14} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-4 border-t border-border space-y-2">
        {!isTransfer && (
          <Button variant="secondary" onClick={startRule} className="w-full">
            <Wand2 size={14} />
            Create rule
          </Button>
        )}
        {!isReconciled && (
          <Button variant="danger" onClick={() => setShowDeleteConfirm(true)} className="w-full">
            <Trash2 size={14} />
            Delete Transaction
          </Button>
        )}
      </div>

      {ruleModal.value && (
        <RuleEditorFlow
          isOpen={ruleModal.isOpen}
          onClose={() => setRuleDraft(null)}
          initial={ruleModal.value}
          title="New rule from transaction"
        />
      )}

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Transaction"
        message="Are you sure you want to delete this transaction? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onClose={() => setShowDeleteConfirm(false)}
      />
    </aside>
  );
}
