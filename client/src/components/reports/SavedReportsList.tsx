import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useSavedReports, useDeleteSavedReport } from '../../hooks/useCustomReports';

interface Props {
  activeId?: string;
}

export default function SavedReportsList({ activeId }: Props) {
  const { t } = useTranslation();
  const { data: reports = [] } = useSavedReports();
  const deleteMutation = useDeleteSavedReport();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (reports.length === 0) return null;

  const activeReport = reports.find((r) => r.id === activeId);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary bg-surface border border-border rounded-md hover:bg-surface-alt transition-colors"
      >
        {activeReport ? activeReport.name : t('reports.saved.list')}
        <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-surface rounded-md border border-border shadow-hover z-20 py-1">
          {reports.map((r) => (
            <div
              key={r.id}
              className={`flex items-center justify-between px-3 py-2 hover:bg-hover cursor-pointer group ${r.id === activeId ? 'bg-brand-50' : ''}`}
            >
              <button
                onClick={() => {
                  navigate(`/reports/custom/${r.id}`);
                  setOpen(false);
                }}
                className="flex-1 text-left text-sm text-text-secondary truncate"
              >
                {r.name}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteMutation.mutate(r.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 text-text-tertiary hover:text-negative transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
