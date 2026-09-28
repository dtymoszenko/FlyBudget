import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Save } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { DateRangeControl } from '../components/reports/DateRangeControl';
import {
  BUILTIN_REPORTS,
  BuiltinReportChart,
  BuiltinReportStats,
  useBuiltinCsvExport,
} from '../components/reports/BuiltinReport';
import { ChartSkeleton } from '../components/reports/ChartHelpers';
import { useDashboardWidget, useUpdateWidget } from '../hooks/useDashboards';
import { resolveDateRange } from '../utils/dateRange';
import type { BuiltinWidget, BuiltinWidgetType, ReportDateRange } from '../types';

const CHART_HEIGHT: Record<BuiltinWidgetType, string> = {
  summary: 'h-72',
  'net-worth': 'h-72',
  'income-expenses': 'h-72',
  spending: 'h-96',
  'spending-trends': 'h-80',
};

/** Full view of a built-in dashboard widget, where its date range can be explored and saved. */
export default function ReportWidgetView() {
  const { id } = useParams<{ id: string }>();
  const { data: widget, isLoading, isError } = useDashboardWidget(id);

  if (isError) return <Navigate to="/reports" replace />;
  if (isLoading || !widget) {
    return (
      <div className="h-64 p-6">
        <ChartSkeleton />
      </div>
    );
  }
  if (widget.type === 'custom-report') {
    return (
      <Navigate
        to={`/reports/custom/${widget.customReportId}?dashboard=${widget.pageId}`}
        replace
      />
    );
  }
  return <BuiltinView key={widget.id} widget={widget} />;
}

const sameRange = (a: ReportDateRange, b: ReportDateRange) =>
  a.preset === b.preset && (a.preset !== 'custom' || (a.from === b.from && a.to === b.to));

function BuiltinView({ widget }: { widget: BuiltinWidget }) {
  const updateWidget = useUpdateWidget();
  const [range, setRange] = useState(() => resolveDateRange(widget.meta.dateRange));
  const exportCsv = useBuiltinCsvExport(widget.type, range.from, range.to);
  const changed = !sameRange(range, widget.meta.dateRange);
  const title = widget.meta.name || BUILTIN_REPORTS[widget.type].label;

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to={`/reports?dashboard=${widget.pageId}`}
              aria-label="Back to dashboard"
              className="text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <ArrowLeft size={16} />
            </Link>
            <h1 className="text-lg font-semibold text-text truncate">{title}</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangeControl value={range} onChange={setRange} />
            {exportCsv && (
              <Button variant="secondary" size="sm" onClick={exportCsv}>
                <Download size={13} /> Export CSV
              </Button>
            )}
            <Button
              size="sm"
              disabled={!changed || updateWidget.isPending}
              title="Save this date range to the dashboard widget"
              onClick={() =>
                updateWidget.mutate({
                  widget,
                  data: { meta: { ...widget.meta, dateRange: range } },
                })
              }
            >
              <Save size={13} /> Save to widget
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <BuiltinReportStats type={widget.type} from={range.from} to={range.to} />
        <div className={`w-full ${CHART_HEIGHT[widget.type]}`}>
          <BuiltinReportChart type={widget.type} from={range.from} to={range.to} />
        </div>
      </div>
    </div>
  );
}
