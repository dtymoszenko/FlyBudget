import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, ArrowLeftRight, ArrowRight, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUpdateTransaction } from '../../hooks/useTransactions';
import { CategoryPicker } from './CategoryPicker';
import { PayeePicker } from './PayeePicker';
import { PayeeIcon } from '../payees/PayeeIcon';
import { formatCurrency } from '../../utils/currency';
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
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showPayeePicker, setShowPayeePicker] = useState(false);
  const updateTx = useUpdateTransaction();
  const navigate = useNavigate();
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);

  const isTransfer = !!tx.transferTransactionId;
  const isSplitParent = tx.isParent === 1 && tx.children && tx.children.length > 0;
  const canEditCategory = !tx.reconciled && !isTransfer && !isSplitParent;
  const canEditPayee = !tx.reconciled && !isTransfer;

  const payeeName = tx.payeeName || (isTransfer ? 'Transfer' : '—');
  const payeeLogo = useMemo(
    () => (tx.payeeId ? payees.find((p) => p.id === tx.payeeId)?.logo : null),
    [payees, tx.payeeId],
  );

  function handleCategoryChange(catId: string | null) {
    updateTx.mutate({ id: tx.id, data: { categoryId: catId } });
    setShowCategoryPicker(false);
  }

  function handlePayeeChange(payeeId: string, name: string) {
    updateTx.mutate({ id: tx.id, data: { payeeId, payeeName: name } });
    setShowPayeePicker(false);
  }

  const arrowBase =
    'opacity-0 w-9 h-9 flex items-center justify-center border border-border rounded-lg hover:bg-hover text-text-tertiary hover:text-text-secondary transition-opacity shrink-0';

  return (
    <div>
      <div
        className={`group/row flex items-center px-4 py-2 cursor-pointer border-b border-border-light transition-colors ${
          isSelected ? 'bg-brand-50 border-l-2 border-l-brand-600' : 'bg-surface hover:bg-hover'
        }`}
        onClick={() => onOpenDetail(tx.id)}
      >
        {/* Payee */}
        <div className="group/payee flex items-center gap-1 flex-[3] min-w-0 relative mr-3">
          <PayeeIcon name={payeeName} logo={payeeLogo} transfer={isTransfer} />
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

        {/* Amount */}
        <div className="w-24 text-right shrink-0 mx-2">
          <span
            className={`text-sm font-medium tabular-nums ${tx.amount > 0 ? 'text-positive' : 'text-text'}`}
          >
            {formatCurrency(Math.abs(tx.amount))}
          </span>
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
                    {showCategoryIcons && childCat.icon && <span className="text-sm shrink-0">{childCat.icon}</span>}
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
                {formatCurrency(Math.abs(child.amount))}
              </span>
            </div>
          );
        })}
    </div>
  );
}
