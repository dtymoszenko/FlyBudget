import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Pin, Save, Snowflake } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { DateRangeControl } from '../components/reports/DateRangeControl';
import { BUILTIN_REPORTS } from '../components/reports/BuiltinReport';
import { ReportDetail } from '../components/reports/ReportDetail';
import { ChartSkeleton } from '../components/reports/ChartHelpers';
import { useDashboards, useDashboardWidget, useUpdateWidget } from '../hooks/useDashboards';
import {
  dashboardDateRange,
  encodeRangeParam,
  formatDateRange,
  widgetDateRange,
} from '../utils/dateRange';
import type { BuiltinWidget, DashboardPage, ReportDateRange } from '../types';

/** Full view of a built-in dashboard widget, where its date range can be explored and saved. */
export default function ReportWidgetView() {
  const { id } = useParams<{ id: string }>();
  const { data: widget, isLoading, isError } = useDashboardWidget(id);
  const { data: pages } = useDashboards();

  if (isError) return <Navigate to="/reports" replace />;
  if (isLoading || !widget || !pages) {
    return (
      <div className="h-64 p-6">
        <ChartSkeleton />
      </div>
    );
  }
  const page = pages.find((p) => p.id === widget.pageId);
  const dashboardRange = dashboardDateRange(page);
  if (widget.type === 'custom-report') {
    const { range } = widgetDateRange(widget.meta.dateRange, dashboardRange);
    return (
      <Navigate
        to={`/reports/custom/${widget.customReportId}?dashboard=${widget.pageId}&range=${encodeRangeParam(range)}`}
        replace
      />
    );
  }
  return (
    <BuiltinView key={widget.id} widget={widget} page={page} dashboardRange={dashboardRange} />
  );
}

const sameRange = (a: ReportDateRange, b: ReportDateRange) =>
  a.preset === b.preset && (a.preset !== 'custom' || (a.from === b.from && a.to === b.to));

const sameIds = (a: string[] | undefined, b: string[] | undefined) =>
  (a ?? []).join(',') === (b ?? []).join(',');

function BuiltinView({
  widget,
  page,
  dashboardRange,
}: {
  widget: BuiltinWidget;
  page: DashboardPage | undefined;
  dashboardRange: ReportDateRange;
}) {
  const updateWidget = useUpdateWidget();
  const saved = widgetDateRange(widget.meta.dateRange, dashboardRange);
  // Exploring here changes nothing on the dashboard until "Save to widget"
  const [range, setRange] = useState(saved.range);
  const [categoryIds, setCategoryIds] = useState(widget.meta.categoryIds);
  const rangeChanged = !sameRange(range, saved.range);
  const changed = rangeChanged || !sameIds(categoryIds, widget.meta.categoryIds);

  function save() {
    const { dateRange, categoryIds: _old, ...rest } = widget.meta;
    // A widget following the dashboard keeps doing so unless its dates were changed here
    const nextRange = rangeChanged ? range : dateRange;
    updateWidget.mutate({
      widget,
      data: {
        meta: {
          ...rest,
          ...(nextRange ? { dateRange: nextRange } : {}),
          ...(categoryIds ? { categoryIds } : {}),
        },
      },
    });
  }

  function followDashboard() {
    const { dateRange: _old, ...rest } = widget.meta;
    updateWidget.mutate({ widget, data: { meta: rest } });
    setRange(dashboardRange);
  }

  const report = BUILTIN_REPORTS[widget.type];
  const dashboardPath = `/reports?dashboard=${widget.pageId}`;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={widget.meta.name || report.label}
        subtitle={report.description}
        breadcrumbs={[
          { label: 'Reports', to: '/reports' },
          { label: page?.name ?? 'Dashboard', to: dashboardPath },
        ]}
        actions={
          <Button
            size="sm"
            disabled={!changed || updateWidget.isPending}
            title="Show these settings on the dashboard widget"
            onClick={save}
          >
            <Save size={13} /> Save to widget
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto bg-page">
        <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-4">
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
            <span className="text-xs font-medium text-text-secondary">Date range</span>
            <DateRangeControl value={range} onChange={setRange} />
            <RangeNote
              source={saved.source}
              dashboardRange={dashboardRange}
              changed={changed}
              onFollowDashboard={
                saved.source !== 'dashboard' && !updateWidget.isPending
                  ? followDashboard
                  : undefined
              }
            />
          </div>
          <ReportDetail
            type={widget.type}
            from={range.from}
            to={range.to}
            categoryIds={categoryIds}
            onCategoryIdsChange={setCategoryIds}
          />
        </div>
      </div>
    </div>
  );
}

/** Where the widget's dates come from, and whether what's shown here differs from it. */
function RangeNote({
  source,
  dashboardRange,
  changed,
  onFollowDashboard,
}: {
  source: 'dashboard' | 'own' | 'frozen';
  dashboardRange: ReportDateRange;
  changed: boolean;
  onFollowDashboard?: () => void;
}) {
  if (changed) {
    return (
      <span className="text-xs text-caution">Not saved: the dashboard widget is unchanged</span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
      {source === 'frozen' && <Snowflake size={11} className="text-brand-500" />}
      {source === 'own' && <Pin size={11} className="text-brand-500" />}
      {source === 'dashboard'
        ? `Following the dashboard (${formatDateRange(dashboardRange)})`
        : source === 'frozen'
          ? 'This widget keeps these dates'
          : 'This widget has its own date range'}
      {onFollowDashboard && (
        <button
          onClick={onFollowDashboard}
          className="text-brand-600 hover:text-brand-700 font-medium cursor-pointer"
        >
          Use dashboard range
        </button>
      )}
    </span>
  );
}
