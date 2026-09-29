import { useMemo, useState } from 'react';
import { format, parseISO, subDays, addDays } from 'date-fns';
import { Search, Sparkles, Clock } from 'lucide-react';
import { useAccounts } from '../../hooks/useAccounts';
import { usePayees } from '../../hooks/usePayees';
import {
  useUpdateSchedule,
  useDeleteSchedule,
  useScheduleOccurrences,
  useMarkOccurrencePaid,
  useSkipOccurrence,
} from '../../hooks/useSchedules';
import { ConfirmModal } from '../ui/ConfirmModal';
import StatusBadge, { statusLabel, type RecurringBadgeStatus } from './StatusBadge';
import RowMenu from '../ui/RowMenu';
import {
  FREQ_LABEL,
  formatScheduleAmount,
  getUpcomingDays,
  occurrenceBadgeStatus,
  describeUpcomingLength,
} from './scheduleFormat';
import { usePreferencesStore } from '../../store/preferencesStore';
import { Button } from '../ui/Button';
import type { Schedule, ScheduleOccurrence } from '../../types';

const GRID =
  'grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_110px_130px_120px_120px_32px] items-center gap-4';

interface Props {
  allRecurring: Schedule[];
  onEdit: (item: Schedule) => void;
  onFind: () => void;
  onChangeUpcomingLength: () => void;
}

interface Row {
  schedule: Schedule;
  payeeName: string;
  accountName: string;
  nextOcc: ScheduleOccurrence | null; // next unpaid occurrence, for actions
  nextDate: string | null;
  status: RecurringBadgeStatus;
}

const isPending = (o: ScheduleOccurrence) =>
  o.displayStatus === 'upcoming' || o.displayStatus === 'due' || o.displayStatus === 'waiting';

/**
 * Mirrors Actual's getStatus() order: completed → missed/due → upcoming (within window) → scheduled,
 * falling back to the latest settled occurrence (paid/skipped) when nothing is pending.
 */
function deriveRow(
  s: Schedule,
  occs: ScheduleOccurrence[],
  upcomingDays: number,
): Pick<Row, 'nextOcc' | 'nextDate' | 'status'> {
  const pending = occs.filter(isPending);
  const next = pending[0] ?? null;
  if (s.status === 'canceled') return { nextOcc: null, nextDate: null, status: 'cancelled' };
  if (s.status === 'paused') return { nextOcc: next, nextDate: next?.expectedDate ?? null, status: 'paused' };
  if (next)
    return { nextOcc: next, nextDate: next.expectedDate, status: occurrenceBadgeStatus(next, upcomingDays) };
  const last = occs[occs.length - 1];
  if (last) return { nextOcc: null, nextDate: last.expectedDate, status: last.displayStatus };
  return { nextOcc: null, nextDate: null, status: 'scheduled' };
}

export default function AllTab({ allRecurring, onEdit, onFind, onChangeUpcomingLength }: Props) {
  const upcomingLength = usePreferencesStore((s) => s.upcomingLength);
  const upcomingDays = getUpcomingDays(upcomingLength);
  const [filter, setFilter] = useState('');
  const [showCanceled, setShowCanceled] = useState(false);
  const [confirm, setConfirm] = useState<{ schedule: Schedule; hard: boolean } | null>(null);

  const { data: accounts = [] } = useAccounts();
  const { data: payees = [] } = usePayees();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const markPaid = useMarkOccurrencePaid();
  const skipOcc = useSkipOccurrence();

  const today = new Date();
  const { data: occurrences = [] } = useScheduleOccurrences(
    format(subDays(today, 30), 'yyyy-MM-dd'),
    format(addDays(today, 365), 'yyyy-MM-dd'),
  );

  const rows = useMemo((): Row[] => {
    const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
    const payeeMap = new Map(payees.map((p) => [p.id, p.name]));
    const occsBySchedule = new Map<string, ScheduleOccurrence[]>();
    for (const o of [...occurrences].sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))) {
      const list = occsBySchedule.get(o.scheduleId) ?? [];
      list.push(o);
      occsBySchedule.set(o.scheduleId, list);
    }
    return allRecurring
      .map((s) => ({
        schedule: s,
        payeeName: s.payeeId ? (payeeMap.get(s.payeeId) ?? '') : '',
        accountName: s.accountId ? (accountMap.get(s.accountId) ?? '') : '',
        ...deriveRow(s, occsBySchedule.get(s.id) ?? [], upcomingDays),
      }))
      .sort((a, b) => (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999'));
  }, [allRecurring, occurrences, accounts, payees, upcomingDays]);

  // Same searchable fields as Actual: name, payee, account, amount, status, date
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.schedule.name,
        r.payeeName,
        r.accountName,
        formatScheduleAmount(r.schedule.amount, r.schedule.amountType),
        statusLabel(r.status),
        r.nextDate ? format(parseISO(r.nextDate), 'MMM d, yyyy') : '',
        FREQ_LABEL.get(r.schedule.recurrenceType) ?? '',
      ].some((f) => f.toLowerCase().includes(q)),
    );
  }, [rows, filter]);

  const active = filtered.filter((r) => r.schedule.status !== 'canceled');
  const canceled = filtered.filter((r) => r.schedule.status === 'canceled');

  function renderRow(r: Row) {
    const s = r.schedule;
    const isPaused = s.status === 'paused';
    const isCanceled = s.status === 'canceled';
    const muted = isPaused || isCanceled;
    return (
      <div
        key={s.id}
        onClick={() => onEdit(s)}
        className={`${GRID} px-5 py-2.5 border-b border-border-light hover:bg-hover transition-colors cursor-pointer`}
      >
        <span className={`text-sm font-medium truncate ${muted ? 'text-text-tertiary' : 'text-text'}`} title={s.name}>
          {s.name}
        </span>
        <span className="text-sm text-text-secondary truncate">{r.payeeName || '—'}</span>
        <span className="text-sm text-text-secondary truncate">{r.accountName || '—'}</span>
        <span className="text-sm text-text-secondary tabular-nums">
          {r.nextDate ? format(parseISO(r.nextDate), 'MMM d, yyyy') : '—'}
        </span>
        <div>
          <StatusBadge status={r.status} />
        </div>
        <span
          className={`text-sm font-medium tabular-nums text-right whitespace-nowrap ${
            muted ? 'text-text-tertiary' : s.amount > 0 ? 'text-positive' : 'text-text'
          }`}
        >
          {formatScheduleAmount(s.amount, s.amountType)}
        </span>
        <span className="text-sm text-text-secondary truncate">
          {FREQ_LABEL.get(s.recurrenceType) ?? s.recurrenceType}
        </span>
        <div onClick={(e) => e.stopPropagation()}>
          <RowMenu
            items={[
              {
                label: 'Mark next as paid',
                hidden: !r.nextOcc || isCanceled,
                onClick: () =>
                  r.nextOcc &&
                  markPaid.mutate({ scheduleId: s.id, date: r.nextOcc.expectedDate, occurrenceId: r.nextOcc.id }),
              },
              {
                label: 'Skip next date',
                hidden: !r.nextOcc || isCanceled,
                onClick: () => r.nextOcc && skipOcc.mutate(r.nextOcc.id),
              },
              {
                label: isPaused ? 'Resume' : 'Pause',
                hidden: isCanceled,
                onClick: () => updateSchedule.mutate({ id: s.id, status: isPaused ? 'active' : 'paused' }),
              },
              {
                label: 'Restart',
                hidden: !isCanceled,
                onClick: () => updateSchedule.mutate({ id: s.id, status: 'active' }),
              },
              { label: 'Edit', onClick: () => onEdit(s) },
              { label: 'Cancel recurring', danger: true, hidden: isCanceled, onClick: () => setConfirm({ schedule: s, hard: false }) },
              { label: 'Delete permanently', danger: true, hidden: !isCanceled, onClick: () => setConfirm({ schedule: s, hard: true }) },
            ]}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onFind}>
            <Sparkles size={13} /> Find recurring
          </Button>
          <Button variant="secondary" size="sm" onClick={onChangeUpcomingLength} title="Change upcoming length">
            <Clock size={13} /> Upcoming: {describeUpcomingLength(upcomingLength)}
          </Button>
        </div>
        <div className="relative w-72">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter recurring…"
            className="w-full text-sm border border-border rounded-md pl-8 pr-3 py-1.5 bg-surface text-text placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
          />
        </div>
      </div>

      <div className="bg-surface rounded-lg shadow-card border border-border-light overflow-hidden">
        <div className={`${GRID} px-5 py-2.5 bg-surface-alt border-b border-border-light text-xs font-medium text-text-tertiary sticky top-0 z-10`}>
          <span>Name</span>
          <span>Payee</span>
          <span>Account</span>
          <span>Next date</span>
          <span>Status</span>
          <span className="text-right">Amount</span>
          <span>Frequency</span>
          <span />
        </div>

        {active.length === 0 && (!canceled.length || !showCanceled) && (
          <p className="py-16 text-center text-sm italic text-text-tertiary">
            {filter ? 'No matching recurring items' : 'No recurring items'}
          </p>
        )}
        {active.map(renderRow)}

        {canceled.length > 0 &&
          (showCanceled ? (
            canceled.map(renderRow)
          ) : (
            <button
              onClick={() => setShowCanceled(true)}
              className="w-full py-2.5 text-center text-sm italic text-text-tertiary hover:bg-hover transition-colors cursor-pointer"
            >
              Show canceled recurring ({canceled.length})
            </button>
          ))}
      </div>

      <ConfirmModal
        isOpen={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) deleteSchedule.mutate({ id: confirm.schedule.id, hard: confirm.hard });
          setConfirm(null);
        }}
        title={confirm?.hard ? 'Delete recurring item?' : 'Cancel recurring item?'}
        message={
          confirm?.hard
            ? `"${confirm.schedule.name}" will be permanently deleted. This cannot be undone.`
            : `"${confirm?.schedule.name}" will stop generating occurrences. You can restart it from the canceled list.`
        }
        confirmLabel={confirm?.hard ? 'Delete' : 'Cancel item'}
        danger
      />
    </div>
  );
}
