import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pin, Snowflake } from 'lucide-react';
import RowMenu from '../../recurring/RowMenu';
import type { RowMenuItem } from '../../recurring/RowMenu';
import { Modal, useModalValue } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { DateRangeControl } from '../DateRangeControl';
import ReportChartArea from '../ReportChartArea';
import { BUILTIN_REPORTS, BuiltinReportChart } from '../BuiltinReport';
import { ChartSkeleton } from '../ChartHelpers';
import NameModal from './NameModal';
import { useCustomReportData } from '../../../hooks/useCustomReports';
import { useDeleteWidget, useUpdateWidget } from '../../../hooks/useDashboards';
import {
  encodeRangeParam,
  formatDateRange,
  freezeDateRange,
  isFrozen,
  widgetDateRange,
} from '../../../utils/dateRange';
import type {
  DashboardPage,
  DashboardWidget,
  ReportDateRange,
  SavedCustomReport,
} from '../../../types';

/** Elements with this class never start a drag, so their clicks still work in edit mode. */
export const NO_DRAG_CLASS = 'widget-no-drag';

interface Props {
  widget: DashboardWidget;
  /** The saved report behind a custom report widget (undefined while loading) */
  report?: SavedCustomReport;
  pages: DashboardPage[];
  /** The range of the dashboard this widget is on, which it follows unless it has its own */
  dashboardRange: ReportDateRange;
  editing: boolean;
}

export default function WidgetCard({ widget, report, pages, dashboardRange, editing }: Props) {
  const navigate = useNavigate();
  const updateWidget = useUpdateWidget();
  const deleteWidget = useDeleteWidget();
  const [rangeOpen, setRangeOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const isCustom = widget.type === 'custom-report';
  const rangeModal = useModalValue(rangeOpen);
  const renameModal = useModalValue(renameOpen && !isCustom);
  const { range, source } = widgetDateRange(widget.meta.dateRange, dashboardRange);
  const title = isCustom
    ? (report?.name ?? '')
    : widget.meta.name || BUILTIN_REPORTS[widget.type].label;

  const openPath = isCustom
    ? `/reports/custom/${widget.customReportId}?dashboard=${widget.pageId}&range=${encodeRangeParam(range)}`
    : `/reports/widget/${widget.id}`;

  // Sets the widget's own range, or with `undefined` makes it follow the dashboard again
  function setOwnRange(next: ReportDateRange | undefined) {
    const { dateRange: _old, ...rest } = widget.meta;
    updateWidget.mutate({ widget, data: { meta: next ? { ...rest, dateRange: next } : rest } });
  }

  const menu: RowMenuItem[] = [
    { label: isCustom ? 'Edit report' : 'Open', onClick: () => navigate(openPath) },
    { label: 'Rename…', onClick: () => setRenameOpen(true), hidden: isCustom },
    { label: 'Date range…', onClick: () => setRangeOpen(true) },
    {
      label: 'Freeze dates',
      onClick: () => setOwnRange(freezeDateRange(range)),
      hidden: source === 'frozen',
    },
    { label: 'Unfreeze', onClick: () => setOwnRange(undefined), hidden: source !== 'frozen' },
    {
      label: 'Use dashboard range',
      onClick: () => setOwnRange(undefined),
      hidden: source !== 'own',
    },
    ...pages
      .filter((p) => p.id !== widget.pageId)
      .map((p) => ({
        label: `Move to ${p.name}`,
        onClick: () => updateWidget.mutate({ widget, data: { pageId: p.id } }),
      })),
    { label: 'Remove from dashboard', danger: true, onClick: () => deleteWidget.mutate(widget) },
  ];

  return (
    <div
      onClick={() => !editing && navigate(openPath)}
      className={`h-full flex flex-col bg-surface rounded-lg border p-3 transition-all ${
        editing
          ? 'border-dashed border-brand-300 cursor-move'
          : 'border-border-light hover:shadow-hover hover:border-brand-200 cursor-pointer group'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2 shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text truncate group-hover:text-brand-600 transition-colors">
            {title}
          </p>
          <p className="flex items-center gap-1 text-[11px] text-text-tertiary">
            {source === 'frozen' && (
              <Snowflake size={10} className="text-brand-500" aria-label="Frozen" />
            )}
            {source === 'own' && (
              <Pin size={10} className="text-brand-500" aria-label="Own date range" />
            )}
            {formatDateRange(range)}
          </p>
        </div>
        <Isolate>
          <RowMenu items={menu} />
        </Isolate>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden pointer-events-none">
        {isCustom ? (
          report ? (
            <CustomReportBody report={report} range={range} />
          ) : (
            <ChartSkeleton />
          )
        ) : (
          <BuiltinReportChart type={widget.type} from={range.from} to={range.to} compact />
        )}
      </div>

      <Isolate>
        {rangeModal.value && (
          <DateRangeModal
            isOpen={rangeModal.isOpen}
            own={widget.meta.dateRange}
            dashboardRange={dashboardRange}
            onClose={() => setRangeOpen(false)}
            onSave={(next) => {
              setOwnRange(next);
              setRangeOpen(false);
            }}
          />
        )}
        {renameModal.value && (
          <NameModal
            isOpen={renameModal.isOpen}
            title="Rename widget"
            label="Name"
            initialName={title}
            submitLabel="Rename"
            onClose={() => setRenameOpen(false)}
            onSave={(name) => {
              updateWidget.mutate({ widget, data: { meta: { ...widget.meta, name } } });
              setRenameOpen(false);
            }}
          />
        )}
      </Isolate>
    </div>
  );
}

/**
 * Menus and modals render in portals, but React still bubbles their events through the card:
 * stop them here so they neither open the report nor start a drag in edit mode.
 */
function Isolate({ children }: { children: React.ReactNode }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className={NO_DRAG_CLASS} onClick={stop} onMouseDown={stop} onTouchStart={stop}>
      {children}
    </div>
  );
}

function CustomReportBody({
  report,
  range,
}: {
  report: SavedCustomReport;
  range: ReportDateRange;
}) {
  const config = { ...report.config, dateRange: range };
  const { data, isLoading } = useCustomReportData(config);
  return <ReportChartArea config={config} data={data} isLoading={isLoading} />;
}

/** Choose between following the dashboard and a range of the widget's own (live or frozen). */
function DateRangeModal({
  own,
  dashboardRange,
  onClose,
  onSave,
  isOpen = true,
}: {
  isOpen?: boolean;
  own: ReportDateRange | undefined;
  dashboardRange: ReportDateRange;
  onClose: () => void;
  onSave: (range: ReportDateRange | undefined) => void;
}) {
  const [follow, setFollow] = useState(!own);
  const [value, setValue] = useState(() => widgetDateRange(own, dashboardRange).range);
  const option = (active: boolean) =>
    `flex-1 px-3 py-2 text-sm rounded-md border text-left transition-colors cursor-pointer ${
      active
        ? 'border-brand-500 bg-brand-50 text-brand-700'
        : 'border-border text-text-secondary hover:bg-hover'
    }`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Date range" size="md">
      <div className="flex gap-2 mb-4">
        <button className={option(follow)} onClick={() => setFollow(true)}>
          <p className="font-medium">Follow dashboard</p>
          <p className="text-xs text-text-tertiary">{formatDateRange(dashboardRange)}</p>
        </button>
        <button className={option(!follow)} onClick={() => setFollow(false)}>
          <p className="font-medium">Own date range</p>
          <p className="text-xs text-text-tertiary">Ignores the dashboard's range</p>
        </button>
      </div>
      {!follow && (
        <>
          <DateRangeControl value={value} onChange={setValue} />
          <p className="text-xs text-text-tertiary mt-3">
            {isFrozen(value)
              ? 'Frozen: this widget keeps showing these months.'
              : 'Live: this widget moves forward with the current month.'}
          </p>
        </>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onSave(follow ? undefined : value)}>Save</Button>
      </div>
    </Modal>
  );
}
