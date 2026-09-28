import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Snowflake } from 'lucide-react';
import RowMenu from '../../recurring/RowMenu';
import type { RowMenuItem } from '../../recurring/RowMenu';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { DateRangeControl } from '../DateRangeControl';
import ReportChartArea from '../ReportChartArea';
import { BUILTIN_REPORTS, BuiltinReportChart } from '../BuiltinReport';
import { ChartSkeleton } from '../ChartHelpers';
import NameModal from './NameModal';
import { useCustomReportData, useUpdateSavedReport } from '../../../hooks/useCustomReports';
import { useDeleteWidget, useUpdateWidget } from '../../../hooks/useDashboards';
import {
  formatDateRange,
  freezeDateRange,
  isFrozen,
  resolveDateRange,
  unfreezeDateRange,
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
  editing: boolean;
}

export default function WidgetCard({ widget, report, pages, editing }: Props) {
  const navigate = useNavigate();
  const updateWidget = useUpdateWidget();
  const deleteWidget = useDeleteWidget();
  const updateReport = useUpdateSavedReport();
  const [rangeOpen, setRangeOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const isCustom = widget.type === 'custom-report';
  // Custom report widgets use the report's own range, so changing it changes the report
  const savedRange: ReportDateRange | undefined = isCustom
    ? report?.config.dateRange
    : widget.meta.dateRange;
  const range = savedRange && resolveDateRange(savedRange);
  const unfrozen = savedRange && isFrozen(savedRange) ? unfreezeDateRange(savedRange) : undefined;
  const title = isCustom
    ? (report?.name ?? '')
    : widget.meta.name || BUILTIN_REPORTS[widget.type].label;

  const openPath = isCustom
    ? `/reports/custom/${widget.customReportId}?dashboard=${widget.pageId}`
    : `/reports/widget/${widget.id}`;

  function saveRange(next: ReportDateRange) {
    if (isCustom) {
      if (report)
        updateReport.mutate({
          id: report.id,
          data: { config: { ...report.config, dateRange: next } },
        });
    } else {
      updateWidget.mutate({ widget, data: { meta: { ...widget.meta, dateRange: next } } });
    }
  }

  const menu: RowMenuItem[] = [
    { label: isCustom ? 'Edit report' : 'Open', onClick: () => navigate(openPath) },
    { label: 'Rename…', onClick: () => setRenameOpen(true), hidden: isCustom },
    { label: 'Date range…', onClick: () => setRangeOpen(true), hidden: !savedRange },
    {
      label: 'Freeze dates',
      onClick: () => savedRange && saveRange(freezeDateRange(savedRange)),
      hidden: !savedRange || isFrozen(savedRange),
    },
    {
      label: `Unfreeze (${unfrozen ? formatDateRange(unfrozen) : ''})`,
      onClick: () => unfrozen && saveRange(unfrozen),
      hidden: !unfrozen,
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
          {range && (
            <p className="flex items-center gap-1 text-[11px] text-text-tertiary">
              {isFrozen(range) && (
                <Snowflake size={10} className="text-brand-500" aria-label="Frozen" />
              )}
              {formatDateRange(range)}
            </p>
          )}
        </div>
        <Isolate>
          <RowMenu items={menu} />
        </Isolate>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden pointer-events-none">
        {isCustom ? (
          report && range ? (
            <CustomReportBody report={report} range={range} />
          ) : (
            <ChartSkeleton />
          )
        ) : (
          <BuiltinReportChart type={widget.type} from={range!.from} to={range!.to} compact />
        )}
      </div>

      <Isolate>
        {rangeOpen && savedRange && (
          <DateRangeModal
            initial={savedRange}
            onClose={() => setRangeOpen(false)}
            onSave={(next) => {
              saveRange(next);
              setRangeOpen(false);
            }}
          />
        )}
        {renameOpen && !isCustom && (
          <NameModal
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

function DateRangeModal({
  initial,
  onClose,
  onSave,
}: {
  initial: ReportDateRange;
  onClose: () => void;
  onSave: (range: ReportDateRange) => void;
}) {
  const [value, setValue] = useState(() => resolveDateRange(initial));
  return (
    <Modal isOpen onClose={onClose} title="Date range" size="md">
      <DateRangeControl value={value} onChange={setValue} />
      <p className="text-xs text-text-tertiary mt-3">
        {isFrozen(value)
          ? 'Frozen: this widget keeps showing these months.'
          : 'Live: this widget moves forward with the current month.'}
      </p>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onSave(value)}>Save</Button>
      </div>
    </Modal>
  );
}
