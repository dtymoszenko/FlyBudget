// Decides which x-axis labels to draw, and how, so they never overlap or get cut off.
//
// Two kinds of axis:
// - Ordered (days, months): labels may be skipped. We show every label if they fit, otherwise
//   every 2nd, 3rd, 7th… label, always keeping the first and, when there's room, the last.
// - Categories (payees, categories): skipping would leave bars unnamed, so labels are kept flat
//   if they fit, otherwise tilted (as gently as fits, down to vertical) and shortened with "…".
//   When bars are too thin even for vertical text, names are left to the tooltip.

export interface AxisLayoutInput {
  /** The label for every data point, in order */
  labels: string[];
  /** Width of the plotting area in px (the axis line), not the whole chart */
  plotWidth: number;
  /** 'band' = bar charts (labels centred in slots); 'point' = line/area (labels on the edges too) */
  kind: 'band' | 'point';
  /** True when labels can be skipped (dates); false for categories */
  ordered: boolean;
  fontSize: number;
  /** Most vertical space angled labels may take, in px */
  maxHeight: number;
  /** Space left and right of the plot that edge labels may spill into, in px */
  edgeRoom?: { left: number; right: number };
  measure: (text: string) => number;
}

export interface AxisLayout {
  /** Label to draw per data index; missing = no label */
  labels: Map<number, string>;
  /** 0 = flat, otherwise degrees (negative = text rises to the right) */
  angle: number;
  /** Text anchor per data index for flat labels ('start'/'end' pin the edge labels inside) */
  anchors: Map<number, 'start' | 'middle' | 'end'>;
  /** Height the axis needs, in px */
  height: number;
}

/** Minimum clear space between two neighbouring labels, in px */
export const LABEL_GAP = 8;
// Label steps that read naturally: every 2nd, 3rd… day; every quarter, half year, year…
const NICE_STEPS = [1, 2, 3, 4, 5, 6, 7, 10, 12, 14, 15, 20, 24, 25, 30, 50, 60, 100];
const ELLIPSIS = '…';

export function tickPosition(i: number, n: number, plotWidth: number, kind: 'band' | 'point') {
  if (kind === 'band') return ((i + 0.5) * plotWidth) / n;
  return n === 1 ? plotWidth / 2 : (i * plotWidth) / (n - 1);
}

/** Shortens `text` with an ellipsis so it measures at most `maxWidth`. */
export function truncateToWidth(text: string, maxWidth: number, measure: (s: string) => number) {
  if (measure(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid).trimEnd() + ELLIPSIS) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '' : text.slice(0, lo).trimEnd() + ELLIPSIS;
}

interface Span {
  left: number;
  right: number;
  anchor: 'start' | 'middle' | 'end';
}

// Where a flat label sits. On point axes the first and last labels are pinned inside the chart
// ("start"/"end") when centring them would push them past the edge room.
function flatSpan(i: number, width: number, input: AxisLayoutInput): Span {
  const { labels, plotWidth, kind, edgeRoom = { left: 0, right: 0 } } = input;
  const x = tickPosition(i, labels.length, plotWidth, kind);
  if (x - width / 2 < -edgeRoom.left) return { left: x, right: x + width, anchor: 'start' };
  if (x + width / 2 > plotWidth + edgeRoom.right)
    return { left: x - width, right: x, anchor: 'end' };
  return { left: x - width / 2, right: x + width / 2, anchor: 'middle' };
}

function fitsFlat(indices: number[], widths: number[], input: AxisLayoutInput) {
  const { plotWidth, edgeRoom = { left: 0, right: 0 } } = input;
  let prevRight = -Infinity;
  for (const i of indices) {
    const s = flatSpan(i, widths[i], input);
    if (s.left < -edgeRoom.left - 0.5 || s.right > plotWidth + edgeRoom.right + 0.5) return false;
    if (s.left - prevRight < LABEL_GAP) return false;
    prevRight = s.right;
  }
  return true;
}

const flatHeight = (fontSize: number) => Math.ceil(fontSize * 1.4) + 6;

function flatLayout(indices: number[], texts: string[], widths: number[], input: AxisLayoutInput) {
  const labels = new Map<number, string>();
  const anchors = new Map<number, 'start' | 'middle' | 'end'>();
  for (const i of indices) {
    labels.set(i, texts[i]);
    anchors.set(i, flatSpan(i, widths[i], input).anchor);
  }
  return { labels, anchors, angle: 0, height: flatHeight(input.fontSize) };
}

function orderedLayout(input: AxisLayoutInput, widths: number[]): AxisLayout {
  const n = input.labels.length;
  const steps = [...NICE_STEPS.filter((s) => s < n), ...Array.from({ length: n }, (_, i) => i + 1)];
  for (const step of steps) {
    const indices: number[] = [];
    for (let i = 0; i < n; i += step) indices.push(i);
    if (!fitsFlat(indices, widths, input)) continue;
    // Also label the last point when it fits next to the previous label
    if (indices[indices.length - 1] !== n - 1 && fitsFlat([...indices, n - 1], widths, input)) {
      indices.push(n - 1);
    }
    return flatLayout(indices, input.labels, widths, input);
  }
  // Not even one full label fits: show the first one, shortened to the room right of its tick
  const x = tickPosition(0, n, input.plotWidth, input.kind);
  const room = input.plotWidth + (input.edgeRoom?.right ?? 0) - x;
  const text = truncateToWidth(input.labels[0], room, input.measure);
  const labels = new Map(text ? [[0, text]] : []);
  return {
    labels,
    anchors: new Map([[0, 'start']]),
    angle: 0,
    height: flatHeight(input.fontSize),
  };
}

/** Geometry of labels tilted by `degrees` (rising to the right), each ending at its tick. */
function tilt(degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  return { degrees, sin: Math.sin(rad), cos: Math.cos(rad) };
}

// Gentlest first: 45° reads best, vertical fits the most labels
const TILTS = [45, 60, 75, 90].map(tilt);

function categoryLayout(input: AxisLayoutInput, widths: number[]): AxisLayout {
  const { labels, plotWidth, fontSize, maxHeight, measure } = input;
  const n = labels.length;
  const all = labels.map((_, i) => i);
  if (fitsFlat(all, widths, input)) return flatLayout(all, labels, widths, input);

  const slot = plotWidth / n;
  const lineHeight = fontSize * 1.2;
  const flatWidth = slot - LABEL_GAP;
  const minReadable = measure('Abc' + ELLIPSIS);

  // Tilted labels are parallel lines, slot × sin(angle) apart: use the gentlest tilt that keeps
  // neighbours from touching
  const t = TILTS.find((a) => slot * a.sin >= lineHeight + 2);
  // Longest tilted label that stays within the height budget
  const tiltedWidth = t ? (maxHeight - lineHeight * t.cos) / t.sin : 0;

  // Prefer whichever shows more of each name
  if (t && tiltedWidth >= minReadable && tiltedWidth > flatWidth * 1.3) {
    // Tilted labels run down and to the left of their bar, so the first few bars can only fit
    // as much text as there is room to their left
    const leftRoom = input.edgeRoom?.left ?? 0;
    const texts = labels.map((l, i) => {
      const x = tickPosition(i, n, plotWidth, input.kind) + leftRoom - (lineHeight / 2) * t.sin;
      // x < 0: even the text's thickness pokes past the edge, so nothing fits (at any tilt)
      const room = x < 0 ? 0 : t.cos > 1e-6 ? x / t.cos : Infinity;
      return truncateToWidth(l, Math.min(tiltedWidth, room), measure);
    });
    const longest = Math.max(0, ...texts.map(measure));
    const shown = new Map<number, string>();
    texts.forEach((text, i) => text && shown.set(i, text));
    return {
      labels: shown,
      anchors: new Map(all.map((i) => [i, 'end'])),
      angle: -t.degrees,
      height: Math.ceil(longest * t.sin + lineHeight * t.cos) + 8,
    };
  }
  if (flatWidth >= minReadable) {
    const texts = labels.map((l) => truncateToWidth(l, flatWidth, measure));
    const truncatedWidths = texts.map(measure);
    if (fitsFlat(all, truncatedWidths, input))
      return flatLayout(all, texts, truncatedWidths, input);
  }
  // Too many bars to name even vertically: leave the names to the tooltip
  // Keep enough room below the plot for the y-axis "$0" label, which sits on the axis line
  return { labels: new Map(), anchors: new Map(), angle: 0, height: Math.ceil(fontSize) + 4 };
}

export function layoutXAxis(input: AxisLayoutInput): AxisLayout {
  const empty: AxisLayout = {
    labels: new Map(),
    anchors: new Map(),
    angle: 0,
    height: flatHeight(input.fontSize),
  };
  if (!input.labels.length || input.plotWidth <= 0) return empty;
  const widths = input.labels.map(input.measure);
  return input.ordered ? orderedLayout(input, widths) : categoryLayout(input, widths);
}
