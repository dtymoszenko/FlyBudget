import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format, parseISO } from 'date-fns';
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMonth } from '../../utils/dateRange';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Earliest year the arrows go back to ("All" starts in 2020) */
const MIN_YEAR = 2000;
const GAP = 6;
const EDGE = 8;

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
const rangeLabel = (from: string, to: string) =>
  from === to ? formatMonth(from) : `${formatMonth(from)} – ${formatMonth(to)}`;

/**
 * Below the button when it fits, else above; if neither fits (tall on a phone), as close to the
 * button as it can be while staying on screen
 */
function placeNear(anchor: DOMRect, width: number, height: number) {
  const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - width - EDGE));
  const lowest = Math.max(EDGE, window.innerHeight - height - EDGE);
  if (anchor.top - GAP - height >= EDGE && anchor.bottom + GAP + height > window.innerHeight - EDGE)
    return { top: anchor.top - GAP - height, left };
  return { top: Math.min(anchor.bottom + GAP, lowest), left };
}

function MonthGrid({
  title,
  value,
  onPick,
  isDisabled,
}: {
  title: string;
  value: string;
  onPick: (v: string) => void;
  isDisabled: (v: string) => boolean;
}) {
  const [year, setYear] = useState(() => Math.max(MIN_YEAR, parseInt(value.slice(0, 4), 10) || 0));
  const navBtn =
    'p-1 max-md:min-w-11 max-md:min-h-11 flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div role="group" aria-label={title} className="w-[196px]">
      <p className="text-xs font-medium text-text-tertiary mb-2">{title}</p>
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          className={navBtn}
          disabled={year <= MIN_YEAR}
          onClick={() => setYear(year - 1)}
          aria-label="Previous year"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-sm font-semibold text-text tabular-nums">{year}</span>
        <button
          type="button"
          className={navBtn}
          onClick={() => setYear(year + 1)}
          aria-label="Next year"
        >
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
              aria-pressed={selected}
              aria-label={format(parseISO(`${v}-01`), 'MMMM yyyy')}
              onClick={() => onPick(v)}
              className={`py-1.5 max-md:min-h-11 text-xs font-medium rounded-md transition-colors ${
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

/**
 * Compact "Jan 2025 – Dec 2025" button with a from/to month-grid popover. The popover is
 * portaled to the body so a sidebar, scroll area or dialog can't cut it off.
 */
export function MonthRangePicker({
  from,
  to,
  onChange,
  max = format(new Date(), 'yyyy-MM'),
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  // Picks are a draft until Done; closing any other way discards them
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const dirty = draftFrom !== from || draftTo !== to;

  // The draft starts from the saved months each time it opens
  function openPicker() {
    setDraftFrom(from);
    setDraftTo(to);
    setOpen(true);
  }

  function close(refocus = false) {
    setOpen(false);
    setPos(null);
    if (refocus) triggerRef.current?.focus();
  }

  function apply() {
    if (dirty) onChange(draftFrom, draftTo);
    close(true);
  }

  // Measured before paint, so it never flashes in the wrong place
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!triggerRef.current || !popRef.current) return;
      const { offsetWidth, offsetHeight } = popRef.current;
      setPos(placeNear(triggerRef.current.getBoundingClientRect(), offsetWidth, offsetHeight));
    }
    place();
    const onScroll = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Keyboard users start on the selected From month (once it's placed: hidden can't take focus)
  const placed = pos !== null;
  useEffect(() => {
    if (open && placed) {
      popRef.current
        ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?.focus({ preventScroll: true });
    }
  }, [open, placed]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The button toggles the popover itself
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    // Captured first, so Escape closes only the picker and not a dialog it's in
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close(true);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openPicker())}
        className={`flex items-center gap-1.5 px-2.5 py-1 max-md:min-h-11 text-xs font-medium border rounded-md transition-colors cursor-pointer ${
          open
            ? 'border-brand-600 text-brand-600'
            : 'border-border text-text-secondary hover:bg-hover'
        }`}
      >
        <CalendarRange size={13} />
        <span className="tabular-nums whitespace-nowrap">{rangeLabel(from, to)}</span>
        <ChevronDown size={12} className="text-text-tertiary" />
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="Choose months"
            className="fixed z-[60] max-h-[calc(100dvh-16px)] overflow-y-auto bg-surface border border-border rounded-lg shadow-hover p-4 animate-menu-in"
            style={pos ?? { top: 0, left: 0, visibility: 'hidden' }}
          >
            <div className="flex gap-5 max-md:flex-col max-md:gap-3">
              <MonthGrid
                title="From"
                value={draftFrom}
                onPick={(v) => {
                  setDraftFrom(v);
                  if (v > draftTo) setDraftTo(v);
                }}
                isDisabled={(v) => v > max}
              />
              <div className="w-px max-md:w-auto max-md:h-px bg-border-light" />
              <MonthGrid
                title="To"
                value={draftTo}
                onPick={setDraftTo}
                isDisabled={(v) => v < draftFrom || v > max}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-border-light">
              <span className="text-xs text-text-tertiary tabular-nums">
                {rangeLabel(draftFrom, draftTo)}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => close(true)}
                  className="px-3 py-1 max-md:min-h-11 max-md:min-w-11 text-xs font-medium text-text-secondary border border-border rounded-md hover:bg-hover transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={apply}
                  className="px-3 py-1 max-md:min-h-11 max-md:min-w-11 text-xs font-medium text-white bg-brand-600 rounded-md hover:bg-brand-700 transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
