import { useMemo } from 'react';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  format,
  parseISO,
} from 'date-fns';
import type { ScheduleOccurrence, OccurrenceDisplayStatus } from '../../types';

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 3;

const CHIP_COLORS: Record<OccurrenceDisplayStatus, string> = {
  upcoming: 'bg-brand-50 text-brand-700',
  due: 'bg-caution-subtle text-caution',
  waiting: 'bg-negative-subtle text-negative',
  paid: 'bg-positive-subtle text-positive',
  skipped: 'bg-surface-alt text-text-disabled line-through',
  cancelled: 'bg-surface-alt text-text-disabled line-through',
};

/** Phones: a dot per item instead of a name chip (names don't fit a seventh of a phone) */
const DOT_COLORS: Record<OccurrenceDisplayStatus, string> = {
  upcoming: 'bg-brand-600',
  due: 'bg-caution',
  waiting: 'bg-negative',
  paid: 'bg-positive',
  skipped: 'bg-text-disabled',
  cancelled: 'bg-text-disabled',
};

interface Props {
  month: string;
  occurrences: ScheduleOccurrence[];
  onDateClick?: (date: string) => void;
}

/** Month grid; navigation lives in the parent card header. */
export default function Calendar({ month, occurrences, onDateClick }: Props) {
  const monthDate = parseISO(`${month}-01`);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthDate));
    const end = endOfWeek(endOfMonth(monthDate));
    return eachDayOfInterval({ start, end });
  }, [month]);

  const occByDate = useMemo(() => {
    const map = new Map<string, ScheduleOccurrence[]>();
    for (const occ of occurrences) {
      const list = map.get(occ.expectedDate) || [];
      list.push(occ);
      map.set(occ.expectedDate, list);
    }
    return map;
  }, [occurrences]);

  return (
    <div className="grid grid-cols-7 gap-px bg-border-light rounded-lg overflow-hidden border border-border-light">
      {DAY_HEADERS.map((d) => (
        <div
          key={d}
          className="bg-surface-alt py-2 text-center text-xs font-medium text-text-tertiary"
        >
          {d}
        </div>
      ))}
      {days.map((day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const inMonth = isSameMonth(day, monthDate);
        const isToday = isSameDay(day, new Date());
        const dayOccs = inMonth ? occByDate.get(dateStr) || [] : [];

        return (
          <div
            key={dateStr}
            onClick={() => dayOccs.length > 0 && onDateClick?.(dateStr)}
            className={`bg-surface min-h-[96px] max-md:min-h-14 p-1.5 flex flex-col gap-1 ${
              dayOccs.length > 0 ? 'cursor-pointer hover:bg-hover' : ''
            } ${!inMonth ? 'opacity-40' : ''}`}
          >
            <span
              className={`text-xs tabular-nums self-start ${
                isToday
                  ? 'bg-brand-600 text-white w-5 h-5 rounded-full inline-flex items-center justify-center font-medium'
                  : 'text-text-secondary px-0.5'
              }`}
            >
              {format(day, 'd')}
            </span>
            {dayOccs.length > 0 && (
              <span className="md:hidden flex flex-wrap gap-1 px-0.5" aria-hidden>
                {dayOccs.map((occ) => (
                  <span
                    key={occ.id}
                    className={`w-2 h-2 rounded-full ${DOT_COLORS[occ.displayStatus]}`}
                  />
                ))}
              </span>
            )}
            {dayOccs.slice(0, MAX_CHIPS).map((occ) => (
              <span
                key={occ.id}
                className={`max-md:hidden text-[11px] leading-tight px-1.5 py-0.5 rounded truncate ${CHIP_COLORS[occ.displayStatus]}`}
                title={occ.scheduleName}
              >
                {occ.scheduleName}
              </span>
            ))}
            {dayOccs.length > MAX_CHIPS && (
              <span className="max-md:hidden text-[11px] text-text-tertiary px-1">
                +{dayOccs.length - MAX_CHIPS} more
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
