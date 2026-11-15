import { BarChart3, LineChart, AreaChart, PieChart, Table2, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChartType, ReportMode } from '../../types';

const CHART_TYPES: {
  id: ChartType;
  /** Its name in reports.chartType.types (a key can't have a dash) */
  labelKey: 'bar' | 'stackedBar' | 'line' | 'area' | 'donut' | 'table';
  icon: typeof BarChart3;
  modes: ReportMode[];
}[] = [
  { id: 'bar', labelKey: 'bar', icon: BarChart3, modes: ['total', 'time'] },
  { id: 'stacked-bar', labelKey: 'stackedBar', icon: Layers, modes: ['time'] },
  { id: 'line', labelKey: 'line', icon: LineChart, modes: ['total', 'time'] },
  { id: 'area', labelKey: 'area', icon: AreaChart, modes: ['total', 'time'] },
  { id: 'donut', labelKey: 'donut', icon: PieChart, modes: ['total'] },
  { id: 'table', labelKey: 'table', icon: Table2, modes: ['total', 'time'] },
];

interface Props {
  value: ChartType;
  mode: ReportMode;
  onChange: (type: ChartType) => void;
}

export default function ChartTypeSelector({ value, mode, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1">
      {CHART_TYPES.map((c) => {
        const disabled = !c.modes.includes(mode);
        const active = c.id === value;
        const label = t(`reports.chartType.types.${c.labelKey}`);
        // With two modes, a chart that can't be used in this one only works in the other
        const title = disabled
          ? t(`reports.chartType.onlyIn.${c.modes[0]}`, { chart: label })
          : label;
        return (
          <button
            key={c.id}
            disabled={disabled}
            onClick={() => onChange(c.id)}
            title={title}
            className={`flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
              active
                ? 'bg-brand-50 text-brand-700 border border-brand-200'
                : disabled
                  ? 'text-text-disabled cursor-not-allowed'
                  : 'text-text-secondary hover:bg-hover border border-transparent'
            }`}
          >
            <c.icon className="w-3.5 h-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
