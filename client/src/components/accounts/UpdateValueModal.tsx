import { useState } from 'react';
import { format } from 'date-fns';
import { Modal } from '../ui/Modal';
import { useCanSave } from '../../hooks/useConnection';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import { CurrencyInput } from '../ui/CurrencyInput';
import { useCreateTransaction } from '../../hooks/useTransactions';
import { formatCurrency } from '../../utils/currency';
import { isLiabilityType } from '../../utils/accountTypes';
import type { Account } from '../../types';

interface Props {
  /** Render only while open, so the input starts at the current value */
  account: Account;
  onClose: () => void;
}

/**
 * Sets a manually tracked account (home, car, loan, crypto…) to its current value
 * by adding a dated adjustment transaction, so net worth history keeps the change.
 */
export function UpdateValueModal({ account, onClose }: Props) {
  const liability = isLiabilityType(account.type);
  // Debts are entered as the positive amount owed
  const current = liability ? -account.balance : account.balance;
  const [value, setValue] = useState(current);
  const canSave = useCanSave();
  const createTransaction = useCreateTransaction();

  const newBalance = liability ? -Math.abs(value) : value;
  const change = newBalance - account.balance;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (change !== 0) {
      await createTransaction.mutateAsync({
        accountId: account.id,
        date: format(new Date(), 'yyyy-MM-dd'),
        amount: change,
        notes: liability ? 'Balance update' : 'Value update',
        adjustment: true,
      });
    }
    onClose();
  }

  return (
    <Modal isOpen onClose={onClose} title={liability ? 'Update Balance' : 'Update Value'} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            {liability ? 'Amount owed today' : 'Value today'}
          </label>
          <CurrencyInput
            value={value}
            onChange={setValue}
            allowNegative={!liability}
            aria-label={liability ? 'Amount owed today' : 'Value today'}
          />
          <p className="mt-1 text-xs text-text-tertiary">
            Currently {formatCurrency(current)}.
            {change !== 0 && (
              <>
                {' '}
                Adds a{' '}
                <span className={change > 0 ? 'text-positive' : 'text-negative'}>
                  {change > 0 ? '+' : ''}
                  {formatCurrency(change)}
                </span>{' '}
                adjustment dated today.
              </>
            )}
          </p>
        </div>

        <SavingPausedHint className="text-right" />
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-text-secondary bg-surface border border-border rounded-lg hover:bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createTransaction.isPending || !canSave}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {createTransaction.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
