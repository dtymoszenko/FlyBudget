import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronRight, Check } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAccounts } from '../hooks/useAccounts';
import {
  useTransactions,
  useReconcileAccount,
  useCreateTransaction,
} from '../hooks/useTransactions';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { CurrencyInput } from '../components/ui/CurrencyInput';
import { formatCurrency } from '../utils/currency';
import type { Transaction } from '../types';

export default function ReconcilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: accounts = [] } = useAccounts();
  const account = accounts.find((a) => a.id === id);

  const { data: unreconciledTxns = [], isLoading } = useTransactions(
    id ? { accountId: id, reconciled: 0 } : {},
  );

  const reconcileAccount = useReconcileAccount();
  const createTransaction = useCreateTransaction();

  const [step, setStep] = useState<1 | 2>(1);
  const [statementBalance, setStatementBalance] = useState(0);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  function startStep2() {
    setCheckedIds(new Set());
    setStep(2);
  }

  const reconciledBase = useMemo(() => {
    if (!account) return 0;
    const unreconciledSum = unreconciledTxns.reduce((s, t) => s + t.amount, 0);
    return account.balance - unreconciledSum;
  }, [account, unreconciledTxns]);

  const checkedSum = useMemo(() => {
    return unreconciledTxns.filter((t) => checkedIds.has(t.id)).reduce((s, t) => s + t.amount, 0);
  }, [unreconciledTxns, checkedIds]);

  const selectedBalance = reconciledBase + checkedSum;
  const difference = selectedBalance - statementBalance;
  const isBalanced = difference === 0;

  function toggleRow(tx: Transaction) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(tx.id) ? next.delete(tx.id) : next.add(tx.id);
      return next;
    });
  }

  async function handleFinish() {
    if (!id || checkedIds.size === 0) return;
    await reconcileAccount.mutateAsync({ accountId: id, transactionIds: [...checkedIds] });
    navigate(`/accounts/${id}`);
  }

  async function handleCreateAdjustment() {
    if (!id || !account) return;
    const adjustmentAmount = statementBalance - selectedBalance;
    const created = await createTransaction.mutateAsync({
      accountId: id,
      date: format(new Date(), 'yyyy-MM-dd'),
      amount: adjustmentAmount,
      notes: 'Reconciliation adjustment',
      adjustment: true,
    });
    const idsToReconcile = [...checkedIds, created.id];
    await reconcileAccount.mutateAsync({ accountId: id, transactionIds: idsToReconcile });
    navigate(`/accounts/${id}`);
  }

  if (!account) return null;

  if (step === 1) {
    return (
      <div className="flex flex-col h-full bg-surface">
        <div className="px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary mb-1">
            <Link to="/accounts" className="hover:text-brand-600 transition-colors">
              Accounts
            </Link>
            <ChevronRight size={11} />
            <Link to={`/accounts/${id}`} className="hover:text-brand-600 transition-colors">
              {account.name}
            </Link>
            <ChevronRight size={11} />
            <span className="text-text-secondary">Reconcile</span>
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-text">Reconcile: {account.name}</h1>
            <Badge variant={account.type} />
          </div>
        </div>

        <div className="flex-1 flex items-start justify-center pt-16 px-6">
          <div className="w-full max-w-sm space-y-6">
            <div>
              <h2 className="text-base font-semibold text-text mb-1">
                Enter your bank's ending balance
              </h2>
              <p className="text-sm text-text-secondary">
                Check your bank statement or online banking for the current balance.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-secondary">Statement Balance</label>
              <CurrencyInput
                value={statementBalance}
                onChange={setStatementBalance}
                className="w-full text-lg"
              />
            </div>

            <div className="rounded-lg border border-border-light bg-surface-alt px-4 py-3">
              <p className="text-xs text-text-tertiary">Current selected balance in app</p>
              <p className="text-lg font-semibold text-text mt-0.5 tabular-nums">
                {formatCurrency(selectedBalance)}
              </p>
            </div>

            <Button onClick={startStep2} disabled={isLoading} className="w-full">
              Start Reconciliation
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const sorted = [...unreconciledTxns].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-text-tertiary mb-1">
          <Link to="/accounts" className="hover:text-brand-600 transition-colors">
            Accounts
          </Link>
          <ChevronRight size={11} />
          <Link to={`/accounts/${id}`} className="hover:text-brand-600 transition-colors">
            {account.name}
          </Link>
          <ChevronRight size={11} />
          <span className="text-text-secondary">Reconcile</span>
        </div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-text">Reconcile: {account.name}</h1>
          <Badge variant={account.type} />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-surface-alt border-b border-border z-10">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-text-tertiary w-24">
                  Date
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-text-tertiary">
                  Payee
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-text-tertiary w-28">
                  Amount
                </th>
                <th className="px-4 py-2 text-center text-xs font-medium text-text-tertiary w-12">
                  C
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-text-tertiary">
                    Loading...
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-text-tertiary">
                    No unreconciled transactions.
                  </td>
                </tr>
              ) : (
                sorted.map((tx) => {
                  const checked = checkedIds.has(tx.id);
                  return (
                    <tr
                      key={tx.id}
                      onClick={() => toggleRow(tx)}
                      className={`border-b border-border-light cursor-pointer transition-colors ${checked ? 'bg-positive-subtle hover:bg-positive-subtle' : 'hover:bg-hover'}`}
                    >
                      <td className="px-4 py-2 text-xs text-text-tertiary whitespace-nowrap">
                        {format(parseISO(tx.date), 'MMM d, yyyy')}
                      </td>
                      <td className="px-4 py-2 text-sm text-text">
                        {tx.payeeName ?? <span className="text-text-disabled italic">—</span>}
                      </td>
                      <td
                        className={`px-4 py-2 text-sm text-right tabular-nums font-medium ${tx.amount < 0 ? 'text-text' : 'text-positive'}`}
                      >
                        {formatCurrency(tx.amount)}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mx-auto transition-colors ${
                            checked ? 'bg-positive border-positive text-white' : 'border-border'
                          }`}
                        >
                          {checked && <Check size={10} />}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="w-64 shrink-0 border-l border-border flex flex-col">
          <div className="flex-1 px-5 py-6 space-y-5">
            <div>
              <p className="text-xs text-text-tertiary mb-0.5">Selected Balance</p>
              <p className="text-xl font-semibold text-text tabular-nums">
                {formatCurrency(selectedBalance)}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary mb-0.5">Statement Balance</p>
              <p className="text-xl font-semibold text-text tabular-nums">
                {formatCurrency(statementBalance)}
              </p>
            </div>
            <div className="pt-3 border-t border-border-light">
              <p className="text-xs text-text-tertiary mb-0.5">Difference</p>
              <p
                className={`text-2xl font-semibold tabular-nums ${isBalanced ? 'text-positive' : 'text-negative'}`}
              >
                {formatCurrency(difference)}
              </p>
              {isBalanced && <p className="text-xs text-positive mt-1">Ready to finish!</p>}
            </div>
          </div>

          <div className="px-5 py-5 space-y-2 border-t border-border">
            <Button
              onClick={handleFinish}
              disabled={!isBalanced || reconcileAccount.isPending || checkedIds.size === 0}
              className="w-full"
            >
              {reconcileAccount.isPending ? 'Saving...' : 'Finish'}
            </Button>
            {!isBalanced && (
              <Button
                variant="secondary"
                onClick={handleCreateAdjustment}
                disabled={reconcileAccount.isPending || createTransaction.isPending}
                className="w-full"
              >
                Create Adjustment
              </Button>
            )}
            <button
              onClick={() => navigate(`/accounts/${id}`)}
              className="w-full py-2 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
