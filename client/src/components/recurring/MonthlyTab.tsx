import { useState, useMemo, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, addMonths, subMonths, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, List, CalendarDays, Plus, Sparkles } from 'lucide-react';
import Calendar from './Calendar';
import RecurringItemRow, { OCCURRENCE_GRID } from './RecurringItemRow';
import {
  useScheduleOccurrences,
  useMarkOccurrencePaid,
  useSkipOccurrence,
  useUnmatchOccurrence,
} from '../../hooks/useSchedules';
import { useAccounts } from '../../hooks/useAccounts';
import { formatCurrency } from '../../utils/currency';
import { Button } from '../ui/Button';
import { usePreferencesStore } from '../../store/preferencesStore';
import { getUpcomingDays } from './scheduleFormat';
import type { Schedule, ScheduleOccurrence } from '../../types';

interface Props {
  onEdit: (item: Schedule) => void;
  onAdd: () => void;
  onFind: () => void;
  allRecurring: Schedule[];
  onMatchOccurrence?: (occurrenceId: string) => void;
}

type View = 'list' | 'calendar';

interface Totals { total: number; paid: number; remaining: number }

/** Paid uses the actual matched amount; remaining uses the expected amount of unpaid items. */
function computeTotals(occs: ScheduleOccurrence[]): Totals {
  let paid = 0, remaining = 0;
  for (const o of occs) {
    if (o.displayStatus === 'skipped' || o.displayStatus === 'cancelled') continue;
    if (o.displayStatus === 'paid') paid += Math.abs(o.matchedAmount ?? o.expectedAmount);
    else remaining += Math.abs(o.expectedAmount);
  }
  return { total: paid + remaining, paid, remaining };
}

function SummaryColumn({ label, verb, totals, barClass }: {
  label: string; verb: string; totals: Totals; barClass: string;
}) {
  const pct = totals.total > 0 ? Math.min(100, (totals.paid / totals.total) * 100) : 0;
  return (
    <div className="flex-1 px-5 py-4 min-w-0">
      <p className="text-xs font-medium text-text-secondary">{label}</p>
      {totals.total > 0 ? (
        <>
          <p className="text-lg font-semibold text-text tabular-nums mt-0.5">
            {formatCurrency(totals.remaining)} <span className="text-xs font-normal text-text-tertiary">remaining</span>
          </p>
          <div className="h-1.5 bg-surface-alt rounded-full overflow-hidden mt-2">
            <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-text-tertiary tabular-nums mt-1.5">
            {formatCurrency(totals.paid)} {verb} of {formatCurrency(totals.total)}
          </p>
        </>
      ) : (
        <p className="text-sm text-text-tertiary mt-1">None this month</p>
      )}
    </div>
  );
}

export default function MonthlyTab({ onEdit, onAdd, onFind, allRecurring, onMatchOccurrence }: Props) {
  const upcomingDays = getUpcomingDays(usePreferencesStore((s) => s.upcomingLength));
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [view, setView] = useState<View>('list');
  const [highlightDate, setHighlightDate] = useState<string | null>(null);

  const monthDate = parseISO(`${month}-01`);
  const from = format(startOfMonth(monthDate), 'yyyy-MM-dd');
  const to = format(endOfMonth(monthDate), 'yyyy-MM-dd');

  const { data: occurrences = [], isLoading } = useScheduleOccurrences(from, to);
  const { data: accounts = [] } = useAccounts();
  const markPaid = useMarkOccurrencePaid();
  const skipOcc = useSkipOccurrence();
  const unmatchOcc = useUnmatchOccurrence();

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const recMap = useMemo(() => new Map(allRecurring.map((r) => [r.id, r])), [allRecurring]);

  const { income, expenses } = useMemo(() => {
    const sorted = [...occurrences].sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    return {
      income: sorted.filter((o) => o.expectedAmount > 0),
      expenses: sorted.filter((o) => o.expectedAmount <= 0),
    };
  }, [occurrences]);

  const incomeTotals = useMemo(() => computeTotals(income), [income]);
  const expenseTotals = useMemo(() => computeTotals(expenses), [expenses]);

  // After a calendar day click, scroll the list to that day's first row
  useEffect(() => {
    if (!highlightDate || view !== 'list') return;
    document.querySelector(`[data-date="${highlightDate}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlightDate(null), 2000);
    return () => clearTimeout(t);
  }, [highlightDate, view]);

  function renderSection(title: string, items: ScheduleOccurrence[]) {
    if (!items.length) return null;
    return (
      <div>
        <div className={`${OCCURRENCE_GRID} px-5 py-2 bg-surface-alt border-y border-border-light text-xs font-medium text-text-tertiary`}>
          <span className="text-text-secondary font-semibold">{title}</span>
          <span>Date</span>
          <span>Account</span>
          <span>Status</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {items.map((occ) => (
          <RecurringItemRow
            key={occ.id}
            occurrence={occ}
            upcomingDays={upcomingDays}
            highlighted={highlightDate === occ.expectedDate}
            accountName={occ.scheduleAccountId ? accountMap.get(occ.scheduleAccountId) : undefined}
            onMarkPaid={() =>
              markPaid.mutate({ scheduleId: occ.scheduleId, date: occ.expectedDate, occurrenceId: occ.id })
            }
            onSkip={() => skipOcc.mutate(occ.id)}
            onMatch={onMatchOccurrence ? () => onMatchOccurrence(occ.id) : undefined}
            onUnmatch={() => unmatchOcc.mutate(occ.id)}
            onEdit={() => {
              const rec = recMap.get(occ.scheduleId);
              if (rec) onEdit(rec);
            }}
          />
        ))}
      </div>
    );
  }

  const isCurrentMonth = month === format(new Date(), 'yyyy-MM');
  const navBtn = 'p-1.5 max-md:min-w-11 max-md:min-h-11 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer';

  return (
    <div className="p-6 space-y-4">
      <div className="bg-surface rounded-lg shadow-card border border-border-light">
        {/* Card header: month + navigation + view toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-border-light">
          <h2 className="text-base font-semibold text-text">{format(monthDate, 'MMMM yyyy')}</h2>
          <div className="flex items-center gap-1.5">
            <button className={navBtn} onClick={() => setMonth(format(subMonths(monthDate, 1), 'yyyy-MM'))} aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <button className={navBtn} onClick={() => setMonth(format(addMonths(monthDate, 1), 'yyyy-MM'))} aria-label="Next month">
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => setMonth(format(new Date(), 'yyyy-MM'))}
              disabled={isCurrentMonth}
              className="px-2.5 py-1 text-xs font-medium border border-border rounded-md text-text-secondary hover:bg-hover disabled:opacity-50 disabled:cursor-default transition-colors cursor-pointer"
            >
              Today
            </button>
            <div className="w-px h-5 bg-border mx-1" />
            <div className="flex border border-border rounded-md overflow-hidden">
              {([
                ['list', 'List', List],
                ['calendar', 'Calendar', CalendarDays],
              ] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    view === id ? 'bg-surface-alt text-text' : 'text-text-tertiary hover:text-text-secondary'
                  } ${id === 'calendar' ? 'border-l border-border' : ''}`}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Summary strip */}
        <div className="flex divide-x divide-border-light">
          <SummaryColumn label="Income" verb="received" totals={incomeTotals} barClass="bg-positive" />
          <SummaryColumn label="Expenses" verb="paid" totals={expenseTotals} barClass="bg-negative" />
        </div>
      </div>

      {isLoading ? (
        <div className="bg-surface rounded-lg shadow-card border border-border-light p-5 space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-surface-alt rounded animate-pulse" />)}
        </div>
      ) : occurrences.length === 0 ? (
        <div className="bg-surface rounded-lg shadow-card border border-border-light py-14 text-center">
          <p className="text-sm font-semibold text-text">No recurring items this month</p>
          <p className="text-xs text-text-tertiary mt-1">Add bills, subscriptions, or paychecks to track them here.</p>
          <div className="flex justify-center gap-2 mt-4">
            <Button variant="secondary" size="sm" onClick={onFind}>
              <Sparkles size={13} /> Find recurring
            </Button>
            <Button size="sm" onClick={onAdd}>
              <Plus size={13} /> Add recurring
            </Button>
          </div>
        </div>
      ) : view === 'calendar' ? (
        <div className="bg-surface rounded-lg shadow-card border border-border-light p-4">
          <Calendar
            month={month}
            occurrences={occurrences}
            onDateClick={(date) => { setView('list'); setHighlightDate(date); }}
          />
        </div>
      ) : (
        <div className="bg-surface rounded-lg shadow-card border border-border-light overflow-hidden">
          {renderSection('Income', income)}
          {renderSection('Expenses', expenses)}
        </div>
      )}
    </div>
  );
}
