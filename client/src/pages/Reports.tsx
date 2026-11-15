import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, LayoutGrid, Plus } from 'lucide-react';
import { MissingRatesBanner } from '../components/currency/MissingRatesBanner';
import { Button } from '../components/ui/Button';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useModalValue } from '../components/ui/Modal';
import RowMenu from '../components/ui/RowMenu';
import AddWidgetMenu from '../components/reports/dashboard/AddWidgetMenu';
import DashboardGrid from '../components/reports/dashboard/DashboardGrid';
import NameModal from '../components/reports/dashboard/NameModal';
import { ChartSkeleton } from '../components/reports/ChartHelpers';
import { DateRangeControl } from '../components/reports/DateRangeControl';
import {
  useCreateDashboard,
  useDashboards,
  useDashboardWidgets,
  useDeleteDashboard,
  useUpdateDashboard,
} from '../hooks/useDashboards';
import { useSavedReports } from '../hooks/useCustomReports';
import { dashboardDateRange, encodeRangeParam } from '../utils/dateRange';

type DashboardModal = 'new' | 'rename' | 'delete' | null;

export default function ReportsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: pages = [], isLoading: pagesLoading } = useDashboards();
  const { data: reports = [] } = useSavedReports();
  const createDashboard = useCreateDashboard();
  const updateDashboard = useUpdateDashboard();
  const deleteDashboard = useDeleteDashboard();
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState<DashboardModal>(null);

  // The open dashboard lives in the URL so the report builder can link back to it
  const active = pages.find((p) => p.id === searchParams.get('dashboard')) ?? pages[0];
  const { data: widgets = [], isLoading: widgetsLoading } = useDashboardWidgets(active?.id);
  const dashboardRange = dashboardDateRange(active);
  const newModal = useModalValue(modal === 'new');
  const renameModal = useModalValue(modal === 'rename' && active);
  // Widgets with their own range (live or frozen) ignore the dashboard's picker
  const ownRangeCount = widgets.filter((w) => w.meta.dateRange).length;

  function select(id: string) {
    setSearchParams({ dashboard: id }, { replace: true });
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 pt-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-lg font-semibold text-text shrink-0">{t('reports.page.title')}</h1>
          {active && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Layout editing is desktop-only; phones get a single stacked column */}
              <div className="hidden md:block">
                <Button
                  variant={editing ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setEditing(!editing)}
                >
                  {editing ? <Check size={13} /> : <LayoutGrid size={13} />}
                  {t(editing ? 'common.actions.done' : 'reports.page.editLayout')}
                </Button>
              </div>
              <AddWidgetMenu pageId={active.id} reports={reports} />
              <Link
                to={`/reports/custom?dashboard=${active.id}&range=${encodeRangeParam(dashboardRange)}`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-brand-600 rounded-md hover:bg-brand-700 shadow-xs transition-colors"
              >
                <Plus size={13} />
                {t('reports.page.customReport')}
              </Link>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0 mt-3 -mb-px overflow-x-auto">
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => select(p.id)}
              className={`px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 cursor-pointer ${
                active?.id === p.id
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {p.name}
            </button>
          ))}
          <button
            onClick={() => setModal('new')}
            aria-label={t('reports.dashboard.new')}
            title={t('reports.dashboard.new')}
            className="ml-1 p-1.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer"
          >
            <Plus size={15} />
          </button>
          {active && (
            <div className="ml-auto pl-2">
              <RowMenu
                items={[
                  { label: t('reports.dashboard.renameMenu'), onClick: () => setModal('rename') },
                  {
                    label: t('reports.dashboard.delete'),
                    danger: true,
                    hidden: pages.length <= 1,
                    onClick: () => setModal('delete'),
                  },
                ]}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 bg-page">
        <MissingRatesBanner className="mb-4" />
        {active && (
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mb-4">
            <span className="text-xs font-medium text-text-secondary">
              {t('reports.page.dateRange')}
            </span>
            <DateRangeControl
              value={dashboardRange}
              onChange={(dateRange) =>
                updateDashboard.mutate({ id: active.id, data: { dateRange } })
              }
            />
            {ownRangeCount > 0 && (
              <span className="text-xs text-text-tertiary">
                {t('reports.page.ownRange', { count: ownRangeCount })}
              </span>
            )}
          </div>
        )}
        {pagesLoading || widgetsLoading ? (
          <div className="h-64">
            <ChartSkeleton />
          </div>
        ) : active && widgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20 gap-3 px-6">
            <LayoutGrid size={26} className="text-brand-600" aria-hidden />
            <p className="text-base font-semibold text-text">{t('reports.page.empty.title')}</p>
            <p className="text-sm text-text-tertiary max-w-sm">
              {t('reports.page.empty.description')}
            </p>
            <AddWidgetMenu pageId={active.id} reports={reports} />
          </div>
        ) : (
          active && (
            <DashboardGrid
              pageId={active.id}
              widgets={widgets}
              reports={reports}
              pages={pages}
              dashboardRange={dashboardRange}
              editing={editing}
            />
          )
        )}
      </div>

      {newModal.value && (
        <NameModal
          isOpen={newModal.isOpen}
          title={t('reports.dashboard.new')}
          label={t('reports.dashboard.name')}
          placeholder={t('reports.dashboard.namePlaceholder')}
          submitLabel={t('reports.dashboard.create')}
          onClose={() => setModal(null)}
          onSave={(name) =>
            createDashboard.mutate(name, {
              onSuccess: (page) => {
                setModal(null);
                select(page.id);
              },
            })
          }
        />
      )}
      {renameModal.value && (
        <NameModal
          isOpen={renameModal.isOpen}
          title={t('reports.dashboard.renameTitle')}
          label={t('reports.dashboard.name')}
          initialName={renameModal.value.name}
          submitLabel={t('reports.dashboard.rename')}
          onClose={() => setModal(null)}
          onSave={(name) =>
            updateDashboard.mutate(
              { id: renameModal.value!.id, data: { name } },
              { onSuccess: () => setModal(null) },
            )
          }
        />
      )}
      {active && (
        <ConfirmModal
          isOpen={modal === 'delete'}
          onClose={() => setModal(null)}
          onConfirm={() =>
            deleteDashboard.mutate(active.id, {
              onSuccess: () => {
                setModal(null);
                const next = pages.find((p) => p.id !== active.id);
                if (next) select(next.id);
              },
            })
          }
          title={t('reports.dashboard.delete')}
          message={t('reports.dashboard.deleteMessage', { name: active.name })}
          confirmLabel={t('common.actions.delete')}
          danger
        />
      )}
    </div>
  );
}
