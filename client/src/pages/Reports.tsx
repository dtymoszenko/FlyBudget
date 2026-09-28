import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, LayoutGrid, Plus } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import RowMenu from '../components/recurring/RowMenu';
import AddWidgetMenu from '../components/reports/dashboard/AddWidgetMenu';
import DashboardGrid from '../components/reports/dashboard/DashboardGrid';
import NameModal from '../components/reports/dashboard/NameModal';
import { ChartSkeleton } from '../components/reports/ChartHelpers';
import {
  useCreateDashboard,
  useDashboards,
  useDashboardWidgets,
  useDeleteDashboard,
  useRenameDashboard,
} from '../hooks/useDashboards';
import { useSavedReports } from '../hooks/useCustomReports';

type DashboardModal = 'new' | 'rename' | 'delete' | null;

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: pages = [], isLoading: pagesLoading } = useDashboards();
  const { data: reports = [] } = useSavedReports();
  const createDashboard = useCreateDashboard();
  const renameDashboard = useRenameDashboard();
  const deleteDashboard = useDeleteDashboard();
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState<DashboardModal>(null);

  // The open dashboard lives in the URL so the report builder can link back to it
  const active = pages.find((p) => p.id === searchParams.get('dashboard')) ?? pages[0];
  const { data: widgets = [], isLoading: widgetsLoading } = useDashboardWidgets(active?.id);

  function select(id: string) {
    setSearchParams({ dashboard: id }, { replace: true });
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 pt-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-lg font-semibold text-text shrink-0">Reports</h1>
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
                  {editing ? 'Done' : 'Edit layout'}
                </Button>
              </div>
              <AddWidgetMenu pageId={active.id} reports={reports} />
              <Link
                to={`/reports/custom?dashboard=${active.id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-brand-600 rounded-md hover:bg-brand-700 shadow-xs transition-colors"
              >
                <Plus size={13} />
                Custom Report
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
            aria-label="New dashboard"
            title="New dashboard"
            className="ml-1 p-1.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer"
          >
            <Plus size={15} />
          </button>
          {active && (
            <div className="ml-auto pl-2">
              <RowMenu
                items={[
                  { label: 'Rename dashboard…', onClick: () => setModal('rename') },
                  {
                    label: 'Delete dashboard',
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
        {pagesLoading || widgetsLoading ? (
          <div className="h-64">
            <ChartSkeleton />
          </div>
        ) : active && widgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20 gap-3">
            <p className="text-sm text-text-secondary">This dashboard is empty.</p>
            <AddWidgetMenu pageId={active.id} reports={reports} />
          </div>
        ) : (
          active && (
            <DashboardGrid
              pageId={active.id}
              widgets={widgets}
              reports={reports}
              pages={pages}
              editing={editing}
            />
          )
        )}
      </div>

      {modal === 'new' && (
        <NameModal
          title="New dashboard"
          label="Dashboard name"
          placeholder="e.g. Yearly review"
          submitLabel="Create"
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
      {modal === 'rename' && active && (
        <NameModal
          title="Rename dashboard"
          label="Dashboard name"
          initialName={active.name}
          submitLabel="Rename"
          onClose={() => setModal(null)}
          onSave={(name) =>
            renameDashboard.mutate({ id: active.id, name }, { onSuccess: () => setModal(null) })
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
          title="Delete dashboard"
          message={`Delete "${active.name}" and its widgets? Saved custom reports are kept.`}
          confirmLabel="Delete"
          danger
        />
      )}
    </div>
  );
}
