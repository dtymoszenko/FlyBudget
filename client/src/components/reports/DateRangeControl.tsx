import { useState } from 'react';
import { Snowflake } from 'lucide-react';
import { MonthRangePicker } from '../ui/MonthRangePicker';
import { DATE_PRESETS, computeDateRange, resolveDateRange } from '../../utils/dateRange';
import type { ReportDateRange } from '../../types';

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
  // Open the month picker right after freezing, not when a range loads already frozen
  const [justFroze, setJustFroze] = useState(false);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-0">
        {DATE_PRESETS.filter((p) => p.id !== 'custom').map((p) => (
          <button
            type="button"
            key={p.id}
            title={p.long}
            aria-pressed={value.preset === p.id}
            onClick={() => {
              setJustFroze(false);
              onChange({ preset: p.id, ...computeDateRange(p.id) });
            }}
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
          onClick={() => {
            if (frozen) return;
            setJustFroze(true);
            onChange({ ...resolveDateRange(value), preset: 'custom' });
          }}
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
        <MonthRangePicker
          from={value.from}
          to={value.to}
          onChange={(from, to) => onChange({ preset: 'custom', from, to })}
          defaultOpen={justFroze}
        />
      )}
    </div>
  );
}
