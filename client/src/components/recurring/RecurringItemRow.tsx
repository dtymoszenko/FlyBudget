import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { formatCurrency } from '../../utils/currency';
import type { ScheduleOccurrence } from '../../types';
import StatusBadge from './StatusBadge';
import RowMenu from '../ui/RowMenu';
import { FREQ_LABEL, formatScheduleAmount, occurrenceBadgeStatus } from './scheduleFormat';

/** Shared with the section header in MonthlyTab so columns line up. */
export const OCCURRENCE_GRID =
  'grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_120px_120px_32px] items-center gap-4';

interface Props {
  occurrence: ScheduleOccurrence;
  accountName?: string;
  upcomingDays: number;
  highlighted?: boolean;
  onMarkPaid?: () => void;
  onEdit?: () => void;
  onSkip?: () => void;
  onMatch?: () => void;
  onUnmatch?: () => void;
}

export default function RecurringItemRow({
  occurrence: occ,
  accountName,
  upcomingDays,
  highlighted,
  onMarkPaid,
  onEdit,
  onSkip,
  onMatch,
  onUnmatch,
}: Props) {
  const daysUntil = differenceInCalendarDays(parseISO(occ.expectedDate), new Date());
  const isPaid = occ.displayStatus === 'paid';
  const isPending =
    occ.displayStatus === 'upcoming' ||
    occ.displayStatus === 'due' ||
    occ.displayStatus === 'waiting';
  const isMuted = !isPending;
  const hasDifferentAmount =
    isPaid && occ.matchedAmount !== null && occ.matchedAmount !== occ.expectedAmount;

  let relative: { text: string; tone: string } | null = null;
  if (occ.displayStatus === 'waiting') {
    const n = Math.abs(daysUntil);
    relative = { text: `${n} ${n === 1 ? 'day' : 'days'} overdue`, tone: 'text-negative' };
  } else if (isPending) {
    relative = {
      text: daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `in ${daysUntil} days`,
      tone: 'text-text-tertiary',
    };
  }

  return (
    <div
      data-date={occ.expectedDate}
      onClick={onEdit}
      className={`${OCCURRENCE_GRID} px-5 py-3 border-b border-border-light last:border-b-0 hover:bg-hover transition-colors cursor-pointer ${
        highlighted ? 'bg-brand-50' : ''
      }`}
    >
      <div className="min-w-0">
        <p
          className={`text-sm font-medium truncate ${isMuted ? 'text-text-tertiary' : 'text-text'}`}
        >
          {occ.scheduleName}
        </p>
        <p className="text-xs text-text-tertiary truncate">
          {FREQ_LABEL.get(occ.recurrenceType) ?? occ.recurrenceType}
        </p>
      </div>

      <div className="min-w-0">
        <p className={`text-sm tabular-nums ${isMuted ? 'text-text-tertiary' : 'text-text'}`}>
          {format(parseISO(occ.expectedDate), 'MMM d')}
        </p>
        {relative && <p className={`text-xs ${relative.tone}`}>{relative.text}</p>}
      </div>

      <p className="text-sm text-text-secondary truncate">{accountName ?? '—'}</p>

      <div>
        <StatusBadge status={occurrenceBadgeStatus(occ, upcomingDays)} />
      </div>

      <div className="text-right">
        <p
          className={`text-sm font-medium tabular-nums whitespace-nowrap ${
            isMuted ? 'text-text-tertiary' : occ.expectedAmount > 0 ? 'text-positive' : 'text-text'
          }`}
        >
          {formatScheduleAmount(occ.expectedAmount, occ.amountType)}
        </p>
        {hasDifferentAmount && (
          <p className="text-xs text-caution tabular-nums" title="Actual paid amount">
            {formatCurrency(occ.matchedAmount!)}
          </p>
        )}
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        <RowMenu
          items={[
            {
              label: 'Mark as paid',
              onClick: () => onMarkPaid?.(),
              hidden: !isPending || !onMarkPaid,
            },
            {
              label: 'Match to transaction',
              onClick: () => onMatch?.(),
              hidden: !isPending || !onMatch,
            },
            { label: 'Skip', onClick: () => onSkip?.(), hidden: !isPending || !onSkip },
            {
              label: 'Unlink transaction',
              onClick: () => onUnmatch?.(),
              hidden: !isPaid || !onUnmatch,
            },
            { label: 'Edit recurring', onClick: () => onEdit?.(), hidden: !onEdit },
          ]}
        />
      </div>
    </div>
  );
}
