import { useEffect, useMemo, useState } from 'react';
import type { XAxisTickContentProps } from 'recharts';
import { chartColors } from '../utils/chartColors';
import { layoutXAxis } from '../utils/axisLayout';

const FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, sans-serif';
const widthCache = new Map<string, number>();
let canvasContext: CanvasRenderingContext2D | null | undefined;

/** Measures text in the chart font, falling back to an estimate where canvas isn't available. */
function measurer(fontSize: number) {
  if (canvasContext === undefined) {
    canvasContext =
      typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  }
  return (text: string) => {
    const key = `${fontSize}|${text}`;
    let width = widthCache.get(key);
    if (width === undefined) {
      if (canvasContext) {
        canvasContext.font = `${fontSize}px ${FONT_FAMILY}`;
        width = canvasContext.measureText(text).width;
      } else {
        width = text.length * fontSize * 0.6;
      }
      if (widthCache.size > 5000) widthCache.clear();
      widthCache.set(key, width);
    }
    return width;
  };
}

interface Options {
  /** The label for every data point, exactly as it should read */
  labels: string[];
  kind: 'band' | 'point';
  /** True for dates (labels may be skipped), false for categories */
  ordered: boolean;
  fontSize?: number;
  /**
   * Space between the chart container and the plot area, in px: the chart margin plus the
   * y-axis width on the left, and the chart margin on the right.
   */
  inset: { left: number; right: number };
  /** Space beside the plot that edge labels may use without overlapping anything */
  edgeRoom?: { left: number; right: number };
  /** Largest share of the chart's height angled labels may take */
  maxHeightRatio?: number;
}

/**
 * Lays out a Recharts x-axis so labels never overlap or get cut off, whatever the chart's size.
 * Attach `ref` to an element that fills the chart's container, and spread `axisProps` on <XAxis>.
 */
export function useXAxisLayout({
  labels,
  kind,
  ordered,
  fontSize = 11,
  inset,
  edgeRoom,
  maxHeightRatio = 0.35,
}: Options) {
  // A callback ref, so measuring starts whenever the chart appears (e.g. after loading)
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!el) return;
    const update = (width: number, height: number) =>
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    const ro = new ResizeObserver(([entry]) =>
      update(entry.contentRect.width, entry.contentRect.height),
    );
    ro.observe(el);
    const r = el.getBoundingClientRect();
    update(r.width, r.height);
    return () => ro.disconnect();
  }, [el]);

  const labelsKey = labels.join('\u0000');
  const layout = useMemo(
    () =>
      layoutXAxis({
        labels,
        plotWidth: size.width - inset.left - inset.right,
        kind,
        ordered,
        fontSize,
        maxHeight: Math.max(40, Math.min(110, size.height * maxHeightRatio)),
        edgeRoom: edgeRoom ?? { left: 0, right: inset.right },
        measure: measurer(fontSize),
      }),
    // labels are compared by content (labelsKey); the rest are plain values
    [
      labelsKey,
      size.width,
      size.height,
      kind,
      ordered,
      fontSize,
      inset.left,
      inset.right,
      edgeRoom?.left,
      edgeRoom?.right,
      maxHeightRatio,
    ],
  );

  const axisProps = {
    // We decide which labels to draw, so Recharts must not drop any on its own
    interval: 0 as const,
    height: layout.height,
    tick: (props: XAxisTickContentProps) => {
      const text = layout.labels.get(props.index);
      const x = Number(props.x);
      const y = Number(props.y);
      if (!text || !Number.isFinite(x) || !Number.isFinite(y)) return <g />;
      const common = { x, y, fontSize, fill: chartColors.axis };
      if (layout.angle) {
        return (
          <text
            {...common}
            dy="0.35em"
            textAnchor="end"
            transform={`rotate(${layout.angle}, ${x}, ${y})`}
          >
            {text}
          </text>
        );
      }
      return (
        <text {...common} dy="0.71em" textAnchor={layout.anchors.get(props.index) ?? 'middle'}>
          {text}
        </text>
      );
    },
  };

  return { ref, axisProps, layout };
}
