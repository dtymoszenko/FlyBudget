import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, X } from 'lucide-react';
import { useAccounts } from '../../hooks/useAccounts';
import { useTransactions } from '../../hooks/useTransactions';
import { useBudget } from '../../hooks/useBudget';
import { useSchedules } from '../../hooks/useSchedules';
import { useRules } from '../../hooks/useRules';
import { usePreferencesStore } from '../../store/preferencesStore';
import { docsUrl } from '../../utils/project';
import { AddAccountModal } from '../accounts/AddAccountModal';
import { ExternalLink } from '../ui/ExternalLink';
import { Card } from '../ui/Card';

interface Step {
  id: string;
  title: string;
  description: string;
  done: boolean;
  action: { label: string; to?: string; onClick?: () => void };
}

/**
 * The first things to do in a new budget, ticked off as they're done. Shown on the
 * dashboard until every step is done or the user hides it.
 */
export default function GettingStarted({ currentMonth }: { currentMonth: string }) {
  const hidden = usePreferencesStore((s) => s.gettingStartedHidden);
  const setHidden = usePreferencesStore((s) => s.setGettingStartedHidden);
  const [addAccountOpen, setAddAccountOpen] = useState(false);

  const accounts = useAccounts();
  const transactions = useTransactions({ limit: 1 });
  const budget = useBudget(currentMonth);
  const schedules = useSchedules();
  const rules = useRules();

  const loading = [accounts, transactions, budget, schedules, rules].some((q) => q.isLoading);
  if (hidden || loading) return null;

  const firstAccount = accounts.data?.find((a) => !a.closedAt);
  const steps: Step[] = [
    {
      id: 'account',
      title: 'Add your first account',
      description: 'A checking account, credit card or cash: anything that holds money.',
      done: (accounts.data?.length ?? 0) > 0,
      action: { label: 'Add account', onClick: () => setAddAccountOpen(true) },
    },
    {
      id: 'transactions',
      title: 'Bring in your transactions',
      description: 'Import a CSV file from your bank, connect a bank, or add them by hand.',
      done: (transactions.data?.length ?? 0) > 0,
      action: firstAccount
        ? { label: 'Import or add', to: `/accounts/${firstAccount.id}` }
        : { label: 'Connect a bank', to: '/settings?tab=connections' },
    },
    {
      id: 'recurring',
      title: 'Add your bills and paychecks',
      description: 'See what’s due next and never miss a payment.',
      done: (schedules.data?.length ?? 0) > 0,
      action: { label: 'Add recurring', to: '/recurring' },
    },
    {
      id: 'budget',
      title: 'Plan this month’s budget',
      description: 'With your paychecks and bills in, give the rest of your money a job.',
      done: (budget.data ?? []).some((g) => g.categories.some((c) => c.budgeted !== 0)),
      action: { label: 'Open budget', to: '/budget' },
    },
    {
      id: 'rules',
      title: 'Categorize automatically',
      description: 'Rules sort new transactions for you, by payee, amount and more.',
      done: (rules.data?.length ?? 0) > 0,
      action: { label: 'Create a rule', to: '/rules' },
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const nextStep = steps.find((s) => !s.done);

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-base font-semibold text-text">Get started with FlyBudget</h2>
          <p className="text-sm text-text-tertiary mt-0.5">
            {doneCount} of {steps.length} done. Each step brings more of your dashboard to life.
          </p>
        </div>
        <button
          onClick={() => setHidden(true)}
          aria-label="Hide getting started"
          title="Hide getting started"
          className="p-1.5 -mr-1.5 max-md:min-w-11 max-md:min-h-11 flex items-center justify-center rounded-md text-text-tertiary hover:bg-hover hover:text-text"
        >
          <X size={16} />
        </button>
      </div>

      <div
        className="mx-5 mt-3 h-1.5 rounded-full bg-surface-alt overflow-hidden"
        role="progressbar"
        aria-label="Getting started progress"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={doneCount}
      >
        <div
          className="h-full bg-brand-600 rounded-full transition-all"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <ol className="mt-3 divide-y divide-border-light">
        {steps.map((step, i) => {
          const isNext = step === nextStep;
          return (
            <li
              key={step.id}
              className={`flex items-center gap-3 px-5 py-3 ${isNext ? 'bg-brand-50' : ''}`}
            >
              <span
                className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                  step.done
                    ? 'bg-positive text-white'
                    : isNext
                      ? 'bg-brand-600 text-white'
                      : 'bg-surface-alt text-text-tertiary'
                }`}
              >
                {step.done ? <Check size={14} aria-label="Done" /> : i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium ${step.done ? 'text-text-tertiary line-through' : 'text-text'}`}
                >
                  {step.title}
                </p>
                {!step.done && (
                  <p className="text-xs text-text-tertiary mt-0.5">{step.description}</p>
                )}
              </div>
              {!step.done && <StepAction step={step} primary={isNext} />}
            </li>
          );
        })}
      </ol>

      <div className="px-5 py-3 border-t border-border-light text-xs text-text-tertiary">
        Not sure where to begin?{' '}
        <ExternalLink
          href={docsUrl('getting-started')}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          Read the getting started guide
        </ExternalLink>
      </div>

      <AddAccountModal isOpen={addAccountOpen} onClose={() => setAddAccountOpen(false)} />
    </Card>
  );
}

function StepAction({ step, primary }: { step: Step; primary: boolean }) {
  const className = `shrink-0 inline-flex items-center gap-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors max-md:min-h-11 ${
    primary ? 'bg-brand-600 text-white hover:bg-brand-700' : 'text-brand-600 hover:bg-brand-50'
  }`;
  const content = (
    <>
      {step.action.label} <ChevronRight size={13} aria-hidden />
    </>
  );
  if (step.action.to) {
    return (
      <Link to={step.action.to} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={step.action.onClick} className={className}>
      {content}
    </button>
  );
}
