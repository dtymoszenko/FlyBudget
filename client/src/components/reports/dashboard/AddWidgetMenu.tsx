import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Plus } from 'lucide-react';
import { Button } from '../../ui/Button';
import { BUILTIN_REPORTS, BUILTIN_TYPES } from '../BuiltinReport';
import { useAddWidget } from '../../../hooks/useDashboards';
import { computeDateRange } from '../../../utils/dateRange';
import type { SavedCustomReport } from '../../../types';

const ITEM = 'w-full text-left px-3 py-2 hover:bg-hover transition-colors cursor-pointer';

export default function AddWidgetMenu({
  pageId,
  reports,
}: {
  pageId: string;
  reports: SavedCustomReport[];
}) {
  const navigate = useNavigate();
  const addWidget = useAddWidget();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function add(data: Parameters<typeof addWidget.mutate>[0]['data']) {
    addWidget.mutate({ pageId, data });
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(!open)}>
        <Plus size={13} /> Add widget <ChevronDown size={12} />
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 max-h-[70vh] overflow-y-auto bg-surface rounded-md border border-border shadow-hover z-30 py-1">
          <p className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            Reports
          </p>
          {BUILTIN_TYPES.map((type) => (
            <button
              key={type}
              className={ITEM}
              onClick={() =>
                add({ type, meta: { dateRange: { preset: '6m', ...computeDateRange('6m') } } })
              }
            >
              <p className="text-sm text-text">{BUILTIN_REPORTS[type].label}</p>
              <p className="text-xs text-text-tertiary">{BUILTIN_REPORTS[type].description}</p>
            </button>
          ))}
          <div className="border-t border-border-light my-1" />
          <p className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            Custom reports
          </p>
          <button
            className={`${ITEM} text-sm text-brand-600 font-medium`}
            onClick={() => navigate(`/reports/custom?dashboard=${pageId}`)}
          >
            New custom report…
          </button>
          {reports.map((r) => (
            <button
              key={r.id}
              className={`${ITEM} text-sm text-text truncate`}
              onClick={() => add({ type: 'custom-report', customReportId: r.id })}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
