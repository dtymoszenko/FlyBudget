import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, ArrowRight, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUpdateTransaction } from '../../hooks/useTransactions';
import { useTransferToAccount } from '../../hooks/useTransfers';
import { useCanSave } from '../../hooks/useConnection';
import { useUpdatePayee } from '../../hooks/usePayees';
import { CategoryPicker } from './CategoryPicker';
import { PayeePicker } from './PayeePicker';
import { PayeeIcon } from '../payees/PayeeIcon';
import { formatMoney } from '../../utils/currency';
import { useAccountCurrency } from '../../hooks/useCurrency';
import { ForeignValue } from '../currency/ForeignValue';
import { usePreferencesStore } from '../../store/preferencesStore';
import { AccountIcon } from '../accounts/AccountIcon';
import type { Transaction, CategoryGroup, PayeeWithCount } from '../../types';

interface Props {
  tx: Transaction;
  categoryEntry: { name: string; icon: string | null } | null;
  categoryMap: Map<string, { name: string; icon: string | null }>;
  groups: CategoryGroup[];
  payees: PayeeWithCount[];
  accountName?: string;
  accountType?: string;
  accountLogo?: string | null;
  showAccountCol?: boolean;
  isSelected?: boolean;
  onOpenDetail: (id: string) => void;
  onFilterCategory?: (catId: string) => void;
  onFilterSearch?: (search: string) => void;
  /** Open accounts, offered as "Transfer: name" in the category picker (except this one's) */
  transferAccounts?: { id: string; name: string }[];
  /** Multi-select: the checkbox shows on hover, or always while anything is selected */
  checked?: boolean;
  selecting?: boolean;
  onToggle?: (id: string, range: boolean) => void;
}

export function TransactionRow({
  tx,
  categoryEntry,
  categoryMap,
  groups,
  payees,
  accountName,
  accountType,
  accountLogo,
  showAccountCol,
  isSelected,
  onOpenDetail,
  onFilterCategory,
  onFilterSearch,
  transferAccounts = [],
  checked = false,
  selecting = false,
  onToggle,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const currency = useAccountCurrency()(tx.accountId);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showPayeePicker, setShowPayeePicker] = useState(false);
  const updateTx = useUpdateTransaction();
  const transferTo = useTransferToAccount();
  // Making a transfer needs the server: not offered while saving is paused
  const canSave = useCanSave();
  const updatePayee = useUpdatePayee();
  const navigate = useNavigate();
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);

  const isTransfer = !!tx.transferTransactionId;
  const isSplitParent = tx.isParent === 1 && tx.children && tx.children.length > 0;
  const canEditCategory = !tx.reconciled && !isTransfer && !isSplitParent;
  const canEditPayee = !tx.reconciled && !isTransfer;

  const payeeName = tx.payeeName || (isTransfer ? 'Transfer' : '—');
  const payee = useMemo(
    () => (tx.payeeId ? payees.find((p) => p.id === tx.payeeId) : undefined),
    [payees, tx.payeeId],
  );

  function handleCategoryChange(catId: string | null) {
    if (catId?.startsWith('transfer:')) {
      transferTo.mutate({ id: tx.id, accountId: catId.slice('transfer:'.length) });
    } else {
      updateTx.mutate({ id: tx.id, data: { categoryId: catId } });
    }
    setShowCategoryPicker(false);
  }

  function handlePayeeChange(payeeId: string, name: string) {
    updateTx.mutate({ id: tx.id, data: { payeeId, payeeName: name } });
    setShowPayeePicker(false);
  }

  const arrowBase =
    'opacity-0 w-9 h-9 max-md:hidden flex items-center justify-center border border-border rounded-lg hover:bg-hover text-text-tertiary hover:text-text-secondary transition-opacity shrink-0';

  return (
    <div>
      <div
        // Phones: the payee gets its own line, the other columns wrap below it
        // The select checkbox sits in the left padding, so rows keep their layout
        className={`group/row relative flex max-md:flex-wrap items-center py-2 pr-4 ${onToggle ? 'pl-7' : 'pl-4'} cursor-pointer border-b border-border-light transition-colors ${
          isSelected
            ? 'bg-brand-50 border-l-2 border-l-brand-600'
            : checked
              ? 'bg-brand-50/60 hover:bg-brand-50'
              : 'bg-surface hover:bg-hover'
        }`}
        onClick={() => onOpenDetail(tx.id)}
        // Keyboard users open the details with Enter or Space, like a button
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onOpenDetail(tx.id);
          }
        }}
        data-testid="transaction-row"
      >
        {onToggle && (
          <div
            className={`absolute left-1.5 top-1/2 -translate-y-1/2 flex items-center transition-opacity ${
              selecting ? '' : 'opacity-0 group-hover/row:opacity-100 focus-within:opacity-100'
            }`}
          >
            <input
              type="checkbox"
              aria-label={`Select ${payeeName}`}
              checked={checked}
              readOnly
              // Shift-click selects the range from the last one ticked
              onMouseDown={(e) => e.shiftKey && e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(tx.id, e.shiftKey);
              }}
              className="h-4 w-4 accent-brand-600 cursor-pointer"
            />
          </div>
        )}

        {/* Payee */}
        <div className="group/payee flex items-center gap-1 flex-[3] max-md:basis-full min-w-0 relative mr-3">
          <PayeeIcon
            name={payeeName}
            logo={payee?.logo}
            transfer={isTransfer}
            onLogoChange={payee ? (logo) => updatePayee.mutate({ id: payee.id, logo }) : undefined}
          />
          {canEditPayee ? (
            <button
              className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all group-hover/payee:border group-hover/payee:border-border group-hover/payee:bg-surface cursor-pointer border border-transparent min-w-0"
              onClick={(e) => {
                e.stopPropagation();
                setShowPayeePicker(!showPayeePicker);
              }}
            >
              <span className="text-sm font-medium text-text truncate">{payeeName}</span>
              <ChevronDown
                size={12}
                className="opacity-0 group-hover/payee:opacity-100 text-text-tertiary shrink-0 transition-opacity ml-auto"
              />
            </button>
          ) : (
            <span className="text-sm font-medium text-text truncate">{payeeName}</span>
          )}
          {tx.payeeName && onFilterSearch && (
            <button
              className={`${arrowBase} group-hover/payee:opacity-100`}
              onClick={(e) => {
                e.stopPropagation();
                onFilterSearch(tx.payeeName!);
              }}
              title={`Show all "${tx.payeeName}" transactions`}
            >
              <ArrowRight size={12} />
            </button>
          )}

          {showPayeePicker && (
            <PayeePicker
              value={tx.payeeId ?? null}
              payeeName={tx.payeeName ?? null}
              onChange={handlePayeeChange}
              payees={payees}
              onClose={() => setShowPayeePicker(false)}
            />
          )}
        </div>

        {/* Category */}
        <div className="group/cat flex items-center gap-1 flex-[2] min-w-0 relative mr-3">
          {isSplitParent ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="flex items-center gap-1 text-brand-600 hover:text-brand-700"
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="text-sm">Split ({tx.children!.length})</span>
            </button>
          ) : isTransfer ? (
            <span className="text-sm text-brand-500">Transfer</span>
          ) : (
            <>
              <button
                className={`flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all min-w-0 ${
                  canEditCategory
                    ? 'group-hover/cat:border group-hover/cat:border-border group-hover/cat:bg-surface cursor-pointer'
                    : ''
                } border border-transparent`}
                onClick={
                  canEditCategory
                    ? (e) => {
                        e.stopPropagation();
                        setShowCategoryPicker(!showCategoryPicker);
                      }
                    : (e) => e.stopPropagation()
                }
                disabled={!canEditCategory}
              >
                {showCategoryIcons && categoryEntry?.icon && (
                  <span className="text-base shrink-0">{categoryEntry.icon}</span>
                )}
                <span
                  className={`text-sm truncate ${categoryEntry ? 'text-text-secondary' : 'text-text-disabled'}`}
                >
                  {categoryEntry?.name ?? '—'}
                </span>
                {canEditCategory && (
                  <ChevronDown
                    size={12}
                    className="opacity-0 group-hover/cat:opacity-100 text-text-tertiary shrink-0 transition-opacity ml-auto"
                  />
                )}
              </button>
              {tx.categoryId && onFilterCategory && (
                <button
                  className={`${arrowBase} group-hover/cat:opacity-100`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterCategory(tx.categoryId!);
                  }}
                  title={`Show all "${categoryEntry?.name}" transactions`}
                >
                  <ArrowRight size={12} />
                </button>
              )}
            </>
          )}

          {showCategoryPicker && (
            <CategoryPicker
              value={tx.categoryId}
              onChange={handleCategoryChange}
              groups={groups}
              onClose={() => setShowCategoryPicker(false)}
              transferAccounts={
                // A balance correction can't be a transfer
                canSave && !tx.isAdjustment
                  ? transferAccounts.filter((a) => a.id !== tx.accountId)
                  : []
              }
            />
          )}
        </div>

        {/* Account */}
        {showAccountCol && (
          <div className="group/acct flex items-center gap-1 flex-[2] min-w-0">
            <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-transparent group-hover/acct:border-border group-hover/acct:bg-surface transition-all min-w-0">
              <AccountIcon name={accountName} type={accountType} logo={accountLogo} size="sm" />
              <span className="text-sm text-text-secondary truncate">{accountName || '—'}</span>
            </div>
            <button
              className={`${arrowBase} group-hover/acct:opacity-100`}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/accounts/${tx.accountId}`);
              }}
              title={`Go to ${accountName}`}
            >
              <ArrowRight size={12} />
            </button>
          </div>
        )}

        {/* Reconciled */}
        {tx.reconciled ? (
          <div className="w-8 flex justify-center shrink-0">
            <Lock size={12} className="text-text-disabled" />
          </div>
        ) : (
          <div className="w-8 shrink-0" />
        )}

        {/* Amount, in its account's currency (with the budget's value under it when they differ) */}
        <div className="w-24 text-right shrink-0 mx-2">
          <span
            className={`block text-sm font-medium tabular-nums ${tx.amount > 0 ? 'text-positive' : 'text-text'}`}
          >
            {formatMoney(Math.abs(tx.amount), currency)}
          </span>
          <ForeignValue tx={tx} className="block" />
        </div>

        {/* Detail panel arrow */}
        <div className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors shrink-0">
          <ArrowRight size={14} className="text-text-tertiary" />
        </div>
      </div>

      {/* Split children */}
      {isSplitParent &&
        expanded &&
        tx.children!.map((child) => {
          const childCat = child.categoryId ? categoryMap.get(child.categoryId) : null;
          return (
            <div
              key={child.id}
              className="flex items-center pl-16 pr-4 py-2 bg-surface-alt border-b border-border-light"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {childCat ? (
                  <>
                    {showCategoryIcons && childCat.icon && (
                      <span className="text-sm shrink-0">{childCat.icon}</span>
                    )}
                    <span className="text-xs text-text-tertiary truncate">{childCat.name}</span>
                  </>
                ) : (
                  <span className="text-xs text-text-disabled">&mdash;</span>
                )}
                {child.notes && (
                  <span className="text-xs text-text-disabled truncate ml-2">{child.notes}</span>
                )}
              </div>
              <span
                className={`text-xs tabular-nums shrink-0 ${child.amount > 0 ? 'text-positive' : 'text-text-secondary'}`}
              >
                {formatMoney(Math.abs(child.amount), currency)}
              </span>
            </div>
          );
        })}
    </div>
  );
}
