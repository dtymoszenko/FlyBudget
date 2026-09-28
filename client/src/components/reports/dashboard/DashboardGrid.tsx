import { useMemo } from 'react';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import WidgetCard, { NO_DRAG_CLASS } from './WidgetCard';
import { useSaveLayout } from '../../../hooks/useDashboards';
import type {
  DashboardPage,
  DashboardWidget,
  ReportDateRange,
  SavedCustomReport,
} from '../../../types';

const COLS = 12;
const ROW_HEIGHT = 80;
const MARGIN: [number, number] = [16, 16];
// Below this width the grid collapses to one column and layout editing is off
const MOBILE_WIDTH = 768;

const MIN_SIZE: Record<DashboardWidget['type'], { minW: number; minH: number }> = {
  summary: { minW: 4, minH: 2 },
  'net-worth': { minW: 3, minH: 3 },
  'income-expenses': { minW: 3, minH: 3 },
  spending: { minW: 3, minH: 3 },
  'spending-trends': { minW: 3, minH: 3 },
  'custom-report': { minW: 3, minH: 3 },
};

interface Props {
  pageId: string;
  widgets: DashboardWidget[];
  reports: SavedCustomReport[];
  pages: DashboardPage[];
  dashboardRange: ReportDateRange;
  editing: boolean;
}

export default function DashboardGrid({
  pageId,
  widgets,
  reports,
  pages,
  dashboardRange,
  editing,
}: Props) {
  const { width, containerRef, mounted } = useContainerWidth();
  const saveLayout = useSaveLayout();
  const mobile = width < MOBILE_WIDTH;
  const reportsById = useMemo(() => new Map(reports.map((r) => [r.id, r])), [reports]);

  const layout = useMemo<Layout>(
    () =>
      mobile
        ? // Stack in reading order, keeping each widget's height
          [...widgets]
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((w, i) => ({ i: w.id, x: 0, y: i * 100, w: 1, h: w.height }))
        : widgets.map((w) => ({
            i: w.id,
            x: w.x,
            y: w.y,
            w: w.width,
            h: w.height,
            ...MIN_SIZE[w.type],
          })),
    [widgets, mobile],
  );

  function persist(next: Layout) {
    const byId = new Map(widgets.map((w) => [w.id, w]));
    const changed = next
      .filter((l) => {
        const w = byId.get(l.i);
        return w && (w.x !== l.x || w.y !== l.y || w.width !== l.w || w.height !== l.h);
      })
      .map((l) => ({ id: l.i, x: l.x, y: l.y, width: l.w, height: l.h }));
    if (changed.length) saveLayout.mutate({ pageId, items: changed });
  }

  const canEdit = editing && !mobile;

  return (
    <div ref={containerRef}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: mobile ? 1 : COLS,
            rowHeight: ROW_HEIGHT,
            margin: MARGIN,
            containerPadding: [0, 0],
          }}
          dragConfig={{ enabled: canEdit, cancel: `.${NO_DRAG_CLASS}` }}
          resizeConfig={{ enabled: canEdit, handles: ['se'] }}
          onDragStop={persist}
          onResizeStop={persist}
        >
          {widgets.map((w) => (
            <div key={w.id}>
              <WidgetCard
                widget={w}
                report={w.customReportId ? reportsById.get(w.customReportId) : undefined}
                pages={pages}
                dashboardRange={dashboardRange}
                editing={canEdit}
              />
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}
