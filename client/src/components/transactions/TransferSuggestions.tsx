import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ArrowLeftRight, ArrowRight } from 'lucide-react';
import {
  useDismissTransferSuggestion,
  useLinkTransfers,
  useTransferSuggestions,
} from '../../hooks/useTransfers';
import { useCanSave } from '../../hooks/useConnection';
import { formatMoney } from '../../utils/currency';
import { useAccountCurrency } from '../../hooks/useCurrency';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import type { Transaction, TransferSuggestion } from '../../types';
import { formatDay } from '../../utils/dates';

interface Props {
  /** The account whose register this is (all accounts when absent) */
  accountId?: string;
  accountName: (id: string) => string | undefined;
}

const keyOf = (s: TransferSuggestion) => `${s.outflow.id}|${s.inflow.id}`;
const shortDate = (date: string) => formatDay(date);

/**
 * Transfers hiding among ordinary transactions: the same amount leaving one account and
 * arriving in another within a few days, usually both sides imported from the banks. Shown
 * above the register; linking them keeps them out of spending and income.
 */
export function TransferSuggestions({ accountId, accountName }: Props) {
  const { t } = useTranslation();
  const { data: suggestions = [] } = useTransferSuggestions(accountId);
  const [open, setOpen] = useState(false);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const linkMany = useLinkTransfers();
  const dismiss = useDismissTransferSuggestion();
  const canSave = useCanSave();

  if (suggestions.length === 0 && !notice) return null;

  const ticked = suggestions.filter((s) => !unticked.has(keyOf(s)));
  const count = suggestions.length;

  function toggle(s: TransferSuggestion) {
    const key = keyOf(s);
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function linkTicked() {
    const pairs = ticked.map((s) => ({
      transactionId: s.outflow.id,
      otherTransactionId: s.inflow.id,
    }));
    linkMany.mutate(pairs, {
      onSuccess: ({ linked, failed, interrupted }) => {
        setOpen(false);
        setNotice(
          [
            t('transactions.suggestions.notice.linked', { count: linked.length }),
            failed ? t('transactions.suggestions.notice.failed', { count: failed }) : '',
            interrupted ? t('transactions.suggestions.notice.interrupted') : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      },
    });
  }

  return (
    <>
      <section
        aria-label={t('transactions.suggestions.section')}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b border-brand-100 bg-brand-50"
      >
        <ArrowLeftRight size={15} className="text-brand-600 shrink-0" aria-hidden />
        <span className="flex-1 min-w-0 text-sm text-text">
          {count > 0 ? (
            <>
              <span className="font-medium">
                {t('transactions.suggestions.heading', { count })}
              </span>{' '}
              <span className="text-text-secondary">{t('transactions.suggestions.explain')}</span>
              {notice && (
                <span role="status" className="block text-text-secondary">
                  {notice}
                </span>
              )}
            </>
          ) : (
            <span role="status">{notice}</span>
          )}
        </span>
        {count > 0 ? (
          <Button
            size="sm"
            onClick={() => {
              setUnticked(new Set());
              setNotice(null);
              setOpen(true);
            }}
          >
            {t('transactions.suggestions.review')}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            {t('transactions.suggestions.dismiss')}
          </Button>
        )}
      </section>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t('transactions.suggestions.title')}
        size="xl"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            <Trans
              i18nKey="transactions.suggestions.intro"
              components={{ emphasis: <span className="font-medium" /> }}
            />
          </p>
          <ul className="divide-y divide-border-light border border-border-light rounded-lg max-h-[50vh] overflow-y-auto">
            {suggestions.map((s) => (
              <SuggestionRow
                key={keyOf(s)}
                suggestion={s}
                accountName={accountName}
                checked={!unticked.has(keyOf(s))}
                onToggle={() => toggle(s)}
                onDismiss={() =>
                  dismiss.mutate({
                    transactionId: s.outflow.id,
                    otherTransactionId: s.inflow.id,
                  })
                }
                disabled={!canSave}
              />
            ))}
          </ul>
          {linkMany.isError && (
            <p role="alert" className="text-sm text-negative">
              {t('transactions.suggestions.linkFailed')}
            </p>
          )}
          {dismiss.isError && (
            <p role="alert" className="text-sm text-negative">
              {t('transactions.suggestions.dismissFailed')}
            </p>
          )}
          <SavingPausedHint />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('transactions.suggestions.cancel')}
            </Button>
            <Button
              onClick={linkTicked}
              disabled={!canSave || ticked.length === 0 || linkMany.isPending}
            >
              {linkMany.isPending
                ? t('transactions.suggestions.linking')
                : t('transactions.suggestions.link', { count: ticked.length })}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

interface RowProps {
  suggestion: TransferSuggestion;
  accountName: (id: string) => string | undefined;
  checked: boolean;
  onToggle: () => void;
  onDismiss: () => void;
  disabled: boolean;
}

function SuggestionRow({
  suggestion,
  accountName,
  checked,
  onToggle,
  onDismiss,
  disabled,
}: RowProps) {
  const { t } = useTranslation();
  const { outflow, inflow } = suggestion;
  const currencyOf = useAccountCurrency();
  const sent = formatMoney(-outflow.amount, currencyOf(outflow.accountId));
  const received = formatMoney(inflow.amount, currencyOf(inflow.accountId));
  // Between currencies: what left and what arrived
  const amount =
    currencyOf(outflow.accountId) === currencyOf(inflow.accountId)
      ? sent
      : t('transactions.suggestions.row.amountChange', { sent, received });
  const from =
    accountName(outflow.accountId) ?? t('transactions.suggestions.row.anotherAccountFrom');
  const to = accountName(inflow.accountId) ?? t('transactions.suggestions.row.anotherAccountTo');
  const side = (tx: Transaction, account: string) => (
    <span className="block min-w-0">
      <span className="block text-sm text-text truncate">{account}</span>
      <span className="block text-xs text-text-tertiary truncate">
        {t('transactions.suggestions.row.side', {
          date: shortDate(tx.date),
          payee: tx.payeeName || t('transactions.suggestions.row.noPayee'),
        })}
      </span>
    </span>
  );

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <label className="flex flex-1 min-w-0 items-center gap-3 cursor-pointer max-md:min-h-11">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={t('transactions.suggestions.row.linkAria', { amount, from, to })}
          className="h-4 w-4 shrink-0 rounded border-border text-brand-600 focus:ring-brand-500"
        />
        <span className="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {side(outflow, from)}
          <ArrowRight size={14} className="text-text-tertiary" aria-hidden />
          {side(inflow, to)}
        </span>
        <span className="text-sm font-medium tabular-nums text-text shrink-0">{amount}</span>
      </label>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        disabled={disabled}
        aria-label={t('transactions.suggestions.row.notTransferAria', { amount, from, to })}
      >
        {t('transactions.suggestions.row.notTransfer')}
      </Button>
    </li>
  );
}
