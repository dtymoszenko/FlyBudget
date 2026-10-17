import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useDailyFlow } from '../../hooks/useReports';
import { formatCentsAxis, formatCurrency } from '../../utils/currency';
import { monthCount, monthsBetween } from '../../utils/dateRange';
import {
  CALENDAR_MONTHS_MAX,
  HEATMAP_ROW_MONTHS,
  barShare,
  heatmapRows,
  monthWeeks,
  quantileLevels,
} from '../../utils/calendarLayout';
import type { HeatmapRow } from '../../utils/calendarLayout';
import { ChartSkeleton, TOOLTIP_CLASS } from './ChartHelpers';
import type { DailyFlowPoint } from '../../types';

// Money in and out on each day. Up to CALENDAR_MONTHS_MAX months show as month grids, each
// day with a green bar (money in, from the left) and a red one (money out, from the right).
// Longer ranges show as a heatmap, a square per day colored by that day's net.

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// Heatmap intensity per level (1-4), as a share of the positive/negative color
const LEVEL_MIX = [0, 28, 48, 72, 100];
const mix = (color: 'positive' | 'negative', pct: number) =>
  `color-mix(in srgb, var(--color-${color}) ${pct}%, transparent)`;

const EMPTY: DailyFlowPoint = { date: '', income: 0, expenses: 0, count: 0 };

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}

interface Props {
  from: string;
  to: string;
  /** Shrink to fit the container's height (the dashboard widget); otherwise size by width */
  fit?: boolean;
  selected?: string | null;
  /** Makes days clickable */
  onSelect?: (day: string) => void;
}

interface Hover {
  day: string;
  x: number;
  /** The hovered cell's top and bottom, relative to the grid container */
  y: number;
  bottom: number;
}

export function TransactionCalendar({ from, to, fit, selected, onSelect }: Props) {
  const { data = [], isLoading } = useDailyFlow(from, to);
  const { ref, width, height } = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Hover | null>(null);
  const byDay = useMemo(() => new Map(data.map((d) => [d.date, d])), [data]);
  const totals = useMemo(
    () => ({
      income: data.reduce((s, d) => s + d.income, 0),
      expenses: data.reduce((s, d) => s + d.expenses, 0),
    }),
    [data],
  );
  const today = format(new Date(), 'yyyy-MM-dd');
  const heatmap = monthCount(from, to) > CALENDAR_MONTHS_MAX;

  function showTooltip(day: string, el: HTMLElement) {
    const box = ref.current?.getBoundingClientRect();
    const cell = el.getBoundingClientRect();
    if (box)
      setHover({
        day,
        x: cell.left + cell.width / 2 - box.left,
        y: cell.top - box.top,
        bottom: cell.bottom - box.top,
      });
  }

  const dayProps = (day: string) => {
    const flow = byDay.get(day) ?? EMPTY;
    const label = `${format(parseISO(day), 'EEEE, MMMM d')}: ${formatCurrency(flow.income)} in, ${formatCurrency(flow.expenses)} out`;
    return {
      onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showTooltip(day, e.currentTarget),
      onMouseLeave: () => setHover(null),
      ...(onSelect
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': label,
            'aria-pressed': selected === day,
            onClick: () => onSelect(day),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(day);
              }
            },
          }
        : { 'aria-label': label }),
    };
  };

  return (
    <div className={`relative w-full flex flex-col ${fit ? 'h-full' : ''}`}>
      <div className="flex items-center justify-end gap-3 flex-wrap text-xs tabular-nums shrink-0 pb-2">
        {heatmap && <HeatmapLegend />}
        <span className="inline-flex items-center gap-0.5 text-positive">
          <ArrowUp size={12} /> {formatCurrency(totals.income)}
        </span>
        <span className="inline-flex items-center gap-0.5 text-negative">
          <ArrowDown size={12} /> {formatCurrency(totals.expenses)}
        </span>
      </div>
      <div ref={ref} className={`relative ${fit ? 'flex-1 min-h-0' : ''}`}>
        {isLoading ? (
          <div className="h-48">
            <ChartSkeleton />
          </div>
        ) : width === 0 ? null : heatmap ? (
          <Heatmap
            from={from}
            to={to}
            width={width}
            height={fit ? height : undefined}
            byDay={byDay}
            today={today}
            selected={selected}
            dayProps={dayProps}
          />
        ) : (
          <MonthGrids
            months={monthsBetween(from, to)}
            width={width}
            height={fit ? height : undefined}
            byDay={byDay}
            today={today}
            selected={selected}
            dayProps={dayProps}
          />
        )}
        {hover && (
          <DayTooltip hover={hover} flow={byDay.get(hover.day)} width={width} height={height} />
        )}
      </div>
    </div>
  );
}

type DayProps = (day: string) => React.HTMLAttributes<HTMLElement>;

interface GridProps {
  byDay: Map<string, DailyFlowPoint>;
  today: string;
  selected?: string | null;
  dayProps: DayProps;
}

function MonthGrids({
  months,
  width,
  height,
  byDay,
  today,
  selected,
  dayProps,
}: GridProps & { months: string[]; width: number; height?: number }) {
  const gap = 16;
  const cellGap = 4;
  // Month name and weekday letters above each grid
  const header = 38;
  const max = useMemo(() => {
    let m = 0;
    for (const d of byDay.values()) m = Math.max(m, d.income, d.expenses);
    return m;
  }, [byDay]);

  const cellWidthAt = (cols: number) => ((width - (cols - 1) * gap) / cols - 6 * cellGap) / 7;
  let cols: number;
  let rowHeight: number;
  if (height !== undefined) {
    // Fit the widget: pick the column count giving the biggest cells, which stay near square
    const fitAt = (c: number) => {
      const rows = Math.ceil(months.length / c);
      const perMonth = (height - (rows - 1) * gap) / rows - header;
      return Math.min(cellWidthAt(c), (perMonth - 5 * cellGap) / 6);
    };
    cols = 1;
    for (let c = 2; c <= months.length; c++) if (fitAt(c) > fitAt(cols)) cols = c;
    rowHeight = Math.max(12, Math.floor(fitAt(cols)));
  } else {
    // Full view: months side by side while each gets enough room, else wrapped
    cols = Math.max(1, Math.min(months.length, Math.floor((width + gap) / (210 + gap))));
    rowHeight = cellWidthAt(cols) >= 64 ? 56 : 40;
  }
  // Room for the amounts under the day number in the full view
  const showAmounts = height === undefined && cellWidthAt(cols) >= 64;
  // Cells no wider than 1.6x their height, so a short widget doesn't draw flat strips
  const monthWidth =
    height !== undefined
      ? Math.min((width - (cols - 1) * gap) / cols, 7 * rowHeight * 1.6 + 6 * cellGap)
      : undefined;

  return (
    <div
      className={`grid justify-center ${height !== undefined ? 'h-full content-center' : ''}`}
      style={{
        gap,
        gridTemplateColumns: `repeat(${cols}, ${monthWidth ? `${monthWidth}px` : 'minmax(0, 1fr)'})`,
      }}
    >
      {months.map((month) => {
        const weeks = monthWeeks(month);
        return (
          <div key={month} className="flex flex-col min-h-0">
            <p className="text-xs font-medium text-text-secondary pb-1 shrink-0">
              {format(parseISO(`${month}-01`), 'MMMM yyyy')}
            </p>
            <div className="grid grid-cols-7 gap-1 shrink-0 pb-1">
              {WEEKDAYS.map((d, i) => (
                <span key={i} className="text-center text-[10px] font-medium text-text-tertiary">
                  {d}
                </span>
              ))}
            </div>
            <div
              className="grid grid-cols-7 gap-1"
              style={{ gridTemplateRows: `repeat(${weeks.length}, ${rowHeight}px)` }}
            >
              {weeks
                .flat()
                .map((day, i) =>
                  day ? (
                    <DayCell
                      key={day}
                      day={day}
                      flow={byDay.get(day)}
                      max={max}
                      today={today}
                      selected={selected === day}
                      showAmounts={showAmounts}
                      {...dayProps(day)}
                    />
                  ) : (
                    <span key={`blank-${i}`} />
                  ),
                )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayCell({
  day,
  flow,
  max,
  today,
  selected,
  showAmounts,
  ...rest
}: {
  day: string;
  flow?: DailyFlowPoint;
  max: number;
  today: string;
  selected: boolean;
  showAmounts: boolean;
} & React.HTMLAttributes<HTMLElement>) {
  const income = flow?.income ?? 0;
  const expenses = flow?.expenses ?? 0;
  const future = day > today;
  return (
    <div
      {...rest}
      className={`relative rounded-md overflow-hidden bg-surface-alt min-h-0 transition-shadow ${
        rest.onClick
          ? 'cursor-pointer hover:ring-1 hover:ring-border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
          : ''
      } ${selected ? 'ring-2 ring-brand-500' : day === today ? 'ring-1 ring-brand-500' : ''}`}
    >
      <span
        className="absolute inset-y-0 left-0"
        style={{ width: `${barShare(income, max) * 50}%`, background: mix('positive', 45) }}
      />
      <span
        className="absolute inset-y-0 right-0"
        style={{ width: `${barShare(expenses, max) * 50}%`, background: mix('negative', 45) }}
      />
      <span
        className={`relative flex h-full ${showAmounts ? 'flex-col justify-between p-1.5' : 'items-center justify-center'}`}
      >
        <span
          className={`text-[11px] tabular-nums ${future ? 'text-text-disabled' : 'text-text'} ${
            day === today ? 'font-semibold' : ''
          }`}
        >
          {Number(day.slice(8))}
        </span>
        {showAmounts && (income > 0 || expenses > 0) && (
          <span className="flex flex-col items-end text-[10px] leading-tight tabular-nums">
            {income > 0 && <span className="text-positive">+{formatCentsAxis(income)}</span>}
            {expenses > 0 && <span className="text-negative">−{formatCentsAxis(expenses)}</span>}
          </span>
        )}
      </span>
    </div>
  );
}

function Heatmap({
  from,
  to,
  width,
  height,
  byDay,
  today,
  selected,
  dayProps,
}: GridProps & { from: string; to: string; width: number; height?: number }) {
  const labelWidth = 22;
  const monthLabel = 16;
  const rowGap = 12;
  // Start at the first month with transactions, so "All time" isn't mostly empty years
  const first = useMemo(() => {
    let min: string | undefined;
    for (const day of byDay.keys()) if (!min || day < min) min = day;
    return min && min.slice(0, 7) > from ? min.slice(0, 7) : from;
  }, [byDay, from]);

  // Distance from one square to the next. The full view uses a year per row; the widget
  // tries every row length and keeps the one with the biggest squares that fit
  const { rows, step } = useMemo(() => {
    const monthTotal = monthsBetween(first, to).length;
    const stepFor = (perRow: number) => {
      const rows = heatmapRows(first, to, perRow);
      const columns = Math.max(...rows.map((r) => r.weeks.length));
      const byWidth = (width - labelWidth) / columns;
      const byHeight =
        height === undefined
          ? 21
          : (height - rows.length * monthLabel - (rows.length - 1) * rowGap) / rows.length / 7;
      return { rows, step: Math.min(byWidth, byHeight, 21) };
    };
    if (height === undefined) return stepFor(HEATMAP_ROW_MONTHS);
    let best = stepFor(monthTotal);
    for (let rowCount = 2; rowCount <= monthTotal; rowCount++) {
      const next = stepFor(Math.ceil(monthTotal / rowCount));
      if (next.step > best.step) best = next;
    }
    return best;
  }, [first, to, width, height]);
  const gap = step >= 12 ? 3 : step >= 7 ? 2 : 1;
  const size = Math.max(2, Math.floor(step - gap));
  const pitch = size + gap;

  const levels = useMemo(() => {
    const nets = [...byDay.values()].map((d) => d.income - d.expenses);
    return {
      in: quantileLevels(nets),
      out: quantileLevels(nets.map((n) => -n)),
    };
  }, [byDay]);

  // Month labels, dropping any that would run into the one before
  const labels = (row: HeatmapRow) => {
    let end = -Infinity;
    return row.months.flatMap(({ month, column }, i) => {
      const text = format(
        parseISO(`${month}-01`),
        i === 0 || month.endsWith('-01') ? 'MMM yyyy' : 'MMM',
      );
      const left = column * pitch;
      if (left < end + 6) return [];
      end = left + text.length * 5.5;
      return [{ month, text, left }];
    });
  };

  function color(day: string) {
    const flow = byDay.get(day);
    if (!flow || day > today) return undefined;
    const net = flow.income - flow.expenses;
    if (net > 0) return mix('positive', LEVEL_MIX[levels.in(net)]);
    if (net < 0) return mix('negative', LEVEL_MIX[levels.out(-net)]);
    return undefined;
  }

  return (
    <div
      className={`flex flex-col ${height !== undefined ? 'h-full justify-center' : ''}`}
      style={{ gap: rowGap }}
    >
      {rows.map((row) => (
        <div key={row.months[0].month}>
          <div
            className="relative text-[10px] text-text-tertiary"
            style={{ height: monthLabel, marginLeft: labelWidth }}
          >
            {labels(row).map(({ month, text, left }) => (
              <span key={month} className="absolute top-0 whitespace-nowrap" style={{ left }}>
                {text}
              </span>
            ))}
          </div>
          <div className="flex">
            <div
              className="flex flex-col text-[10px] text-text-tertiary"
              style={{ width: labelWidth, gap }}
            >
              {WEEKDAYS.map((d, i) => (
                <span key={i} className="leading-none flex items-center" style={{ height: size }}>
                  {i % 2 === 1 && size >= 7 ? d : ''}
                </span>
              ))}
            </div>
            <div className="flex" style={{ gap }}>
              {row.weeks.map((week, c) => (
                <div key={c} className="flex flex-col" style={{ gap }}>
                  {week.map((day, r) =>
                    day ? (
                      <HeatCell
                        key={day}
                        size={size}
                        background={color(day)}
                        selected={selected === day}
                        isToday={day === today}
                        future={day > today}
                        {...dayProps(day)}
                      />
                    ) : (
                      <div key={`blank-${r}`} style={{ width: size, height: size }} />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function HeatCell({
  size,
  background,
  selected,
  isToday,
  future,
  ...rest
}: {
  size: number;
  background?: string;
  selected: boolean;
  isToday: boolean;
  future: boolean;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <div
      {...rest}
      className={`rounded-[3px] bg-surface-alt ${
        rest.onClick
          ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'
          : ''
      } ${selected ? 'ring-2 ring-brand-500' : isToday ? 'ring-1 ring-brand-500' : ''} ${
        future ? 'opacity-40' : ''
      }`}
      style={{ width: size, height: size, background }}
    />
  );
}

function HeatmapLegend() {
  const swatch = (background?: string) => (
    <span className="w-2.5 h-2.5 rounded-[2px] bg-surface-alt" style={{ background }} />
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-text-tertiary">
      More out
      {[4, 3, 2, 1].map((l) => swatch(mix('negative', LEVEL_MIX[l])))}
      {swatch()}
      {[1, 2, 3, 4].map((l) => swatch(mix('positive', LEVEL_MIX[l])))}
      More in
    </span>
  );
}

// Keeps the tooltip inside the grid container: the dashboard widget clips what sticks out,
// so days in the first row get it below them instead of above.
function DayTooltip({
  hover,
  flow,
  width,
  height,
}: {
  hover: Hover;
  flow?: DailyFlowPoint;
  width: number;
  height: number;
}) {
  const w = 190;
  const gap = 6;
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const measured = box.current?.offsetHeight ?? 0;
    setH((cur) => (cur === measured ? cur : measured));
  });
  const left = Math.max(0, Math.min(width - w, hover.x - w / 2));
  const above = hover.y >= h + gap || hover.y >= height - hover.bottom;
  const top = Math.max(
    0,
    Math.min(above ? hover.y - h - gap : hover.bottom + gap, Math.max(0, height - h)),
  );
  const net = (flow?.income ?? 0) - (flow?.expenses ?? 0);
  return (
    <div
      ref={box}
      className={`${TOOLTIP_CLASS} absolute z-20 pointer-events-none`}
      style={{ left, top, width: w }}
    >
      <p className="text-xs text-text-tertiary mb-1">
        {format(parseISO(hover.day), 'EEE, MMM d, yyyy')}
      </p>
      {flow && flow.count > 0 ? (
        <>
          <p className="text-xs font-medium text-positive">In: {formatCurrency(flow.income)}</p>
          <p className="text-xs font-medium text-negative">Out: {formatCurrency(flow.expenses)}</p>
          <p className="text-xs font-semibold text-text mt-1 pt-1 border-t border-border-light">
            Net: {formatCurrency(net)}
          </p>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {flow.count} {flow.count === 1 ? 'transaction' : 'transactions'}
          </p>
        </>
      ) : (
        <p className="text-xs text-text-secondary">No transactions</p>
      )}
    </div>
  );
}
