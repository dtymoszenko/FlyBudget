import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { format, parseISO } from 'date-fns';
import { Plus, Upload } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { usePayees } from '../../hooks/usePayees';
import { useAccounts } from '../../hooks/useAccounts';
import { TransactionFilters, DEFAULT_FILTERS, filtersToParams } from './TransactionFilters';
import { TransactionFormRow } from './TransactionFormRow';
import { TransactionRow } from './TransactionRow';
import { TransactionCard } from './TransactionCard';
import { WaitingTransactions } from './WaitingTransactions';
import { Modal } from '../ui/Modal';
import { useIsPhone } from '../../hooks/useIsPhone';
import { TransactionDetailPanel } from './TransactionDetailPanel';
import { ImportModal } from './ImportModal';
import { Button } from '../ui/Button';
import { useAddTransaction } from '../../hooks/useOffline';
import { formatCurrency } from '../../utils/currency';
import type { FilterState } from './TransactionFilters';
import type { CategoryGroup } from '../../types';
import type { CreateTransactionData } from '../../api/transactions';

interface Props {
  accountId?: string;
  categoryId?: string;
  categoryIds?: string[];
  categoryGroupId?: string;
  month?: string;
  onClearMonth?: () => void;
  overlayDetail?: boolean;
}

export function TransactionTable({
  accountId,
  categoryId,
  categoryIds,
  categoryGroupId,
  month,
  onClearMonth,
  overlayDetail,
}: Props) {
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
    if (month) {
      delete base.from;
      delete base.to;
      base.month = month;
    }
    return base;
  }, [filters, accountId, categoryId, categoryIds, categoryGroupId, month]);
  const { data: transactions = [], isLoading } = useTransactions(params);
  const { data: groups = [] } = useCategories();
  const { data: payees = [] } = usePayees();
  const { data: accounts = [] } = useAccounts();

  const newTx = useAddTransaction();
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
            total: currentTxs.reduce((sum, t) => sum + Math.abs(t.amount), 0),
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
        total: currentTxs.reduce((sum, t) => sum + Math.abs(t.amount), 0),
      });
    }

    return result;
  }, [transactions]);

  function handleCreate(data: CreateTransactionData) {
    if (data.categoryId?.startsWith('transfer:') && accountId) {
      const toAccountId = data.categoryId.slice('transfer:'.length);
      newTx.add(
        {
          kind: 'transfer',
          data: {
            fromAccountId: accountId,
            toAccountId,
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
      />
      <div className="px-4 py-2 border-b border-border-light bg-surface flex flex-wrap gap-2 justify-between items-center">
        <span className="text-xs text-text-tertiary">{transactions.length} transactions</span>
        {accountId && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>
              <Upload size={13} /> Import CSV
            </Button>
            <Button
              size="sm"
              disabled={!newTx.allowed}
              title={
                !newTx.allowed
                  ? 'Saving is paused until FlyBudget reconnects'
                  : newTx.onDevice
                    ? 'Saved on this device and sent when FlyBudget reconnects'
                    : undefined
              }
              onClick={() => {
                setShowAdd(true);
                setDetailId(null);
              }}
            >
              <Plus size={13} /> Add Transaction
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {/* Not in a category or month view: they may not belong there */}
          {!categoryId && !categoryIds?.length && !categoryGroupId && !month && (
            <WaitingTransactions
              accountId={accountId}
              categoryName={(id) => categoryMap.get(id)?.name}
              accountName={(id) => accountInfoMap.get(id)?.name}
            />
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
            <div className="px-4 py-10 text-center text-sm text-text-tertiary">Loading...</div>
          ) : transactions.length === 0 && (!showAdd || isPhone) ? (
            <div className="px-4 py-10 text-center text-sm text-text-tertiary">
              No transactions found.
            </div>
          ) : (
            groupedByDate.map((group) => (
              <div key={group.date}>
                <div className="flex items-center justify-between px-4 py-2 bg-surface-alt border-b border-border-light">
                  <span className="text-sm font-medium text-text-secondary">
                    {format(parseISO(group.date), 'MMMM d, yyyy')}
                  </span>
                  <span className="text-sm font-medium text-text-secondary tabular-nums">
                    {formatCurrency(group.total)}
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
                    />
                  ),
                )}
              </div>
            ))
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
        <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="New transaction">
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
