import {
  AlertOctagon,
  AlertTriangle,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Pause,
  SkipForward,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { OccurrenceDisplayStatus } from '../../types';

// Occurrence statuses + schedule-level states (Actual Budget's badge scheme)
export type RecurringBadgeStatus = OccurrenceDisplayStatus | 'paused' | 'scheduled';

const BADGE: Record<RecurringBadgeStatus, { label: string; className: string; Icon: LucideIcon }> =
  {
    waiting: { label: 'Missed', className: 'bg-negative-subtle text-negative', Icon: AlertOctagon },
    due: { label: 'Due', className: 'bg-caution-subtle text-caution', Icon: AlertTriangle },
    upcoming: { label: 'Upcoming', className: 'bg-brand-50 text-brand-600', Icon: CalendarDays },
    paid: { label: 'Paid', className: 'bg-positive-subtle text-positive', Icon: CheckCircle2 },
    skipped: {
      label: 'Skipped',
      className: 'bg-surface-alt text-text-tertiary',
      Icon: SkipForward,
    },
    cancelled: { label: 'Canceled', className: 'bg-surface-alt text-text-tertiary', Icon: XCircle },
    paused: { label: 'Paused', className: 'bg-caution-subtle text-caution', Icon: Pause },
    scheduled: {
      label: 'Scheduled',
      className: 'bg-surface-alt text-text-secondary',
      Icon: Calendar,
    },
  };

export function statusLabel(status: RecurringBadgeStatus): string {
  return BADGE[status].label;
}

export default function StatusBadge({ status }: { status: RecurringBadgeStatus }) {
  const { label, className, Icon } = BADGE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium shrink-0 ${className}`}
    >
      <Icon size={12} />
      {label}
    </span>
  );
}
