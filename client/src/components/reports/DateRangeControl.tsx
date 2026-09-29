import { Snowflake } from 'lucide-react';
import { DATE_PRESETS, computeDateRange, resolveDateRange } from '../../utils/dateRange';
import type { ReportDateRange } from '../../types';

const MONTH_INPUT =
  'rounded-md border border-border text-xs py-1 px-2 bg-surface text-text focus:border-brand-600 focus:outline-none';

/**
 * Live presets plus a "Frozen" option with fixed months. Switching to Frozen keeps the months
 * the range covers today, so freezing never changes what the report shows.
 */
export function DateRangeControl({
  value,
  onChange,
}: {
  value: ReportDateRange;
  onChange: (range: ReportDateRange) => void;
}) {
  const frozen = value.preset === 'custom';

  function setMonth(end: 'from' | 'to', month: string) {
    if (!month) return;
    const next = { ...value, [end]: month };
    if (next.from > next.to) {
      if (end === 'from') next.to = month;
      else next.from = month;
    }
    onChange(next);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-0">
        {DATE_PRESETS.filter((p) => p.id !== 'custom').map((p) => (
          <button
            type="button"
            key={p.id}
            title={p.long}
            aria-pressed={value.preset === p.id}
            onClick={() => onChange({ preset: p.id, ...computeDateRange(p.id) })}
            className={`px-2.5 py-1 text-xs font-medium transition-colors border-b-2 cursor-pointer ${
              value.preset === p.id
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={frozen}
          title="Keep these dates fixed instead of moving with the current month"
          onClick={() => !frozen && onChange({ ...resolveDateRange(value), preset: 'custom' })}
          className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors border-b-2 cursor-pointer ${
            frozen
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-text-tertiary hover:text-text-secondary'
          }`}
        >
          <Snowflake size={11} /> Frozen
        </button>
      </div>
      {frozen && (
        <div className="flex items-center gap-1.5">
          <input
            type="month"
            aria-label="From month"
            value={value.from}
            onChange={(e) => setMonth('from', e.target.value)}
            className={MONTH_INPUT}
          />
          <span className="text-xs text-text-tertiary">to</span>
          <input
            type="month"
            aria-label="To month"
            value={value.to}
            onChange={(e) => setMonth('to', e.target.value)}
            className={MONTH_INPUT}
          />
        </div>
      )}
    </div>
  );
}
