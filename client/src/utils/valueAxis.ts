// Y-axis range and ticks zoomed to where the values actually are, for line charts where the
// change matters more than the distance from zero (net worth going from $106k to $140k should
// fill the chart, not sit in its top quarter). Bars must not use this: their height is their
// value, so a bar axis has to start at zero.

const NICE_STEPS = [1, 2, 2.5, 3, 4, 5, 10];
/** Smallest range shown, as a share of the largest value, so a nearly flat line stays flat */
const MIN_SPAN_SHARE = 0.02;
/** ...and never less than $100 */
const MIN_SPAN = 10_000;

export interface ValueAxis {
  domain: [number, number];
  ticks: number[];
}

/** A round step (1, 2, 2.5, 3, 4 or 5 × 10ⁿ, at least 1 dollar) giving about `count` ticks. */
export function niceStep(span: number, count: number): number {
  const rough = Math.max(span / Math.max(count - 1, 1), 100);
  const mag = 10 ** Math.floor(Math.log10(rough));
  return NICE_STEPS.find((s) => s * mag >= rough)! * mag;
}

/** Range from the round tick at or below the lowest value to the one at or above the highest. */
export function valueAxis(values: number[], count = 5): ValueAxis {
  const finite = values.filter(Number.isFinite);
  let lo = finite.length ? Math.min(...finite) : 0;
  let hi = finite.length ? Math.max(...finite) : 0;

  const minSpan = Math.max(MIN_SPAN, MIN_SPAN_SHARE * Math.max(Math.abs(lo), Math.abs(hi)));
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }

  const step = niceStep(hi - lo, count);
  const first = Math.floor(lo / step);
  const last = Math.ceil(hi / step);
  const ticks: number[] = [];
  for (let k = first; k <= last; k++) ticks.push(k * step || 0);
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}
