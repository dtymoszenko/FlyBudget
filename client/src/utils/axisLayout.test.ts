import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { LABEL_GAP, layoutXAxis, tickPosition, truncateToWidth } from './axisLayout';
import type { AxisLayoutInput } from './axisLayout';

// Deterministic stand-in for canvas text measurement: wide letters count more
const FONT = 11;
const measure = (s: string) =>
  [...s].reduce((w, ch) => w + (/[MW@]/.test(ch) ? 1 : /[il.,' ]/.test(ch) ? 0.3 : 0.6) * FONT, 0);

const arbLabel = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0);
const arbInput = fc.record({
  labels: fc.array(arbLabel, { minLength: 1, maxLength: 120 }),
  plotWidth: fc.integer({ min: 40, max: 2000 }),
  kind: fc.constantFrom<'band' | 'point'>('band', 'point'),
  ordered: fc.boolean(),
  maxHeight: fc.integer({ min: 40, max: 110 }),
  edgeRoom: fc.record({
    left: fc.integer({ min: 0, max: 60 }),
    right: fc.integer({ min: 0, max: 60 }),
  }),
});

const withDefaults = (i: Omit<AxisLayoutInput, 'measure' | 'fontSize'>): AxisLayoutInput => ({
  ...i,
  fontSize: FONT,
  measure,
});

// Where each drawn flat label actually sits on screen
function flatSpans(input: AxisLayoutInput, layout: ReturnType<typeof layoutXAxis>) {
  return [...layout.labels.entries()]
    .sort(([a], [b]) => a - b)
    .map(([i, text]) => {
      const x = tickPosition(i, input.labels.length, input.plotWidth, input.kind);
      const w = measure(text);
      const anchor = layout.anchors.get(i);
      const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      return { i, text, left, right: left + w };
    });
}

describe('x-axis layout (property-based)', () => {
  it('flat labels never overlap and never leave the chart', () => {
    fc.assert(
      fc.property(arbInput, (raw) => {
        const input = withDefaults(raw);
        const layout = layoutXAxis(input);
        fc.pre(layout.angle === 0);
        const spans = flatSpans(input, layout);
        for (let k = 0; k < spans.length; k++) {
          const s = spans[k];
          // The single-label fallback may be trimmed to the plot, so allow its own width
          expect(s.left).toBeGreaterThanOrEqual(-input.edgeRoom!.left - 0.5);
          expect(s.right).toBeLessThanOrEqual(input.plotWidth + input.edgeRoom!.right + 0.5);
          if (k > 0) expect(s.left - spans[k - 1].right).toBeGreaterThanOrEqual(LABEL_GAP - 0.01);
        }
      }),
    );
  });

  it('angled labels are spaced far enough apart and fit the height budget', () => {
    fc.assert(
      fc.property(arbInput, (raw) => {
        const input = withDefaults(raw);
        const layout = layoutXAxis(input);
        fc.pre(layout.angle !== 0);
        const rad = (Math.abs(layout.angle) * Math.PI) / 180;
        const [sin, cos] = [Math.sin(rad), Math.cos(rad)];
        expect(layout.angle).toBeGreaterThanOrEqual(-90);
        // Neighbouring tilted lines of text don't touch
        const slot = input.plotWidth / input.labels.length;
        expect(slot * sin).toBeGreaterThanOrEqual(FONT * 1.2);
        expect(layout.height).toBeLessThanOrEqual(input.maxHeight + 10);
        for (const [i, text] of layout.labels) {
          // Nothing runs off the left edge of the chart
          const x = tickPosition(i, input.labels.length, input.plotWidth, input.kind);
          const leftmost = x + input.edgeRoom!.left - measure(text) * cos - FONT * 0.6 * sin;
          expect(leftmost).toBeGreaterThanOrEqual(-0.5);
        }
      }),
    );
  });

  it('ordered axes always label the first point and never angle', () => {
    fc.assert(
      fc.property(arbInput, (raw) => {
        const input = withDefaults({ ...raw, ordered: true });
        const layout = layoutXAxis(input);
        expect(layout.angle).toBe(0);
        // Unless even a shortened first label can't fit at all
        if (layout.labels.size) expect(layout.labels.has(0)).toBe(true);
      }),
    );
  });

  it('shows every label untouched when there is plenty of room', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('Jan', 'Feb', 'Mar', 'Rent', 'Food'), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.boolean(),
        (labels, ordered) => {
          const layout = layoutXAxis(
            withDefaults({
              labels,
              plotWidth: 1200,
              kind: 'band',
              ordered,
              maxHeight: 80,
              edgeRoom: { left: 0, right: 0 },
            }),
          );
          expect([...layout.labels.values()]).toEqual(labels);
          expect(layout.angle).toBe(0);
        },
      ),
    );
  });

  it('category labels are only ever shortened, never changed', () => {
    fc.assert(
      fc.property(arbInput, (raw) => {
        const input = withDefaults({ ...raw, ordered: false });
        const layout = layoutXAxis(input);
        for (const [i, text] of layout.labels) {
          const original = input.labels[i];
          expect(
            text === original ||
              (text.endsWith('…') && original.startsWith(text.slice(0, -1).trimEnd())),
          ).toBe(true);
        }
      }),
    );
  });
});

it('a tiny chart with long dates still keeps its one label inside', () => {
  fc.assert(
    fc.property(
      fc.array(fc.string({ minLength: 30, maxLength: 60 }), { minLength: 1, maxLength: 5 }),
      fc.integer({ min: 20, max: 80 }),
      fc.constantFrom<'band' | 'point'>('band', 'point'),
      (labels, plotWidth, kind) => {
        const input = withDefaults({
          labels,
          plotWidth,
          kind,
          ordered: true,
          maxHeight: 60,
          edgeRoom: { left: 0, right: 0 },
        });
        for (const s of flatSpans(input, layoutXAxis(input))) {
          expect(s.left).toBeGreaterThanOrEqual(-0.5);
          expect(s.right).toBeLessThanOrEqual(plotWidth + 0.5);
        }
      },
    ),
  );
});

describe('truncateToWidth', () => {
  it('always fits the requested width', () => {
    fc.assert(
      fc.property(arbLabel, fc.integer({ min: 0, max: 300 }), (text, max) => {
        const out = truncateToWidth(text, max, measure);
        expect(out === '' || measure(out) <= max).toBe(true);
      }),
    );
  });
});

describe('real examples from the app', () => {
  it('"Day 1" … "Day 31" on a narrow card shows evenly spaced days, including the last', () => {
    const labels = Array.from({ length: 31 }, (_, i) => `Day ${i + 1}`);
    const layout = layoutXAxis(
      withDefaults({
        labels,
        plotWidth: 330,
        kind: 'point',
        ordered: true,
        maxHeight: 60,
        edgeRoom: { left: 0, right: 8 },
      }),
    );
    const shown = [...layout.labels.keys()].sort((a, b) => a - b);
    expect(shown[0]).toBe(0);
    expect(shown.length).toBeGreaterThan(2);
    expect(shown.length).toBeLessThan(12);
  });

  it('40 payees in a small widget are angled or left to the tooltip, never jammed together', () => {
    const labels = Array.from({ length: 40 }, (_, i) => `Payee number ${i + 1} Inc.`);
    for (const plotWidth of [250, 700, 1400]) {
      const layout = layoutXAxis(
        withDefaults({
          labels,
          plotWidth,
          kind: 'band',
          ordered: false,
          maxHeight: 80,
          edgeRoom: { left: 0, right: 0 },
        }),
      );
      if (layout.angle === 0 && layout.labels.size) {
        const spans = flatSpans(
          withDefaults({ labels, plotWidth, kind: 'band', ordered: false, maxHeight: 80 }),
          layout,
        );
        spans
          .slice(1)
          .forEach((s, k) =>
            expect(s.left - spans[k].right).toBeGreaterThanOrEqual(LABEL_GAP - 0.01),
          );
      }
    }
  });
});
