import { useEffect, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Props {
  /** 'yyyy-MM' */
  from: string;
  /** 'yyyy-MM' */
  to: string;
  onChange: (from: string, to: string) => void;
  /** Latest selectable month, 'yyyy-MM' (defaults to the current month) */
  max?: string;
  /** Open the popover on mount, e.g. right after choosing the "Custom" preset */
  defaultOpen?: boolean;
}

const ym = (year: number, monthIdx: number) => `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
const label = (v: string) => format(parseISO(`${v}-01`), 'MMM yyyy');

function MonthGrid({ title, value, onPick, isDisabled }: {
  title: string;
  value: string;
  onPick: (v: string) => void;
  isDisabled: (v: string) => boolean;
}) {
  const [year, setYear] = useState(() => parseInt(value.slice(0, 4), 10));
  const navBtn = 'p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer';

  return (
    <div className="w-[196px]">
      <p className="text-xs font-medium text-text-tertiary mb-2">{title}</p>
      <div className="flex items-center justify-between mb-2">
        <button type="button" className={navBtn} onClick={() => setYear(year - 1)} aria-label="Previous year">
          <ChevronLeft size={14} />
        </button>
        <span className="text-sm font-semibold text-text tabular-nums">{year}</span>
        <button type="button" className={navBtn} onClick={() => setYear(year + 1)} aria-label="Next year">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTHS.map((m, i) => {
          const v = ym(year, i);
          const selected = v === value;
          const disabled = isDisabled(v);
          return (
            <button
              key={m}
              type="button"
              disabled={disabled}
              onClick={() => onPick(v)}
              className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                selected
                  ? 'bg-brand-600 text-white'
                  : disabled
                    ? 'text-text-disabled cursor-not-allowed'
                    : 'text-text-secondary hover:bg-hover cursor-pointer'
              }`}
            >
              {m}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Compact "Jan 2025 – Dec 2025" button with a from/to month-grid popover. */
export function MonthRangePicker({ from, to, onChange, max = format(new Date(), 'yyyy-MM'), defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  // Picks are a draft until Done; closing any other way discards them
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setDraftFrom(from); setDraftTo(to); }
  }, [open, from, to]);

  const dirty = draftFrom !== from || draftTo !== to;

  function apply() {
    if (dirty) onChange(draftFrom, draftTo);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-md transition-colors cursor-pointer ${
          open ? 'border-brand-600 text-brand-600' : 'border-border text-text-secondary hover:bg-hover'
        }`}
      >
        <CalendarRange size={13} />
        <span className="tabular-nums whitespace-nowrap">
          {from === to ? label(from) : `${label(from)} – ${label(to)}`}
        </span>
        <ChevronDown size={12} className="text-text-tertiary" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-surface border border-border rounded-lg shadow-hover p-4 origin-top-right animate-menu-in">
          <div className="flex gap-5">
            <MonthGrid
              title="From"
              value={draftFrom}
              onPick={(v) => { setDraftFrom(v); if (v > draftTo) setDraftTo(v); }}
              isDisabled={(v) => v > max}
            />
            <div className="w-px bg-border-light" />
            <MonthGrid
              title="To"
              value={draftTo}
              onPick={setDraftTo}
              isDisabled={(v) => v < draftFrom || v > max}
            />
          </div>
          <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-border-light">
            <span className="text-xs text-text-tertiary tabular-nums">
              {draftFrom === draftTo ? label(draftFrom) : `${label(draftFrom)} – ${label(draftTo)}`}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1 text-xs font-medium text-text-secondary border border-border rounded-md hover:bg-hover transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="px-3 py-1 text-xs font-medium text-white bg-brand-600 rounded-md hover:bg-brand-700 transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
