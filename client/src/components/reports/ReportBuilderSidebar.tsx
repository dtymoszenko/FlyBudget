import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computeDateRange, DATE_PRESETS } from '../../utils/dateRange';
import { MonthRangePicker } from '../ui/MonthRangePicker';
import ChartTypeSelector from './ChartTypeSelector';
import AccountMultiSelect from './AccountMultiSelect';
import CategoryTreePicker from './CategoryTreePicker';
import type {
  CustomReportConfig,
  ReportMode,
  ReportGroupBy,
  BalanceType,
  DatePresetCustom,
} from '../../types';

interface Props {
  config: CustomReportConfig;
  onChange: (config: CustomReportConfig) => void;
}

const MODE_OPTIONS: { id: ReportMode }[] = [{ id: 'total' }, { id: 'time' }];

const GROUP_BY_OPTIONS: { id: ReportGroupBy; modes: ReportMode[] }[] = [
  { id: 'category', modes: ['total', 'time'] },
  { id: 'categoryGroup', modes: ['total', 'time'] },
  { id: 'payee', modes: ['total', 'time'] },
  { id: 'account', modes: ['total', 'time'] },
  { id: 'month', modes: ['total'] },
];

const BALANCE_OPTIONS: { id: BalanceType }[] = [{ id: 'expense' }, { id: 'income' }, { id: 'net' }];

function set<K extends keyof CustomReportConfig>(
  config: CustomReportConfig,
  key: K,
  value: CustomReportConfig[K],
): CustomReportConfig {
  return { ...config, [key]: value };
}

export default function ReportBuilderSidebar({ config, onChange }: Props) {
  const { t } = useTranslation();
  // Open the month picker right after choosing Custom, not when a saved report loads with it
  const [justChoseCustom, setJustChoseCustom] = useState(false);

  function handleModeChange(mode: ReportMode) {
    let next = set(config, 'mode', mode);
    const validGroups = GROUP_BY_OPTIONS.filter((g) => g.modes.includes(mode));
    if (!validGroups.find((g) => g.id === next.groupBy)) {
      next = set(next, 'groupBy', validGroups[0].id);
    }
    if (mode === 'time' && next.chartType === 'donut') {
      next = set(next, 'chartType', 'bar');
    }
    if (mode === 'total' && next.chartType === 'stacked-bar') {
      next = set(next, 'chartType', 'bar');
    }
    onChange(next);
  }

  function handlePresetChange(preset: DatePresetCustom) {
    setJustChoseCustom(preset === 'custom');
    if (preset === 'custom') {
      onChange(set(config, 'dateRange', { ...config.dateRange, preset: 'custom' }));
    } else {
      const range = computeDateRange(preset);
      onChange(set(config, 'dateRange', { preset, ...range }));
    }
  }

  return (
    <div className="w-72 max-md:w-full shrink-0 bg-surface border-r max-md:border-r-0 max-md:border-t border-border overflow-y-auto max-md:overflow-visible p-4 space-y-5">
      <Section label={t('reports.builder.sections.chartType')}>
        <ChartTypeSelector
          value={config.chartType}
          mode={config.mode}
          onChange={(ct) => onChange(set(config, 'chartType', ct))}
        />
      </Section>

      <Section label={t('reports.builder.sections.mode')}>
        <div className="flex gap-1">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m.id}
              onClick={() => handleModeChange(m.id)}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                config.mode === m.id
                  ? 'bg-brand-50 text-brand-700 border border-brand-200'
                  : 'text-text-secondary hover:bg-hover border border-transparent'
              }`}
            >
              {t(`reports.builder.modes.${m.id}`)}
            </button>
          ))}
        </div>
      </Section>

      <Section label={t('reports.builder.sections.groupBy')}>
        <select
          aria-label={t('reports.builder.groupByLabel')}
          value={config.groupBy}
          onChange={(e) => onChange(set(config, 'groupBy', e.target.value as ReportGroupBy))}
          className="w-full rounded-md border border-border text-sm py-1.5 px-2 bg-surface text-text focus:border-brand-600 focus:ring-1 focus:ring-brand-600 focus:outline-none"
        >
          {GROUP_BY_OPTIONS.filter((g) => g.modes.includes(config.mode)).map((g) => (
            <option key={g.id} value={g.id}>
              {t(`reports.builder.groupBy.${g.id}`)}
            </option>
          ))}
        </select>
      </Section>

      <Section label={t('reports.builder.sections.balanceType')}>
        <div className="flex gap-1">
          {BALANCE_OPTIONS.map((b) => (
            <button
              key={b.id}
              onClick={() => onChange(set(config, 'balanceType', b.id))}
              className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                config.balanceType === b.id
                  ? 'bg-brand-50 text-brand-700 border border-brand-200'
                  : 'text-text-secondary hover:bg-hover border border-transparent'
              }`}
            >
              {t(`reports.builder.balanceTypes.${b.id}`)}
            </button>
          ))}
        </div>
      </Section>

      <Section label={t('reports.builder.sections.dateRange')}>
        <div className="flex flex-wrap gap-1 mb-2">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => handlePresetChange(p.id)}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                config.dateRange.preset === p.id
                  ? 'bg-brand-50 text-brand-700 border border-brand-200'
                  : 'text-text-secondary hover:bg-hover border border-transparent'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {config.dateRange.preset === 'custom' && (
          <MonthRangePicker
            from={config.dateRange.from}
            to={config.dateRange.to}
            onChange={(from, to) =>
              onChange(set(config, 'dateRange', { preset: 'custom', from, to }))
            }
            defaultOpen={justChoseCustom}
          />
        )}
        <p className="text-[11px] text-text-tertiary mt-1.5">
          {config.dateRange.preset === 'custom'
            ? t('reports.builder.frozen')
            : t('reports.builder.live')}
        </p>
      </Section>

      <Section label={t('reports.builder.sections.accounts')}>
        <AccountMultiSelect
          selected={config.filters.accountIds}
          onChange={(ids) =>
            onChange(set(config, 'filters', { ...config.filters, accountIds: ids }))
          }
        />
      </Section>

      <Section label={t('reports.builder.sections.categories')}>
        <CategoryTreePicker
          selectedCategoryIds={config.filters.categoryIds}
          selectedGroupIds={config.filters.categoryGroupIds}
          onChange={(categoryIds, categoryGroupIds) =>
            onChange(set(config, 'filters', { ...config.filters, categoryIds, categoryGroupIds }))
          }
        />
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-tertiary mb-2">{label}</p>
      {children}
    </div>
  );
}
