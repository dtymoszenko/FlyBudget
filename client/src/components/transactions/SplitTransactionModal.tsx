import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AmountFields, useAmountValidity } from '../ui/amountValidity';
import { useFormReset } from '../../hooks/useFormReset';
import { useSetTransactionSplits } from '../../hooks/useTransactions';
import { useCanSave } from '../../hooks/useConnection';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import { formatMoney } from '../../utils/currency';
import { SplitPartsEditor } from './SplitPartsEditor';
import { emptyPart, partsBalanced, partsToSend, type SplitPart } from '../../utils/splitParts';
import type { Transaction } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction;
  currency?: string | null;
}

/** The parts it has, or its own category for the whole amount plus an empty second part */
function startingParts(tx: Transaction): SplitPart[] {
  if (tx.isParent === 1 && tx.children?.length) {
    return tx.children.map((c) => ({
      categoryId: c.categoryId,
      amount: Math.abs(c.amount),
      notes: c.notes ?? '',
    }));
  }
  return [{ categoryId: tx.categoryId, amount: Math.abs(tx.amount), notes: '' }, emptyPart()];
}

/** Split an existing transaction (an import, say) across categories, or change its parts */
export function SplitTransactionModal({ isOpen, onClose, transaction: tx, currency }: Props) {
  const { t } = useTranslation();
  const [parts, setParts] = useState<SplitPart[]>(() => startingParts(tx));
  useFormReset(isOpen ? tx.id : null, () => setParts(startingParts(tx)));
  const canSave = useCanSave();
  const setSplits = useSetTransactionSplits();
  const { allValid, report } = useAmountValidity();
  const total = Math.abs(tx.amount);
  const isSplit = tx.isParent === 1;

  const save = (splits: ReturnType<typeof partsToSend>) =>
    setSplits.mutate({ id: tx.id, splits }, { onSuccess: onClose });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('transactions.splitModal.title')} size="md">
      <AmountFields report={report}>
        <div className="space-y-5">
          <p className="text-sm text-text-secondary">
            <Trans
              i18nKey="transactions.splitModal.intro"
              values={{
                payee: tx.payeeName || t('transactions.splitModal.thisTransaction'),
                amount: formatMoney(total, currency),
              }}
              components={{ amount: <span className="font-medium text-text tabular-nums" /> }}
            />
          </p>
          <SplitPartsEditor parts={parts} onChange={setParts} total={total} currency={currency} />
          {setSplits.isError && (
            <p role="alert" className="text-sm text-negative">
              {t('transactions.splitModal.saveFailed')}
            </p>
          )}
          <div className="flex justify-between gap-3 pt-2">
            <div>
              {isSplit && (
                <Button
                  variant="ghost"
                  onClick={() => save([])}
                  disabled={!canSave || setSplits.isPending}
                  title={t('transactions.splitModal.unsplitHint')}
                >
                  {t('transactions.splitModal.unsplit')}
                </Button>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={onClose}>
                {t('common.actions.cancel')}
              </Button>
              <Button
                onClick={() => save(partsToSend(parts, tx.amount < 0))}
                disabled={
                  !canSave || !allValid || !partsBalanced(total, parts) || setSplits.isPending
                }
              >
                {setSplits.isPending
                  ? t('transactions.splitModal.saving')
                  : t('transactions.splitModal.save')}
              </Button>
            </div>
          </div>
          <SavingPausedHint />
        </div>
      </AmountFields>
    </Modal>
  );
}
