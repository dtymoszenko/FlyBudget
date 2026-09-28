import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Save, Download } from 'lucide-react';
import ReportBuilderSidebar from '../components/reports/ReportBuilderSidebar';
import ReportChartArea from '../components/reports/ReportChartArea';
import SaveReportModal from '../components/reports/SaveReportModal';
import SavedReportsList from '../components/reports/SavedReportsList';
import {
  useCustomReportData,
  useSavedReport,
  useCreateSavedReport,
  useUpdateSavedReport,
} from '../hooks/useCustomReports';
import { useDebounce } from '../hooks/useDebounce';
import { downloadCsv } from '../utils/exportCsv';
import { computeDateRange, resolveDateRange } from '../utils/dateRange';
import { Button } from '../components/ui/Button';
import type { CustomReportConfig } from '../types';

const defaultConfig = (): CustomReportConfig => ({
  chartType: 'bar',
  mode: 'total',
  groupBy: 'category',
  balanceType: 'expense',
  dateRange: { preset: '6m', ...computeDateRange('6m') },
  filters: { accountIds: [], categoryIds: [], categoryGroupIds: [] },
});

export default function CustomReportBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // The dashboard this report was started from; a new report is added to it on save
  const [searchParams] = useSearchParams();
  const dashboardPageId = searchParams.get('dashboard') ?? undefined;
  const [config, setConfig] = useState<CustomReportConfig>(defaultConfig);
  const [saveOpen, setSaveOpen] = useState(false);
  const [reportName, setReportName] = useState('');

  const { data: savedReport } = useSavedReport(id);
  const createMutation = useCreateSavedReport();
  const updateMutation = useUpdateSavedReport();

  const savedReportId = savedReport?.id;
  const savedReportUpdatedAt = savedReport?.updatedAt;
  useEffect(() => {
    if (savedReport) {
      // Live ranges were computed when the report was saved; bring them up to today
      setConfig({
        ...savedReport.config,
        dateRange: resolveDateRange(savedReport.config.dateRange),
      });
      setReportName(savedReport.name);
    }
  }, [savedReportId, savedReportUpdatedAt]);

  const debouncedConfig = useDebounce(config, 300);
  const { data, isLoading } = useCustomReportData(debouncedConfig);

  function handleSave(name: string) {
    if (id && savedReport) {
      updateMutation.mutate(
        { id, data: { name, config } },
        {
          onSuccess: () => setSaveOpen(false),
        },
      );
    } else {
      createMutation.mutate(
        { name, config, dashboardPageId },
        {
          onSuccess: (saved) => {
            setSaveOpen(false);
            const back = dashboardPageId ? `?dashboard=${dashboardPageId}` : '';
            navigate(`/reports/custom/${saved.id}${back}`, { replace: true });
          },
        },
      );
    }
  }

  function handleExport() {
    if (!data) return;
    const filename = `custom-report-${config.dateRange.from}-${config.dateRange.to}.csv`;
    if (data.mode === 'total') {
      downloadCsv(
        filename,
        data.data.map((d) => ({ name: d.name, amount_cents: d.value })),
      );
    } else {
      downloadCsv(
        filename,
        data.data.map((d) => {
          const row: Record<string, unknown> = { month: d.month };
          for (const g of data.groups) row[g] = d[g] ?? 0;
          return row;
        }),
      );
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border bg-surface flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to={dashboardPageId ? `/reports?dashboard=${dashboardPageId}` : '/reports'}
            className="text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <ArrowLeft size={16} />
          </Link>
          <h1 className="text-lg font-semibold text-text">{reportName || 'Custom Report'}</h1>
          <SavedReportsList activeId={id} />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleExport} disabled={!data}>
            <Download size={13} /> Export
          </Button>
          <Button size="sm" onClick={() => setSaveOpen(true)}>
            <Save size={13} /> {id ? 'Update' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <ReportBuilderSidebar config={config} onChange={setConfig} />
        <div className="flex-1 p-6 overflow-auto bg-page">
          <div className="h-[500px]" key={id ?? 'new'}>
            <ReportChartArea config={config} data={data} isLoading={isLoading} />
          </div>
        </div>
      </div>

      <SaveReportModal
        isOpen={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={handleSave}
        initialName={reportName}
        isUpdating={!!id}
      />
    </div>
  );
}
