import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format, addDays, parseISO, differenceInCalendarDays } from 'date-fns';
import { useScheduleOccurrences } from '../../hooks/useSchedules';
import { formatMoney } from '../../utils/currency';
import { CalendarClock } from 'lucide-react';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ButtonLink } from '../ui/Button';
import { useSchedules } from '../../hooks/useSchedules';
import { formatShortDay } from '../../utils/dates';

export default function UpcomingBills() {
  const { t } = useTranslation();
  const today = format(new Date(), 'yyyy-MM-dd');
  const thirtyDaysOut = format(addDays(new Date(), 30), 'yyyy-MM-dd');

  const { data: occurrences = [], isLoading } = useScheduleOccurrences(today, thirtyDaysOut);
  const { data: schedules = [] } = useSchedules();

  const upcoming = useMemo(
    () =>
      occurrences
        .filter(
          (o) =>
            o.displayStatus === 'upcoming' ||
            o.displayStatus === 'due' ||
            o.displayStatus === 'waiting',
        )
        .slice(0, 5),
    [occurrences],
  );

  if (isLoading) {
    return (
      <Card>
        <div className="h-5 w-32 bg-surface-alt rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-surface-alt rounded animate-pulse" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text">{t('dashboard.upcoming.title')}</h3>
        <Link to="/recurring" className="text-xs text-brand-600 hover:text-brand-700 font-medium">
          {t('dashboard.viewAll')}
        </Link>
      </div>

      {upcoming.length === 0 ? (
        schedules.length === 0 ? (
          <EmptyState
            compact
            icon={<CalendarClock size={20} />}
            title={t('dashboard.upcoming.emptyTitle')}
            description={t('dashboard.upcoming.emptyDescription')}
            actions={
              <ButtonLink size="sm" to="/recurring?add=1">
                {t('dashboard.upcoming.add')}
              </ButtonLink>
            }
          />
        ) : (
          <p className="text-sm text-text-tertiary py-6 text-center">
            {t('dashboard.upcoming.none')}
          </p>
        )
      ) : (
        <div className="divide-y divide-border-light">
          {upcoming.map((occ, i) => {
            // Calendar days: tomorrow is 1 day away even late in the evening
            const daysUntil = differenceInCalendarDays(parseISO(occ.expectedDate), new Date());
            const isWaiting = occ.displayStatus === 'waiting';
            return (
              <div
                key={`${occ.scheduleId}-${occ.id}-${i}`}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${isWaiting ? 'bg-caution' : 'bg-brand-500'}`}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm truncate ${isWaiting ? 'text-caution font-medium' : 'text-text'}`}
                  >
                    {occ.scheduleName}
                  </p>
                  <p className="text-xs text-text-tertiary">
                    {isWaiting
                      ? t('dashboard.upcoming.when.overdue', {
                          date: formatShortDay(occ.expectedDate),
                          days: Math.abs(daysUntil),
                        })
                      : daysUntil === 0
                        ? t('dashboard.upcoming.when.today', {
                            date: formatShortDay(occ.expectedDate),
                          })
                        : daysUntil === 1
                          ? t('dashboard.upcoming.when.tomorrow', {
                              date: formatShortDay(occ.expectedDate),
                            })
                          : t('dashboard.upcoming.when.inDays', {
                              date: formatShortDay(occ.expectedDate),
                              days: daysUntil,
                            })}
                  </p>
                </div>
                <span
                  className={`text-sm font-medium tabular-nums whitespace-nowrap ${
                    occ.expectedAmount > 0 ? 'text-positive' : 'text-text'
                  }`}
                >
                  {formatMoney(occ.expectedAmount, occ.currency)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
