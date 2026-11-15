import { useState } from 'react';
import { format } from 'date-fns';
import { Trans, useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { useCanSave } from '../../hooks/useConnection';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import { CurrencyInput } from '../ui/CurrencyInput';
import { useCreateTransaction } from '../../hooks/useTransactions';
import { formatMoney } from '../../utils/currency';
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
  const { t } = useTranslation();
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
        // Saved in the language in use now
        notes: t(liability ? 'accounts.updateValue.balanceNote' : 'accounts.updateValue.valueNote'),
        adjustment: true,
      });
    }
    onClose();
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t(liability ? 'accounts.updateValue.balanceTitle' : 'accounts.updateValue.valueTitle')}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            {t(liability ? 'accounts.updateValue.owedToday' : 'accounts.updateValue.valueToday')}
          </label>
          <CurrencyInput
            currency={account.currency}
            value={value}
            onChange={setValue}
            allowNegative={!liability}
            aria-label={t(
              liability ? 'accounts.updateValue.owedToday' : 'accounts.updateValue.valueToday',
            )}
          />
          <p className="mt-1 text-xs text-text-tertiary">
            {t('accounts.updateValue.current', {
              amount: formatMoney(current, account.currency),
            })}
            {change !== 0 && (
              <>
                {' '}
                <Trans
                  i18nKey="accounts.updateValue.adds"
                  values={{
                    amount: `${change > 0 ? '+' : ''}${formatMoney(change, account.currency)}`,
                  }}
                  components={{
                    change: <span className={change > 0 ? 'text-positive' : 'text-negative'} />,
                  }}
                />
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
            {t('common.actions.cancel')}
          </button>
          <button
            type="submit"
            disabled={createTransaction.isPending || !canSave}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {createTransaction.isPending ? t('accounts.saving') : t('common.actions.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
