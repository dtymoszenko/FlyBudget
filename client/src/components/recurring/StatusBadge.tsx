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
import { t } from '../../i18n';
import type { OccurrenceDisplayStatus } from '../../types';

// Occurrence statuses + schedule-level states (Actual Budget's badge scheme)
export type RecurringBadgeStatus = OccurrenceDisplayStatus | 'paused' | 'scheduled';

const BADGE: Record<RecurringBadgeStatus, { className: string; Icon: LucideIcon }> = {
  waiting: { className: 'bg-negative-subtle text-negative', Icon: AlertOctagon },
  due: { className: 'bg-caution-subtle text-caution', Icon: AlertTriangle },
  upcoming: { className: 'bg-brand-50 text-brand-600', Icon: CalendarDays },
  paid: { className: 'bg-positive-subtle text-positive', Icon: CheckCircle2 },
  skipped: {
    className: 'bg-surface-alt text-text-tertiary',
    Icon: SkipForward,
  },
  cancelled: { className: 'bg-surface-alt text-text-tertiary', Icon: XCircle },
  paused: { className: 'bg-caution-subtle text-caution', Icon: Pause },
  scheduled: {
    className: 'bg-surface-alt text-text-secondary',
    Icon: Calendar,
  },
};

export function statusLabel(status: RecurringBadgeStatus): string {
  return t(`recurring.status.${status}`);
}

export default function StatusBadge({ status }: { status: RecurringBadgeStatus }) {
  const { className, Icon } = BADGE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium shrink-0 ${className}`}
    >
      <Icon size={12} />
      {statusLabel(status)}
    </span>
  );
}
