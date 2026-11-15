import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Sparkles } from 'lucide-react';
import MonthlyTab from '../components/recurring/MonthlyTab';
import AllTab from '../components/recurring/AllTab';
import RecurringFormModal from '../components/recurring/RecurringFormModal';
import MatchSuggestionsPanel from '../components/recurring/MatchSuggestionsPanel';
import OccurrenceMatchModal from '../components/recurring/OccurrenceMatchModal';
import DiscoverSchedulesModal from '../components/recurring/DiscoverSchedulesModal';
import UpcomingLengthModal from '../components/recurring/UpcomingLengthModal';
import { Button } from '../components/ui/Button';
import { useOpenFromLink } from '../hooks/useOpenFromLink';
import {
  useSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useScheduleOccurrences,
} from '../hooks/useSchedules';
import type { Schedule } from '../types';
import { format, subDays, addDays } from 'date-fns';

const TABS = ['monthly', 'all'] as const;

type TabId = (typeof TABS)[number];

export default function RecurringTransactionsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('monthly');
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<Schedule | null>(null);
  const [matchOccurrenceId, setMatchOccurrenceId] = useState<string | null>(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  useOpenFromLink('add', () => {
    setEditItem(null);
    setFormOpen(true);
  });

  const { data: allRecurring = [] } = useSchedules();
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();

  const matchFrom = format(subDays(new Date(), 30), 'yyyy-MM-dd');
  const matchTo = format(addDays(new Date(), 90), 'yyyy-MM-dd');
  const { data: allOccurrences = [] } = useScheduleOccurrences(matchFrom, matchTo);
  const matchOccurrence = matchOccurrenceId
    ? (allOccurrences.find((o) => o.id === matchOccurrenceId) ?? null)
    : null;

  function handleEdit(item: Schedule) {
    setEditItem(item);
    setFormOpen(true);
  }

  function handleSave(data: any) {
    if (editItem) {
      updateSchedule.mutate(
        { id: editItem.id, ...data },
        {
          onSuccess: () => {
            setFormOpen(false);
            setEditItem(null);
          },
        },
      );
    } else {
      createSchedule.mutate(data, {
        onSuccess: () => {
          setFormOpen(false);
        },
      });
    }
  }

  function handleClose() {
    setFormOpen(false);
    setEditItem(null);
  }

  function handleAdd() {
    setEditItem(null);
    setFormOpen(true);
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 border-b border-border shrink-0 flex flex-wrap items-center justify-between gap-x-4">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold text-text py-4">{t('recurring.page.title')}</h1>
          <div className="flex gap-1 self-stretch">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px cursor-pointer ${
                  activeTab === tab
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {t(`recurring.page.tabs.${tab}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 py-2">
          <Button variant="secondary" size="sm" onClick={() => setDiscoverOpen(true)}>
            <Sparkles size={13} /> {t('recurring.all.find')}
          </Button>
          <Button size="sm" onClick={handleAdd}>
            <Plus size={13} /> {t('recurring.all.add')}
          </Button>
        </div>
      </div>

      <MatchSuggestionsPanel />

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'monthly' && (
          <MonthlyTab
            onEdit={handleEdit}
            onAdd={handleAdd}
            onFind={() => setDiscoverOpen(true)}
            allRecurring={allRecurring}
            onMatchOccurrence={setMatchOccurrenceId}
          />
        )}
        {activeTab === 'all' && (
          <AllTab
            allRecurring={allRecurring}
            onEdit={handleEdit}
            onAdd={handleAdd}
            onFind={() => setDiscoverOpen(true)}
            onChangeUpcomingLength={() => setUpcomingOpen(true)}
          />
        )}
      </div>

      <RecurringFormModal
        isOpen={formOpen}
        onClose={handleClose}
        onSave={handleSave}
        editItem={editItem}
      />

      <DiscoverSchedulesModal isOpen={discoverOpen} onClose={() => setDiscoverOpen(false)} />
      <UpcomingLengthModal isOpen={upcomingOpen} onClose={() => setUpcomingOpen(false)} />

      <OccurrenceMatchModal
        isOpen={matchOccurrenceId !== null}
        onClose={() => setMatchOccurrenceId(null)}
        occurrence={matchOccurrence}
      />
    </div>
  );
}
