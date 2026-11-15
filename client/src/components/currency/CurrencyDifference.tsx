import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import { useCanSave } from '../../hooks/useConnection';
import { useCategories } from '../../hooks/useCategories';
import { recordCurrencyDifference } from '../../api/currency';
import { formatCurrency } from '../../utils/currency';
import type { Account } from '../../types';

/**
 * On an account in another currency: how much more or less it's worth in the budget's
 * currency than it was counted as, because the rate moved. Recording it is a choice (a gain
 * or loss in a category), never automatic: envelopes don't change behind anyone's back.
 */
export function CurrencyDifference({ account }: { account: Account }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const difference = account.currencyDifference;
  if (!difference) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-xs tabular-nums underline decoration-dotted underline-offset-2 max-md:min-h-11 ${difference > 0 ? 'text-positive' : 'text-negative'}`}
        title={t('currency.difference.why')}
      >
        {t('currency.difference.fromRate', {
          amount: `${difference > 0 ? '+' : ''}${formatCurrency(difference)}`,
        })}
      </button>
      {open && <RecordModal account={account} onClose={() => setOpen(false)} />}
    </>
  );
}

function RecordModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const { t } = useTranslation();
  const difference = account.currencyDifference ?? 0;
  const gain = difference > 0;
  const { data: groups = [] } = useCategories();
  // A gain is income; a loss is spending
  const choices = groups.filter((g) => (g.isIncome === 1) === gain);
  const [categoryId, setCategoryId] = useState('');
  const canSave = useCanSave();
  const qc = useQueryClient();
  const record = useMutation({
    mutationFn: () =>
      recordCurrencyDifference({ accountId: account.id, categoryId: categoryId || null }),
    onSuccess: () => {
      // What the correction changes: the account, its transactions, the budget and reports
      for (const key of [
        'accounts',
        'transactions',
        'budget',
        'budget-summary',
        'reports',
        'currency',
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
  });

  return (
    <Modal isOpen onClose={onClose} title={t('currency.difference.title')} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          <Trans
            i18nKey={gain ? 'currency.difference.gain' : 'currency.difference.loss'}
            values={{ name: account.name, amount: formatCurrency(Math.abs(difference)) }}
            components={{ strong: <strong className="font-medium text-text tabular-nums" /> }}
          />
        </p>
        <div>
          <label
            htmlFor="difference-category"
            className="block text-sm font-medium text-text-secondary mb-1"
          >
            {t('currency.difference.category')}
          </label>
          <select
            id="difference-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">{t('currency.difference.noCategory')}</option>
            {choices.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-tertiary">
            {t('currency.difference.noCategoryHint')}
          </p>
        </div>
        {record.isError && (
          <p role="alert" className="text-xs text-negative">
            {record.error instanceof Error ? record.error.message : t('common.errors.generic')}
          </p>
        )}
        <SavingPausedHint className="text-right" />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={() => record.mutate()} disabled={record.isPending || !canSave}>
            {t('currency.difference.record')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
