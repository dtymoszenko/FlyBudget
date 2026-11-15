import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Receipt, SearchX, Upload, Link2 } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { usePayees } from '../../hooks/usePayees';
import { useAccounts } from '../../hooks/useAccounts';
import { TransactionFilters, DEFAULT_FILTERS, filtersToParams } from './TransactionFilters';
import { TransactionFormRow } from './TransactionFormRow';
import { TransactionRow } from './TransactionRow';
import { TransactionCard } from './TransactionCard';
import { WaitingTransactions } from './WaitingTransactions';
import { TransferSuggestions } from './TransferSuggestions';
import { Modal } from '../ui/Modal';
import { useIsPhone } from '../../hooks/useIsPhone';
import { TransactionDetailPanel } from './TransactionDetailPanel';
import { ImportModal } from './ImportModal';
import { Button, ButtonLink } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { useOpenFromLink } from '../../hooks/useOpenFromLink';
import { docsUrl } from '../../utils/project';
import { useAddTransaction } from '../../hooks/useOffline';
import { formatCurrency } from '../../utils/currency';
import { transactionValue } from '../../utils/accountMoney';
import { formatMoney } from '../../utils/currency';
import { useAccountCurrency, useBudgetCurrency } from '../../hooks/useCurrency';
import type { FilterState } from './TransactionFilters';
import type { CategoryGroup } from '../../types';
import type { CreateTransactionData } from '../../api/transactions';
import { formatDay, formatDayLong } from '../../utils/dates';

/** Rows drawn at a time: every match is loaded, but drawing thousands at once is slow */
const ROWS_PER_PAGE = 300;

interface Props {
  accountId?: string;
  categoryId?: string;
  categoryIds?: string[];
  categoryGroupId?: string;
  uncategorized?: boolean;
  from?: string;
  to?: string;
  month?: string;
  onClearMonth?: () => void;
  overlayDetail?: boolean;
  /** All Transactions: opens the add-transaction dialog from the empty state */
  onAddTransaction?: () => void;
}

export function TransactionTable({
  accountId,
  categoryId,
  categoryIds,
  categoryGroupId,
  uncategorized,
  from,
  to,
  month,
  onClearMonth,
  overlayDetail,
  onAddTransaction,
}: Props) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...DEFAULT_FILTERS,
    datePreset:
      categoryId || categoryIds?.length || categoryGroupId ? 'all' : DEFAULT_FILTERS.datePreset,
  }));
  const [showAdd, setShowAdd] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const showAccountCol = !accountId;

  const params = useMemo(() => {
    const base = filtersToParams(filters, accountId);
    if (categoryIds?.length) base.categoryIds = categoryIds;
    else if (categoryId && !base.categoryId) base.categoryId = categoryId;
    if (categoryGroupId) base.categoryGroupId = categoryGroupId;
    if (uncategorized) {
      delete base.categoryId;
      delete base.categoryIds;
      base.uncategorized = true;
    }
    if (from) base.from = from;
    if (to) base.to = to;
    if (month) {
      delete base.from;
      delete base.to;
      base.month = month;
    }
    return base;
  }, [
    filters,
    accountId,
    categoryId,
    categoryIds,
    categoryGroupId,
    uncategorized,
    from,
    to,
    month,
  ]);
  const { data: transactions = [], isLoading } = useTransactions(params);
  // Whether there are any transactions at all here, to tell "nothing yet" from "filtered out"
  const scoped = Boolean(
    categoryId || categoryIds?.length || categoryGroupId || uncategorized || month || from || to,
  );
  const { data: anyTransactions = [] } = useTransactions(
    accountId ? { accountId, limit: 1 } : { limit: 1 },
  );
  const isFirstRun = !scoped && anyTransactions.length === 0;
  const filtersChanged =
    filters.search !== DEFAULT_FILTERS.search || filters.categoryId !== DEFAULT_FILTERS.categoryId;
  const { data: groups = [] } = useCategories();
  const { data: payees = [] } = usePayees();
  const { data: accounts = [] } = useAccounts();

  const newTx = useAddTransaction();
  const startAdd = () => {
    setShowAdd(true);
    setDetailId(null);
  };
  useOpenFromLink('import', () => accountId && setShowImport(true));
  useOpenFromLink('add', () => accountId && startAdd());
  // Phones: cards instead of rows, the entry form in a sheet, and details full screen
  const isPhone = useIsPhone();
  const overlay = overlayDetail || isPhone;

  const categoryMap = useMemo(() => {
    const map = new Map<string, { name: string; icon: string | null }>();
    for (const g of groups as CategoryGroup[]) {
      for (const c of g.categories) map.set(c.id, { name: c.name, icon: c.icon });
    }
    return map;
  }, [groups]);

  // Offered as "Transfer: name" when categorizing a transaction
  const transferAccounts = useMemo(() => accounts.filter((a) => !a.closedAt), [accounts]);

  const accountInfoMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, { name: a.name, type: a.type, logo: a.logo }])),
    [accounts],
  );

  const selectedTx = useMemo(
    () => (detailId ? (transactions.find((tx) => tx.id === detailId) ?? null) : null),
    [detailId, transactions],
  );

  const [panelMounted, setPanelMounted] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const panelTxRef = useRef<typeof selectedTx>(null);

  if (selectedTx) panelTxRef.current = selectedTx;
  const panelTx = selectedTx ?? panelTxRef.current;

  const hasSelectedTx = !!selectedTx;
  useEffect(() => {
    if (hasSelectedTx) {
      setPanelMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setPanelVisible(true));
      });
    } else {
      setPanelVisible(false);
    }
  }, [hasSelectedTx]);

  const handlePanelTransitionEnd = useCallback(() => {
    if (!panelVisible) {
      setPanelMounted(false);
      panelTxRef.current = null;
    }
  }, [panelVisible]);

  // Day totals: one account's register adds its own amounts (in its currency); all accounts
  // together add their values in the budget's currency
  const ownCurrency = useAccountCurrency()(accountId);
  const budgetCurrency = useBudgetCurrency();
  const dayAmount = (t: (typeof transactions)[number]) =>
    accountId ? t.amount : transactionValue(t);
  const groupedByDate = useMemo(() => {
    const result: Array<{ date: string; txs: typeof transactions; total: number }> = [];
    let currentDate = '';
    let currentTxs: typeof transactions = [];

    for (const tx of transactions) {
      if (tx.date !== currentDate) {
        if (currentTxs.length > 0) {
          result.push({
            date: currentDate,
            txs: currentTxs,
            total: currentTxs.reduce((sum, t) => sum + Math.abs(dayAmount(t)), 0),
          });
        }
        currentDate = tx.date;
        currentTxs = [tx];
      } else {
        currentTxs.push(tx);
      }
    }

    if (currentTxs.length > 0) {
      result.push({
        date: currentDate,
        txs: currentTxs,
        total: currentTxs.reduce((sum, t) => sum + Math.abs(dayAmount(t)), 0),
      });
    }

    return result;
  }, [transactions, accountId]);

  // How many rows to draw, back to one page whenever the filters change
  const [shown, setShown] = useState({ params, rows: ROWS_PER_PAGE });
  const shownRows = shown.params === params ? shown.rows : ROWS_PER_PAGE;
  // Whole days only, so a day's total always matches the rows under it
  const visibleGroups = useMemo(() => {
    const result: typeof groupedByDate = [];
    let rows = 0;
    for (const group of groupedByDate) {
      if (rows >= shownRows) break;
      result.push(group);
      rows += group.txs.length;
    }
    return result;
  }, [groupedByDate, shownRows]);
  const hiddenRows = transactions.length - visibleGroups.reduce((sum, g) => sum + g.txs.length, 0);

  function handleCreate(data: CreateTransactionData) {
    if (data.categoryId?.startsWith('transfer:') && accountId) {
      const otherId = data.categoryId.slice('transfer:'.length);
      // An outflow sends money to the other account, an inflow brings it in from there
      const outflow = data.amount < 0;
      newTx.add(
        {
          kind: 'transfer',
          data: {
            fromAccountId: outflow ? accountId : otherId,
            toAccountId: outflow ? otherId : accountId,
            date: data.date,
            amount: Math.abs(data.amount),
            notes: data.notes,
          },
        },
        () => setShowAdd(false),
      );
      return;
    }
    newTx.add({ kind: 'transaction', data }, () => setShowAdd(false));
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TransactionFilters
        state={filters}
        onChange={(f) => {
          if (month && onClearMonth) onClearMonth();
          setFilters(f);
        }}
        categoryName={filters.categoryId ? categoryMap.get(filters.categoryId)?.name : undefined}
        externalMonth={month}
        externalRange={from && to ? `${formatDay(from)} – ${formatDay(to)}` : undefined}
      />
      <div className="px-4 py-2 border-b border-border-light bg-surface flex flex-wrap gap-2 justify-between items-center">
        <span className="text-xs text-text-tertiary">
          {t('transactions.table.count', { count: transactions.length })}
        </span>
        {accountId && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>
              <Upload size={13} /> {t('transactions.table.importCsv')}
            </Button>
            <Button
              size="sm"
              disabled={!newTx.allowed}
              title={
                !newTx.allowed
                  ? t('transactions.table.savingPaused')
                  : newTx.onDevice
                    ? t('transactions.table.savedOnDevice')
                    : undefined
              }
              onClick={startAdd}
            >
              <Plus size={13} /> {t('transactions.table.add')}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {/* Not in a category or month view: they may not belong there */}
          {!categoryId && !categoryIds?.length && !categoryGroupId && !month && (
            <>
              <WaitingTransactions
                accountId={accountId}
                categoryName={(id) => categoryMap.get(id)?.name}
                accountName={(id) => accountInfoMap.get(id)?.name}
              />
              <TransferSuggestions
                accountId={accountId}
                accountName={(id) => accountInfoMap.get(id)?.name}
              />
            </>
          )}
          {showAdd && accountId && !isPhone && (
            <TransactionFormRow
              accountId={accountId}
              groups={groups as CategoryGroup[]}
              payees={payees}
              accounts={accounts}
              onSave={handleCreate}
              onCancel={() => setShowAdd(false)}
            />
          )}

          {isLoading ? (
            <div className="px-4 py-10 text-center text-sm text-text-tertiary">
              {t('common.loading')}
            </div>
          ) : transactions.length === 0 && (!showAdd || isPhone) ? (
            isFirstRun ? (
              <EmptyState
                icon={<Receipt size={26} />}
                title={t('transactions.table.empty.title')}
                description={
                  accountId
                    ? t('transactions.table.empty.accountHint')
                    : t('transactions.table.empty.allHint')
                }
                learnMoreHref={docsUrl('transactions')}
                actions={
                  accountId ? (
                    <>
                      <Button variant="secondary" onClick={() => setShowImport(true)}>
                        <Upload size={14} /> {t('transactions.table.empty.import')}
                      </Button>
                      <Button disabled={!newTx.allowed} onClick={startAdd}>
                        <Plus size={14} /> {t('transactions.table.empty.add')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <ButtonLink variant="secondary" to="/settings?tab=connections">
                        <Link2 size={14} /> {t('transactions.table.empty.connect')}
                      </ButtonLink>
                      {onAddTransaction && (
                        <Button disabled={!newTx.allowed} onClick={onAddTransaction}>
                          <Plus size={14} /> {t('transactions.table.empty.add')}
                        </Button>
                      )}
                    </>
                  )
                }
              />
            ) : (
              <EmptyState
                compact
                icon={<SearchX size={20} />}
                title={t('transactions.table.notFound.title')}
                description={
                  filtersChanged
                    ? t('transactions.table.notFound.filtered')
                    : filters.datePreset === 'all'
                      ? t('transactions.table.notFound.here')
                      : t('transactions.table.notFound.range')
                }
                actions={
                  (filtersChanged || filters.datePreset !== 'all') && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setFilters({ ...DEFAULT_FILTERS, datePreset: 'all' })}
                    >
                      {filtersChanged
                        ? t('transactions.table.notFound.clearFilters')
                        : t('transactions.table.notFound.showAllDates')}
                    </Button>
                  )
                }
              />
            )
          ) : (
            <>
              {visibleGroups.map((group) => (
                <div key={group.date}>
                  <div className="flex items-center justify-between px-4 py-2 bg-surface-alt border-b border-border-light">
                    <span className="text-sm font-medium text-text-secondary">
                      {formatDayLong(group.date)}
                    </span>
                    <span
                      className="text-sm font-medium text-text-secondary tabular-nums"
                      title={
                        !accountId && budgetCurrency
                          ? t('transactions.table.dayTotalHint', { currency: budgetCurrency })
                          : undefined
                      }
                    >
                      {accountId
                        ? formatMoney(group.total, ownCurrency)
                        : formatCurrency(group.total)}
                    </span>
                  </div>

                  {group.txs.map((tx) =>
                    isPhone ? (
                      <TransactionCard
                        key={tx.id}
                        tx={tx}
                        categoryEntry={
                          tx.categoryId ? (categoryMap.get(tx.categoryId) ?? null) : null
                        }
                        payees={payees}
                        accountName={
                          showAccountCol ? accountInfoMap.get(tx.accountId)?.name : undefined
                        }
                        isSelected={detailId === tx.id}
                        onOpenDetail={setDetailId}
                      />
                    ) : (
                      <TransactionRow
                        key={tx.id}
                        tx={tx}
                        categoryEntry={
                          tx.categoryId ? (categoryMap.get(tx.categoryId) ?? null) : null
                        }
                        categoryMap={categoryMap}
                        groups={groups as CategoryGroup[]}
                        payees={payees}
                        accountName={
                          showAccountCol ? accountInfoMap.get(tx.accountId)?.name : undefined
                        }
                        accountType={
                          showAccountCol ? accountInfoMap.get(tx.accountId)?.type : undefined
                        }
                        accountLogo={
                          showAccountCol ? accountInfoMap.get(tx.accountId)?.logo : undefined
                        }
                        showAccountCol={showAccountCol}
                        isSelected={detailId === tx.id}
                        onOpenDetail={setDetailId}
                        onFilterCategory={(catId) =>
                          setFilters((f) => ({ ...f, categoryId: catId, datePreset: 'all' }))
                        }
                        onFilterSearch={(search) =>
                          setFilters((f) => ({ ...f, search, datePreset: 'all' }))
                        }
                        transferAccounts={transferAccounts}
                      />
                    ),
                  )}
                </div>
              ))}
              {hiddenRows > 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-6">
                  <span className="text-xs text-text-tertiary">
                    {t('transactions.table.showing', {
                      shown: transactions.length - hiddenRows,
                      count: transactions.length,
                    })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShown({ params, rows: shownRows + ROWS_PER_PAGE })}
                  >
                    {t('transactions.table.showMore', {
                      count: Math.min(hiddenRows, ROWS_PER_PAGE),
                    })}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {panelMounted && panelTx && !overlay && (
          <div className="w-96 shrink-0 overflow-hidden">
            <div
              className={`h-full transition-transform duration-200 ease-out ${panelVisible ? 'translate-x-0' : 'translate-x-full'}`}
              onTransitionEnd={handlePanelTransitionEnd}
            >
              <TransactionDetailPanel
                transaction={panelTx}
                categoryMap={categoryMap}
                groups={groups as CategoryGroup[]}
                payees={payees}
                accounts={accounts}
                accountName={accountInfoMap.get(panelTx.accountId)?.name}
                accountType={accountInfoMap.get(panelTx.accountId)?.type}
                accountLogo={accountInfoMap.get(panelTx.accountId)?.logo}
                onClose={() => setDetailId(null)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Phones: the entry form in a sheet (splits and transfers included) */}
      {accountId && isPhone && (
        <Modal
          isOpen={showAdd}
          onClose={() => setShowAdd(false)}
          title={t('transactions.table.newTitle')}
        >
          <TransactionFormRow
            layout="sheet"
            accountId={accountId}
            groups={groups as CategoryGroup[]}
            payees={payees}
            accounts={accounts}
            onSave={handleCreate}
            onCancel={() => setShowAdd(false)}
          />
        </Modal>
      )}

      {accountId && (
        <ImportModal
          isOpen={showImport}
          onClose={() => setShowImport(false)}
          accountId={accountId}
        />
      )}

      {panelMounted &&
        panelTx &&
        overlay &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex justify-end cursor-pointer"
            onClick={() => setDetailId(null)}
          >
            <div
              className={`absolute inset-0 bg-black/20 transition-opacity duration-200 ${panelVisible ? 'opacity-100' : 'opacity-0'}`}
            />
            <div
              className={`relative h-full transition-transform duration-200 ease-out ${panelVisible ? 'translate-x-0' : 'translate-x-full'}`}
              onClick={(e) => e.stopPropagation()}
              onTransitionEnd={handlePanelTransitionEnd}
            >
              <TransactionDetailPanel
                transaction={panelTx}
                categoryMap={categoryMap}
                groups={groups as CategoryGroup[]}
                payees={payees}
                accounts={accounts}
                accountName={accountInfoMap.get(panelTx.accountId)?.name}
                accountType={accountInfoMap.get(panelTx.accountId)?.type}
                accountLogo={accountInfoMap.get(panelTx.accountId)?.logo}
                onClose={() => setDetailId(null)}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
