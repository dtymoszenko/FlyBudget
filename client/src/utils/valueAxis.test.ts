import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { niceStep, valueAxis } from './valueAxis';

// Balances in cents, up to ±$100 million
const arbValues = fc.array(fc.integer({ min: -10_000_000_000, max: 10_000_000_000 }), {
  minLength: 1,
  maxLength: 60,
});

describe('valueAxis (property-based)', () => {
  it('fits every value between evenly spaced round ticks', () => {
    fc.assert(
      fc.property(arbValues, (values) => {
        const { domain, ticks } = valueAxis(values);
        for (const v of values) expect(v >= domain[0] && v <= domain[1]).toBe(true);
        expect(domain).toEqual([ticks[0], ticks[ticks.length - 1]]);
        const steps = ticks.slice(1).map((t, i) => t - ticks[i]);
        expect(new Set(steps).size).toBe(1);
        expect(ticks.length).toBeGreaterThanOrEqual(2);
        expect(ticks.length).toBeLessThanOrEqual(7);
      }),
    );
  });

  it('zooms in: the values fill most of the range', () => {
    fc.assert(
      fc.property(arbValues, (values) => {
        const { domain, ticks } = valueAxis(values);
        const step = ticks[1] - ticks[0];
        const lo = Math.min(...values);
        const hi = Math.max(...values);
        // Less than a step of empty space at each end, unless the values are nearly flat
        const minSpan = Math.max(10_000, 0.02 * Math.max(Math.abs(lo), Math.abs(hi)));
        if (hi - lo >= minSpan) {
          expect(lo - domain[0]).toBeLessThan(step);
          expect(domain[1] - hi).toBeLessThan(step);
        }
      }),
    );
  });

  it('keeps a nearly flat line flat instead of magnifying pennies', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 10_000_000_000 }),
        fc.integer({ min: 0, max: 100 }),
        (base, wiggle) => {
          const { domain } = valueAxis([base, base + wiggle]);
          expect(domain[1] - domain[0]).toBeGreaterThanOrEqual(base * 0.02);
        },
      ),
    );
  });

  it('shows net worth growing from $106k to $140k across most of the chart', () => {
    const { domain, ticks } = valueAxis([10_618_020, 12_101_648, 14_012_000]);
    expect(domain).toEqual([10_000_000, 15_000_000]);
    expect(ticks).toEqual([10_000_000, 11_000_000, 12_000_000, 13_000_000, 14_000_000, 15_000_000]);
  });
});

describe('niceStep', () => {
  it('is 1, 2, 2.5, 3, 4 or 5 times a power of ten', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000_000 }), (span) => {
        const step = niceStep(span, 5);
        const mag = 10 ** Math.floor(Math.log10(step));
        expect([1, 2, 2.5, 3, 4, 5]).toContain(Math.round((step / mag) * 10) / 10);
        expect(step * 4).toBeGreaterThanOrEqual(Math.min(span, 400) - 1e-9);
      }),
    );
  });
});
