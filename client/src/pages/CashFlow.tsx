import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { format, subMonths, startOfYear, endOfYear, subYears } from 'date-fns';
import { useSpendingByCategory, useIncomeByCategory } from '../hooks/useReports';
import { formatCurrency } from '../utils/currency';
import { downloadCsv } from '../utils/exportCsv';
import { usePreferencesStore } from '../store/preferencesStore';
import { chartColors } from '../utils/chartColors';
import { Button } from '../components/ui/Button';
import { MonthRangePicker } from '../components/ui/MonthRangePicker';
import { Download, X, Info, ChevronDown, ChevronRight } from 'lucide-react';
import { useIsPhone } from '../hooks/useIsPhone';
import { TransactionTable } from '../components/transactions/TransactionTable';
import {
  ChartSkeleton,
  EmptyState,
  StatCardRow,
  EXPENSE_COLORS,
} from '../components/reports/ChartHelpers';
import type { StatCard } from '../components/reports/ChartHelpers';
import type { SpendingByCategory as SpendingByCat, IncomeByCategoryItem } from '../types';

// ─── Types & Constants ───────────────────────────────────────────────────────

type Preset = '1m' | '3m' | '6m' | 'ytd' | 'last-year' | 'custom';
type NodeType = 'income' | 'hub' | 'expense-group' | 'subcategory' | 'savings';

const PRESETS: { id: Preset; label: string }[] = [
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: 'ytd', label: 'This Year' },
  { id: 'last-year', label: 'Last Year' },
  { id: 'custom', label: 'Custom' },
];

const MIN_SAVINGS_CENTS = 500;
const NODE_W = 12;
const MIN_NODE_H = 2;
const MIN_SLOT = 30; // vertical room reserved per node so its two-line label fits
const NODE_GAP = 10;
const SANKEY_MARGIN_Y = 32;
const SANKEY_MIN_H = 420;
/**
 * The diagram's labels need about 350px beside the bars, so on phones it's drawn at a fixed
 * width inside a box that scrolls sideways (see CashFlowPage)
 */
const SANKEY_BOX = 'w-full max-md:w-[760px]';

interface SankeyNode {
  name: string;
  nodeType: NodeType;
  amount: number;
  color: string;
  layer: number;
  categoryId?: string | null;
  groupId?: string | null;
  groupName?: string;
  pctOfIncome?: number;
  pctOfGroup?: number;
  pctOfSpending?: number;
  savingsRate?: number;
}

interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

interface SankeyGraph {
  nodes: SankeyNode[];
  links: SankeyLink[];
  totalIncome: number;
  totalExpenses: number;
  savings: number;
  hasNegativeFlows: boolean;
}

interface LayoutNode extends SankeyNode {
  x: number;
  y: number;
  w: number;
  h: number;
  labelY: number;
  idx: number;
  slotY: number;
  slotH: number;
}

interface LayoutLink {
  si: number;
  ti: number;
  value: number;
  sy: number;
  ty: number;
  lw: number;
  color: string;
  idx: number;
}

interface SelectedNode {
  categoryId?: string | null;
  groupId?: string | null;
  groupName?: string;
  name: string;
  nodeType: NodeType;
}

interface SankeyDiagramProps {
  from: string;
  to: string;
  selectedNode: SelectedNode | null;
  onNodeClick: (node: SelectedNode | null) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDollars(cents: number): string {
  const sym = usePreferencesStore.getState().currencySymbol || '$';
  const abs = Math.abs(cents);
  const dollars = Math.round(abs / 100);
  const f = dollars.toLocaleString('en-US');
  return cents < 0 ? `-${sym}${f}` : `${sym}${f}`;
}

function lighten(hex: string, amt: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.round(r + (255 - r) * amt);
  const ng = Math.round(g + (255 - g) * amt);
  const nb = Math.round(b + (255 - b) * amt);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

function highlightPath(
  ni: number,
  nodes: SankeyNode[],
  links: SankeyLink[],
): { hn: Set<number>; hl: Set<number> } {
  const node = nodes[ni];
  const hn = new Set([ni]);
  const hl = new Set<number>();

  if (node.nodeType === 'hub') {
    nodes.forEach((_, i) => hn.add(i));
    links.forEach((_, i) => hl.add(i));
    return { hn, hl };
  }

  function up(idx: number) {
    links.forEach((l, li) => {
      if (l.target === idx && !hl.has(li)) {
        hl.add(li);
        hn.add(l.source);
        up(l.source);
      }
    });
  }
  function down(idx: number) {
    links.forEach((l, li) => {
      if (l.source === idx && !hl.has(li)) {
        hl.add(li);
        hn.add(l.target);
        down(l.target);
      }
    });
  }

  if (node.nodeType === 'income') {
    links.forEach((l, li) => {
      if (l.source === ni) {
        hl.add(li);
        hn.add(l.target);
      }
    });
  } else if (node.nodeType === 'expense-group' || node.nodeType === 'savings') {
    links.forEach((l, li) => {
      if (l.target === ni) {
        hl.add(li);
        hn.add(l.source);
      }
    });
    down(ni);
  } else {
    up(ni);
    down(ni);
  }
  return { hn, hl };
}

/** Largest scale where every node's slot (max(value·s, MIN_SLOT)) plus gaps fits in `avail`. */
function fitLayerScale(amounts: number[], avail: number): number {
  const used = (s: number) =>
    amounts.reduce((sum, a) => sum + Math.max(a * s, MIN_SLOT), 0) +
    (amounts.length - 1) * NODE_GAP;
  const total = amounts.reduce((s, a) => s + a, 0);
  if (total <= 0) return Infinity;
  let lo = 0,
    hi = avail / total;
  if (used(lo) > avail) return lo;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (used(mid) <= avail) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ─── Build Sankey Graph ──────────────────────────────────────────────────────

function buildSankeyGraph(
  incomeData: IncomeByCategoryItem[],
  spendingData: SpendingByCat[],
  showIcons: boolean,
): SankeyGraph | null {
  const validIncome = incomeData.filter((c) => c.totalReceived > 0);
  const validSpending = spendingData.filter((c) => c.totalSpent > 0);
  const hasNeg =
    validIncome.length < incomeData.length || validSpending.length < spendingData.length;
  if (!validIncome.length && !validSpending.length) return null;

  const totalIncome = validIncome.reduce((s, c) => s + c.totalReceived, 0);
  const totalExpenses = validSpending.reduce((s, c) => s + c.totalSpent, 0);
  const savings = totalIncome - totalExpenses;

  const icon = (c: { categoryIcon?: string | null }) =>
    showIcons && c.categoryIcon ? c.categoryIcon + ' ' : '';

  // Layer 0: Income sources
  const incomeNodes: SankeyNode[] = validIncome
    .sort((a, b) => b.totalReceived - a.totalReceived)
    .map((c) => ({
      name: `${icon(c)}${c.categoryName ?? 'Income'}`,
      nodeType: 'income',
      amount: c.totalReceived,
      color: chartColors.positive,
      layer: 0,
      pctOfIncome: validIncome.length > 1 ? (c.totalReceived / totalIncome) * 100 : undefined,
    }));

  // Layer 1: Hub
  const hubNode: SankeyNode = {
    name: 'Total Income',
    nodeType: 'hub',
    amount: totalIncome,
    color: chartColors.brand,
    layer: 1,
  };

  // Build group aggregates
  const groupMap = new Map<
    string,
    { total: number; groupId: string | null; items: SpendingByCat[] }
  >();
  for (const item of validSpending) {
    const key = item.groupName ?? 'Uncategorized';
    const ex = groupMap.get(key);
    if (ex) {
      ex.total += item.totalSpent;
      ex.items.push(item);
    } else groupMap.set(key, { total: item.totalSpent, groupId: item.groupId, items: [item] });
  }
  const sortedGroups = [...groupMap.entries()].sort((a, b) => b[1].total - a[1].total);

  // Assign group colors
  const gColorMap = new Map<string, string>();
  sortedGroups.forEach(([name], i) => {
    gColorMap.set(
      name,
      name === 'Uncategorized' ? chartColors.axis : EXPENSE_COLORS[i % EXPENSE_COLORS.length],
    );
  });

  // Layer 2: Expense groups
  const groupNodes: SankeyNode[] = sortedGroups.map(([name, { total, groupId }]) => ({
    name,
    nodeType: 'expense-group',
    amount: total,
    color: gColorMap.get(name) ?? chartColors.axis,
    layer: 2,
    groupId,
    groupName: name,
    pctOfIncome: totalIncome > 0 ? (total / totalIncome) * 100 : 0,
    pctOfSpending: totalExpenses > 0 ? (total / totalExpenses) * 100 : 0,
  }));

  // Layer 2: Savings
  const savingsNodes: SankeyNode[] =
    savings > MIN_SAVINGS_CENTS
      ? [
          {
            name: 'Savings',
            nodeType: 'savings',
            amount: savings,
            color: chartColors.positive,
            layer: 2,
            savingsRate: totalIncome > 0 ? (savings / totalIncome) * 100 : 0,
          },
        ]
      : [];

  // Layer 3: Subcategories per group (with Other aggregation)
  const subcatNodes: SankeyNode[] = [];
  const groupSubMap = new Map<string, SankeyNode[]>();

  for (const [gName, { items }] of sortedGroups) {
    const gColor = gColorMap.get(gName) ?? chartColors.axis;
    const gTotal = items.reduce((s, i) => s + i.totalSpent, 0);
    const sorted = [...items].sort((a, b) => b.totalSpent - a.totalSpent);

    const subs: SankeyNode[] = sorted.map((item, ci) => ({
      name: `${icon(item)}${item.categoryName ?? 'Uncategorized'}`,
      nodeType: 'subcategory' as NodeType,
      amount: item.totalSpent,
      color: lighten(gColor, sorted.length > 1 ? Math.min(ci * 0.12, 0.4) : 0),
      layer: 3,
      categoryId: item.categoryId,
      groupName: gName,
      pctOfGroup: gTotal > 0 ? (item.totalSpent / gTotal) * 100 : 0,
      pctOfSpending: totalExpenses > 0 ? (item.totalSpent / totalExpenses) * 100 : 0,
    }));
    groupSubMap.set(gName, subs);
    subcatNodes.push(...subs);
  }

  // Assemble nodes (Savings leads layer 2, above the expense groups)
  const nodes: SankeyNode[] = [
    ...incomeNodes,
    hubNode,
    ...savingsNodes,
    ...groupNodes,
    ...subcatNodes,
  ];

  const hubIdx = incomeNodes.length;
  const savStart = hubIdx + 1;
  const grpStart = savStart + savingsNodes.length;
  const subStart = grpStart + groupNodes.length;

  // Build links
  const links: SankeyLink[] = [];
  incomeNodes.forEach((_, i) =>
    links.push({ source: i, target: hubIdx, value: validIncome[i].totalReceived }),
  );
  sortedGroups.forEach(([, { total }], i) =>
    links.push({ source: hubIdx, target: grpStart + i, value: total }),
  );
  if (savingsNodes.length) links.push({ source: hubIdx, target: savStart, value: savings });

  let si = subStart;
  for (const [gName] of sortedGroups) {
    const subs = groupSubMap.get(gName) ?? [];
    const gi = grpStart + sortedGroups.findIndex(([n]) => n === gName);
    for (const sub of subs) {
      links.push({ source: gi, target: si, value: sub.amount });
      si++;
    }
  }

  const validLinks = links.filter((l) => l.value > 0);
  return validLinks.length
    ? { nodes, links: validLinks, totalIncome, totalExpenses, savings, hasNegativeFlows: hasNeg }
    : null;
}

// ─── Compute Layout ──────────────────────────────────────────────────────────

function computeLayout(
  graph: SankeyGraph,
  width: number,
  height: number,
): { nodes: LayoutNode[]; links: LayoutLink[] } | null {
  const mT = SANKEY_MARGIN_Y / 2,
    mB = SANKEY_MARGIN_Y / 2,
    lmL = 170,
    lmR = 180;
  const dW = width - lmL - lmR;
  const dH = height - mT - mB;
  if (dW <= 0 || dH <= 0) return null;

  // Group by layer
  const layers = new Map<number, number[]>();
  graph.nodes.forEach((n, i) => {
    if (!layers.has(n.layer)) layers.set(n.layer, []);
    layers.get(n.layer)!.push(i);
  });

  // Column X — adaptive to income count
  const incCount = (layers.get(0) ?? []).length;
  const colX =
    incCount <= 1
      ? [0.05, 0.2, 0.55, 0.92].map((p) => lmL + p * dW)
      : [0.02, 0.28, 0.58, 0.92].map((p) => lmL + p * dW);

  // Global scale: constrained by most-crowded layer
  let scale = Infinity;
  for (const [, idxs] of layers) {
    scale = Math.min(
      scale,
      fitLayerScale(
        idxs.map((i) => graph.nodes[i].amount),
        dH,
      ),
    );
  }
  if (!isFinite(scale) || scale <= 0) scale = 1;

  // Create layout nodes
  const ln: LayoutNode[] = graph.nodes.map((n, i) => {
    const h = Math.max(n.amount * scale, MIN_NODE_H);
    return {
      ...n,
      x: colX[n.layer] ?? 0,
      y: 0,
      w: NODE_W,
      h,
      labelY: 0,
      idx: i,
      slotY: 0,
      slotH: Math.max(h, MIN_SLOT),
    };
  });

  // Stack evenly spaced, top-aligned slots per layer; bar and label centered in each slot
  for (const [, idxs] of layers) {
    const layerN = idxs.map((i) => ln[i]);
    let y = mT;
    for (const n of layerN) {
      n.slotY = y;
      n.y = y + (n.slotH - n.h) / 2;
      n.labelY = n.y + n.h / 2;
      y += n.slotH + NODE_GAP;
    }
  }

  // Group links by source, sort by target Y
  const bySource = new Map<number, number[]>();
  const byTarget = new Map<number, number[]>();
  graph.links.forEach((l, i) => {
    if (!bySource.has(l.source)) bySource.set(l.source, []);
    bySource.get(l.source)!.push(i);
    if (!byTarget.has(l.target)) byTarget.set(l.target, []);
    byTarget.get(l.target)!.push(i);
  });
  for (const [, li] of bySource)
    li.sort((a, b) => ln[graph.links[a].target].y - ln[graph.links[b].target].y);
  for (const [, li] of byTarget)
    li.sort((a, b) => ln[graph.links[a].source].y - ln[graph.links[b].source].y);

  const linkSy = new Float64Array(graph.links.length);
  const linkTy = new Float64Array(graph.links.length);
  const linkW = new Float64Array(graph.links.length);

  for (const [ni, lis] of bySource) {
    let py = ln[ni].y;
    for (const li of lis) {
      const w = graph.links[li].value * scale;
      linkSy[li] = py + w / 2;
      linkW[li] = w;
      py += w;
    }
  }
  for (const [ni, lis] of byTarget) {
    let py = ln[ni].y;
    for (const li of lis) {
      const w = graph.links[li].value * scale;
      linkTy[li] = py + w / 2;
      py += w;
    }
  }

  const ll: LayoutLink[] = graph.links.map((l, i) => ({
    si: l.source,
    ti: l.target,
    value: l.value,
    sy: linkSy[i],
    ty: linkTy[i],
    lw: linkW[i],
    color: ln[l.source].nodeType === 'income' ? ln[l.source].color : ln[l.target].color,
    idx: i,
  }));

  return { nodes: ln, links: ll };
}

// ─── Sankey Diagram Component ────────────────────────────────────────────────

function linkPath(sx: number, sy: number, tx: number, ty: number, w: number) {
  const hw = w / 2;
  const cx = (sx + tx) / 2;
  return (
    `M${sx},${sy - hw} C${cx},${sy - hw} ${cx},${ty - hw} ${tx},${ty - hw} ` +
    `L${tx},${ty + hw} C${cx},${ty + hw} ${cx},${sy + hw} ${sx},${sy + hw} Z`
  );
}

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setSize({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ width: r.width, height: r.height });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function SankeyDiagram({ from, to, selectedNode, onNodeClick }: SankeyDiagramProps) {
  const showIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { data: incomeData = [], isLoading: il } = useIncomeByCategory(from, to);
  const { data: spendingData = [], isLoading: sl } = useSpendingByCategory(from, to);
  const containerRef = useRef<HTMLDivElement>(null);
  const { width } = useContainerSize(containerRef);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: SankeyNode } | null>(null);

  const graph = useMemo(
    () => buildSankeyGraph(incomeData, spendingData, showIcons),
    [incomeData, spendingData, showIcons],
  );

  // Height derived from the graph itself: the most crowded column gets one MIN_SLOT row
  // per node, so every slot is guaranteed to fit (fitLayerScale never hits zero).
  const height = useMemo(() => {
    if (!graph) return SANKEY_MIN_H;
    const counts = new Map<number, number>();
    for (const n of graph.nodes) counts.set(n.layer, (counts.get(n.layer) ?? 0) + 1);
    const maxCol = Math.max(...counts.values());
    return Math.max(SANKEY_MIN_H, maxCol * (MIN_SLOT + NODE_GAP) + SANKEY_MARGIN_Y);
  }, [graph]);

  const layout = useMemo(
    () => (graph && width > 0 ? computeLayout(graph, width, height) : null),
    [graph, width, height],
  );

  // Map selectedNode to graph index
  const selectedIdx = useMemo(() => {
    if (!selectedNode || !graph) return -1;
    return graph.nodes.findIndex((n) => {
      if (selectedNode.nodeType === 'subcategory' && n.nodeType === 'subcategory')
        return n.categoryId != null && n.categoryId === selectedNode.categoryId;
      if (selectedNode.nodeType === 'expense-group' && n.nodeType === 'expense-group')
        return n.groupName === selectedNode.name;
      if (selectedNode.nodeType === 'savings') return n.nodeType === 'savings';
      return false;
    });
  }, [selectedNode, graph]);

  // Compute highlighted sets
  const highlighted = useMemo(() => {
    if (!graph) return null;
    const active = hoveredIdx != null ? hoveredIdx : selectedIdx >= 0 ? selectedIdx : null;
    if (active == null) return null;
    return highlightPath(active, graph.nodes, graph.links);
  }, [graph, hoveredIdx, selectedIdx]);

  const handleNodeEnter = useCallback((e: React.MouseEvent, idx: number, node: SankeyNode) => {
    setHoveredIdx(idx);
    setTooltip({ x: e.clientX, y: e.clientY, node });
  }, []);

  const handleNodeMove = useCallback((e: React.MouseEvent, node: SankeyNode) => {
    setTooltip((prev) => (prev ? { x: e.clientX, y: e.clientY, node } : null));
  }, []);

  const handleLeave = useCallback(() => {
    setHoveredIdx(null);
    setTooltip(null);
  }, []);

  const handleClick = useCallback(
    (node: SankeyNode) => {
      const isClickable = node.nodeType === 'subcategory' || node.nodeType === 'expense-group';
      if (!isClickable) return;
      // Check if already selected
      const isSame =
        selectedNode &&
        ((node.categoryId != null && node.categoryId === selectedNode.categoryId) ||
          (node.nodeType === 'expense-group' && node.groupName === selectedNode.name));
      if (isSame) {
        onNodeClick(null);
        return;
      }
      onNodeClick({
        categoryId: node.categoryId,
        groupId: node.groupId,
        groupName: node.groupName,
        name: node.name,
        nodeType: node.nodeType,
      });
    },
    [selectedNode, onNodeClick],
  );

  const handleLinkEnter = useCallback(
    (e: React.MouseEvent, link: LayoutLink) => {
      if (!layout) return;
      const src = layout.nodes[link.si];
      const tgt = layout.nodes[link.ti];
      setHoveredIdx(link.ti);
      setTooltip({
        x: e.clientX,
        y: e.clientY,
        node: {
          ...tgt,
          name: `${src.name} → ${tgt.name}`,
        },
      });
    },
    [layout],
  );

  if (il || sl)
    return (
      <div ref={containerRef} className={SANKEY_BOX} style={{ height: SANKEY_MIN_H }}>
        <ChartSkeleton />
      </div>
    );
  if (!graph)
    return (
      <div ref={containerRef} className={SANKEY_BOX} style={{ height: SANKEY_MIN_H }}>
        <EmptyState />
      </div>
    );

  return (
    <div ref={containerRef} className={`relative ${SANKEY_BOX}`}>
      {width > 0 && layout && (
        <svg width={width} height={height} className="select-none">
          {/* Links */}
          <g>
            {layout.links.map((l, i) => {
              const srcX = layout.nodes[l.si].x + NODE_W;
              const tgtX = layout.nodes[l.ti].x;
              const tgtNode = layout.nodes[l.ti];
              const clickable =
                tgtNode.nodeType === 'subcategory' || tgtNode.nodeType === 'expense-group';
              let opacity = 0.22;
              if (highlighted) {
                opacity = highlighted.hl.has(l.idx) ? 0.6 : 0.07;
              }
              return (
                <path
                  key={i}
                  d={linkPath(srcX, l.sy, tgtX, l.ty, l.lw)}
                  fill={l.color}
                  fillOpacity={opacity}
                  // Transparent stroke widens the hit area of thin flows to ≥ 8px
                  stroke="transparent"
                  strokeWidth={l.lw < 8 ? 8 - l.lw : 0}
                  style={{
                    transition: 'fill-opacity 0.2s ease',
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                  onMouseEnter={(e) => handleLinkEnter(e, l)}
                  onMouseMove={(e) =>
                    setTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null))
                  }
                  onMouseLeave={handleLeave}
                  onClick={clickable ? () => handleClick(tgtNode) : undefined}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {layout.nodes.map((n, i) => {
              if (n.h < 0.5) return null;
              const clickable = n.nodeType === 'subcategory' || n.nodeType === 'expense-group';
              let nodeOpacity = 1;
              if (highlighted) {
                nodeOpacity = highlighted.hn.has(n.idx) ? 1 : 0.25;
              }
              return (
                <rect
                  key={i}
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  fill={n.color}
                  rx={3}
                  style={{
                    opacity: nodeOpacity,
                    transition: 'opacity 0.2s ease',
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                  onMouseEnter={(e) => handleNodeEnter(e, n.idx, n)}
                  onMouseMove={(e) => handleNodeMove(e, n)}
                  onMouseLeave={handleLeave}
                  onClick={() => handleClick(n)}
                />
              );
            })}
          </g>

          {/* Labels */}
          <g>
            {layout.nodes.map((n, i) => {
              if (n.h < 0.5) return null;
              const isLeft = n.nodeType === 'income';
              const lx = isLeft ? n.x - 8 : n.x + NODE_W + 8;
              const anchor = isLeft ? 'end' : 'start';
              const isGroup = n.nodeType === 'expense-group';
              const fontSize = isGroup ? 11 : 10;
              const fontWeight = isGroup ? 600 : n.nodeType === 'hub' ? 600 : 400;
              const clickable = n.nodeType === 'subcategory' || n.nodeType === 'expense-group';

              let nodeOpacity = 1;
              if (highlighted) {
                nodeOpacity = highlighted.hn.has(n.idx) ? 1 : 0.25;
              }

              // Build label text
              const amtStr = formatDollars(n.amount);
              let pctStr = '';
              if (n.nodeType === 'income' && n.pctOfIncome != null) {
                pctStr = ` · ${n.pctOfIncome.toFixed(1)}%`;
              } else if (n.nodeType === 'expense-group' && n.pctOfIncome != null) {
                pctStr = ` · ${n.pctOfIncome.toFixed(1)}%`;
              } else if (n.nodeType === 'subcategory' && n.pctOfGroup != null) {
                pctStr = ` · ${n.pctOfGroup.toFixed(1)}%`;
              } else if (n.nodeType === 'savings' && n.savingsRate != null) {
                pctStr = ` · ${n.savingsRate.toFixed(1)}%`;
              }
              const hitW =
                NODE_W +
                8 +
                Math.max(n.name.length * fontSize * 0.6, (amtStr.length + pctStr.length) * 5.5);

              return (
                <g
                  key={i}
                  style={{
                    opacity: nodeOpacity,
                    transition: 'opacity 0.2s ease',
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                  onMouseEnter={(e) => handleNodeEnter(e, n.idx, n)}
                  onMouseMove={(e) => handleNodeMove(e, n)}
                  onMouseLeave={handleLeave}
                  onClick={() => handleClick(n)}
                >
                  {/* Hit area spanning bar through label (label-height only, so big nodes don't block flows) */}
                  {clickable && (
                    <rect
                      x={n.x}
                      y={n.labelY - MIN_SLOT / 2}
                      width={hitW}
                      height={MIN_SLOT}
                      fill="transparent"
                    />
                  )}
                  <text
                    x={lx}
                    y={n.labelY - 3}
                    textAnchor={anchor}
                    fontSize={fontSize}
                    fontWeight={fontWeight}
                    fill={chartColors.label}
                    pointerEvents="none"
                  >
                    {n.name}
                  </text>
                  <text
                    x={lx}
                    y={n.labelY + 10}
                    textAnchor={anchor}
                    fontSize={9}
                    fill={chartColors.axis}
                    pointerEvents="none"
                  >
                    {amtStr}
                    {pctStr}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-surface rounded-md shadow-hover border border-border px-3 py-2 max-w-[260px]"
          style={{ left: tooltip.x + 14, top: tooltip.y - 12 }}
        >
          <SankeyTooltip
            node={tooltip.node}
            totalIncome={graph.totalIncome}
            totalExpenses={graph.totalExpenses}
          />
        </div>
      )}

      {/* Negative flow info */}
      {graph.hasNegativeFlows && (
        <div className="mt-1 px-4 flex items-center gap-1.5 text-xs text-text-tertiary">
          <Info size={12} className="shrink-0" />
          <span>
            Some flows excluded — Sankey diagrams cannot represent negative values (e.g. refunds).
            Summary totals may differ slightly.
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Tooltip Content ─────────────────────────────────────────────────────────

function SankeyTooltip({
  node,
  totalIncome,
  totalExpenses,
}: {
  node: SankeyNode;
  totalIncome: number;
  totalExpenses: number;
}) {
  const n = node;
  const amt = formatCurrency(n.amount);

  if (n.nodeType === 'hub') {
    return (
      <>
        <p className="text-xs font-medium text-text">{n.name}</p>
        <p className="text-xs text-positive font-semibold">{amt}</p>
      </>
    );
  }

  if (n.nodeType === 'income') {
    return (
      <>
        <p className="text-xs font-medium text-text">{n.name}</p>
        <p className="text-xs text-positive font-semibold">{amt}</p>
        {n.pctOfIncome != null && (
          <p className="text-xs text-text-tertiary">{n.pctOfIncome.toFixed(1)}% of total income</p>
        )}
      </>
    );
  }

  if (n.nodeType === 'savings') {
    return (
      <>
        <p className="text-xs font-medium text-text">{n.name}</p>
        <p className="text-xs text-positive font-semibold">{amt}</p>
        {n.savingsRate != null && (
          <p className="text-xs text-text-tertiary">{n.savingsRate.toFixed(1)}% savings rate</p>
        )}
      </>
    );
  }

  if (n.nodeType === 'expense-group') {
    return (
      <>
        <p className="text-xs font-medium text-text">{n.name}</p>
        <p className="text-xs font-semibold" style={{ color: n.color }}>
          {amt}
        </p>
        {n.pctOfIncome != null && (
          <p className="text-xs text-text-tertiary">{n.pctOfIncome.toFixed(1)}% of total income</p>
        )}
        {n.pctOfSpending != null && (
          <p className="text-xs text-text-tertiary">
            {n.pctOfSpending.toFixed(1)}% of total spending
          </p>
        )}
      </>
    );
  }

  // Subcategory

  return (
    <>
      <p className="text-xs font-medium text-text">{n.name}</p>
      <p className="text-xs font-semibold" style={{ color: n.color }}>
        {amt}
      </p>
      {n.pctOfGroup != null && n.groupName && (
        <p className="text-xs text-text-tertiary">
          {n.pctOfGroup.toFixed(1)}% of {n.groupName}
        </p>
      )}
      {n.pctOfSpending != null && (
        <p className="text-xs text-text-tertiary">
          {n.pctOfSpending.toFixed(1)}% of total spending
        </p>
      )}
    </>
  );
}

// ─── Phone list ──────────────────────────────────────────────────────────────

const pct = (n: number | undefined) =>
  n == null ? '' : `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;

/**
 * Phones: the same numbers as the diagram, as a list. Money in, then where it went: savings and
 * each spending group with a bar for its share of income. Tap a group to see its categories,
 * and a category (or "All of …") to list its transactions below.
 */
function CashFlowList({ from, to, selectedNode, onNodeClick }: SankeyDiagramProps) {
  const showIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { data: incomeData = [], isLoading: il } = useIncomeByCategory(from, to);
  const { data: spendingData = [], isLoading: sl } = useSpendingByCategory(from, to);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const graph = useMemo(
    () => buildSankeyGraph(incomeData, spendingData, showIcons),
    [incomeData, spendingData, showIcons],
  );

  if (il || sl)
    return (
      <div style={{ height: SANKEY_MIN_H }}>
        <ChartSkeleton />
      </div>
    );
  if (!graph)
    return (
      <div style={{ height: SANKEY_MIN_H }}>
        <EmptyState />
      </div>
    );

  const income = graph.nodes.filter((n) => n.nodeType === 'income');
  const savings = graph.nodes.find((n) => n.nodeType === 'savings');
  const groups = graph.nodes.filter((n) => n.nodeType === 'expense-group');
  // Bars are shares of income (or of spending, when more went out than came in)
  const base = Math.max(graph.totalIncome, graph.totalExpenses, 1);
  const isSelected = (n: SankeyNode) =>
    !!selectedNode &&
    selectedNode.nodeType === n.nodeType &&
    (n.nodeType === 'subcategory'
      ? selectedNode.categoryId === n.categoryId
      : selectedNode.groupName === n.groupName);
  const select = (n: SankeyNode) =>
    onNodeClick(
      isSelected(n)
        ? null
        : {
            categoryId: n.categoryId,
            groupId: n.groupId,
            groupName: n.groupName,
            name: n.name,
            nodeType: n.nodeType,
          },
    );

  const bar = (amount: number, color: string) => (
    <div className="h-1.5 mt-1.5 rounded-full bg-surface-alt overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max((amount / base) * 100, 1)}%`, background: color }}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="bg-surface rounded-lg shadow-card border border-border-light">
        <h3 className="px-4 pt-3 pb-1 text-xs font-semibold text-text-secondary">Money in</h3>
        {income.map((n) => (
          <div
            key={n.name}
            className="px-4 py-2.5 border-t border-border-light first-of-type:border-t-0"
          >
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-text">{n.name}</span>
              <span className="tabular-nums font-medium text-positive">
                {formatCurrency(n.amount)}
              </span>
            </div>
            {bar(n.amount, n.color)}
          </div>
        ))}
      </section>

      <section className="bg-surface rounded-lg shadow-card border border-border-light overflow-hidden">
        <h3 className="px-4 pt-3 pb-1 text-xs font-semibold text-text-secondary">Where it went</h3>
        {savings && (
          <div className="px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-text font-medium">Saved</span>
              <span className="tabular-nums font-medium text-positive">
                {formatCurrency(savings.amount)}
                <span className="ml-1.5 text-xs font-normal text-text-tertiary">
                  {' '}
                  {pct(savings.savingsRate)}
                </span>
              </span>
            </div>
            {bar(savings.amount, savings.color)}
          </div>
        )}
        {groups.map((g) => {
          const open = openGroup === g.groupName;
          const subs = graph.nodes.filter(
            (n) => n.nodeType === 'subcategory' && n.groupName === g.groupName,
          );
          return (
            <div key={g.name} className="border-t border-border-light">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenGroup(open ? null : (g.groupName ?? null))}
                className="w-full min-h-11 px-4 py-2.5 text-left cursor-pointer"
              >
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex items-center gap-1.5 min-w-0 text-text font-medium">
                    {open ? (
                      <ChevronDown size={14} className="shrink-0 text-text-tertiary" aria-hidden />
                    ) : (
                      <ChevronRight size={14} className="shrink-0 text-text-tertiary" aria-hidden />
                    )}
                    <span className="truncate">{g.name}</span>
                  </span>
                  <span className="tabular-nums text-text whitespace-nowrap">
                    {formatCurrency(g.amount)}
                    <span className="ml-1.5 text-xs text-text-tertiary">
                      {' '}
                      {pct(g.pctOfIncome)}
                      <span className="sr-only"> of income</span>
                    </span>
                  </span>
                </div>
                {bar(g.amount, g.color)}
              </button>
              {open && (
                <ul className="pb-2">
                  {subs.map((c) => (
                    <li key={`${c.categoryId}-${c.name}`}>
                      <button
                        type="button"
                        onClick={() => select(c)}
                        className={`w-full min-h-11 flex items-center justify-between gap-3 pl-9 pr-4 text-sm text-left cursor-pointer ${
                          isSelected(c) ? 'bg-brand-50 text-brand-700' : 'text-text-secondary'
                        }`}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="tabular-nums whitespace-nowrap">
                          {formatCurrency(c.amount)}
                        </span>
                      </button>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      onClick={() => select(g)}
                      className="w-full min-h-11 pl-9 pr-4 text-left text-sm font-medium text-brand-600 cursor-pointer"
                    >
                      {isSelected(g) ? 'Hide transactions' : `All ${g.name} transactions`}
                    </button>
                  </li>
                </ul>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function CashFlowPage() {
  const showIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const today = new Date();
  const [preset, setPreset] = useState<Preset>('6m');
  const [from, setFrom] = useState(() => format(subMonths(today, 5), 'yyyy-MM'));
  const [to, setTo] = useState(() => format(today, 'yyyy-MM'));
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const txSectionRef = useRef<HTMLDivElement>(null);
  // Phones start with the list; the diagram is there too, scrolling sideways
  const isPhone = useIsPhone();
  const [phoneView, setPhoneView] = useState<'list' | 'diagram'>('list');
  const showList = isPhone && phoneView === 'list';

  useEffect(() => {
    if (preset === 'custom') return;
    const now = new Date();
    const ranges: Record<string, { from: string; to: string }> = {
      '1m': { from: format(now, 'yyyy-MM'), to: format(now, 'yyyy-MM') },
      '3m': { from: format(subMonths(now, 2), 'yyyy-MM'), to: format(now, 'yyyy-MM') },
      '6m': { from: format(subMonths(now, 5), 'yyyy-MM'), to: format(now, 'yyyy-MM') },
      ytd: { from: format(startOfYear(now), 'yyyy-MM'), to: format(now, 'yyyy-MM') },
      'last-year': {
        from: format(startOfYear(subYears(now, 1)), 'yyyy-MM'),
        to: format(endOfYear(subYears(now, 1)), 'yyyy-MM'),
      },
    };
    const r = ranges[preset];
    setFrom(r.from);
    setTo(r.to);
  }, [preset]);

  useEffect(() => {
    setSelectedNode(null);
  }, [from, to]);

  const { data: incData = [] } = useIncomeByCategory(from, to);
  const { data: spData = [] } = useSpendingByCategory(from, to);

  const statCards = useMemo((): StatCard[] => {
    const totalIncome = incData.reduce((s, d) => s + d.totalReceived, 0);
    const totalExpenses = spData.reduce((s, d) => s + d.totalSpent, 0);
    const net = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? (net / totalIncome) * 100 : 0;
    return [
      { label: 'Total income', value: formatCurrency(totalIncome), tone: 'positive' },
      { label: 'Total expenses', value: formatCurrency(totalExpenses), tone: 'negative' },
      {
        label: 'Total net income',
        value: formatCurrency(net),
        tone: net < 0 ? 'negative' : undefined,
      },
      {
        label: 'Savings rate',
        value: `${savingsRate.toFixed(1)}%`,
        tone: savingsRate < 0 ? 'negative' : undefined,
      },
    ];
  }, [incData, spData]);

  const handleNodeClick = useCallback((node: SelectedNode | null) => {
    setSelectedNode(node);
    if (node) {
      setTimeout(() => {
        txSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, []);

  function handleExport() {
    downloadCsv(
      `cash-flow-${from}-${to}.csv`,
      spData.map((d) => ({
        category: `${showIcons && d.categoryIcon ? d.categoryIcon + ' ' : ''}${d.categoryName ?? 'Uncategorized'}`,
        group: d.groupName ?? '',
        total_cents: d.totalSpent,
      })),
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-text shrink-0">Cash Flow</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex flex-wrap gap-0">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  className={`px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors border-b-2 cursor-pointer ${
                    preset === p.id
                      ? 'border-brand-600 text-brand-600'
                      : 'border-transparent text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <MonthRangePicker
                from={from}
                to={to}
                onChange={(f, t) => {
                  setFrom(f);
                  setTo(t);
                }}
                defaultOpen
              />
            )}
            <Button variant="secondary" size="sm" onClick={handleExport}>
              <Download size={13} /> Export CSV
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <StatCardRow cards={statCards} variant="hero" />
        {isPhone && (
          <div className="flex items-center justify-between gap-3 mt-5 mb-3">
            <div
              role="group"
              aria-label="Show as"
              className="flex border border-border rounded-md overflow-hidden"
            >
              {(
                [
                  ['list', 'List'],
                  ['diagram', 'Diagram'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={phoneView === id}
                  onClick={() => setPhoneView(id)}
                  className={`min-h-11 px-4 text-sm font-medium cursor-pointer ${
                    phoneView === id ? 'bg-surface-alt text-text' : 'text-text-tertiary'
                  } ${id === 'diagram' ? 'border-l border-border' : ''}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {!showList && (
              <p className="text-xs text-text-tertiary text-right">Swipe to see it all</p>
            )}
          </div>
        )}
        {showList ? (
          <CashFlowList
            from={from}
            to={to}
            selectedNode={selectedNode}
            onNodeClick={handleNodeClick}
          />
        ) : (
          // Phones: the diagram scrolls sideways on its own, edge to edge
          <div className="w-full max-md:overflow-x-auto max-md:-mx-6 max-md:px-6 max-md:w-auto">
            <SankeyDiagram
              from={from}
              to={to}
              selectedNode={selectedNode}
              onNodeClick={handleNodeClick}
            />
          </div>
        )}

        {selectedNode && (
          <div ref={txSectionRef} className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-text">Transactions: {selectedNode.name}</h2>
              <button
                onClick={() => setSelectedNode(null)}
                className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors"
              >
                <X size={14} /> Clear
              </button>
            </div>
            <div className="bg-surface rounded-lg shadow-card border border-border-light overflow-hidden">
              <TransactionTable
                categoryId={
                  selectedNode.nodeType === 'subcategory' && selectedNode.categoryId
                    ? selectedNode.categoryId
                    : undefined
                }
                categoryGroupId={
                  selectedNode.nodeType === 'expense-group' && selectedNode.groupId
                    ? selectedNode.groupId
                    : undefined
                }
                overlayDetail
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
