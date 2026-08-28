import { useMemo } from 'react';
import type { VirtualItem } from '@tanstack/react-virtual';

import { ROW_HEIGHT, type GanttGeometry } from '@/components/gantt/useGanttGeometry';
import { rowSpan, type GanttRow } from '@/components/gantt/gantt-rows';
import { dependencyPath, edgeKey, type DependencyEdge } from '@/components/gantt/gantt-arrows';

/**
 * The `blocks` arrows — an SVG overlay across the whole canvas.
 *
 * ═══ WHY IT IS DRAWN FROM THE VIRTUALIZER'S ITEMS ═════════════════════════
 *
 * An arrow needs a y for each end, and the only place a y exists is the
 * virtualizer's `VirtualItem.start`. Rows outside the window HAVE no y — they
 * are not rendered — so an edge to one of them cannot be drawn, only guessed
 * at. Rather than guess, an edge is drawn only when BOTH endpoints are in the
 * current window, which also means the arrow set is recomputed on scroll for
 * free: new items in, new paths out, no scroll listener of its own.
 *
 * The consequence is honest and visible: scrolling one end of a long
 * dependency out of view removes its arrow. The alternative — clamping the
 * offscreen end to the canvas edge — draws a line to a task that is not there,
 * which is worse than drawing nothing.
 *
 * ═══ COORDINATES ═════════════════════════════════════════════════════════
 *
 * The SVG's `left-0` is PHYSICAL on purpose — it is inside the canvas's
 * `dir="ltr"` island (see `GanttChart`), where x is time and does not mirror.
 *
 * The SVG spans the ENTIRE scroll content (including the axis strip), so
 * `item.start` — which already carries the virtualizer's `paddingStart` —
 * is usable as a y with no offset arithmetic. x comes from `geometry.barRect`,
 * the same call the bars themselves are placed with, which is what guarantees
 * an arrowhead lands on a bar's edge rather than near it.
 *
 * `pointer-events: none` on the SVG with `pointer-events: stroke` on a fat
 * transparent hit path: the arrows must be hoverable without stealing a drag
 * that starts on a bar underneath them.
 */

/** The arrowhead marker's id. One chart per page, so a constant is enough. */
const ARROW_MARKER_ID = 'fb-gantt-arrowhead';

export interface GanttDependencyLayerProps {
  rows: readonly GanttRow[];
  items: readonly VirtualItem[];
  geometry: GanttGeometry;
  edges: readonly DependencyEdge[];
  /** Task id → row index, for the rows currently in the model. */
  rowIndex: ReadonlyMap<string, number>;
  /** Total height of the canvas's scroll content. */
  height: number;
  /** Both endpoints of the hovered arrow, lifted so the bars can light up. */
  hoveredEdge: string | null;
  onHoverEdge: (edge: DependencyEdge | null) => void;
}

export function GanttDependencyLayer({
  rows,
  items,
  geometry,
  edges,
  rowIndex,
  height,
  hoveredEdge,
  onHoverEdge,
}: GanttDependencyLayerProps) {
  const paths = useMemo(() => {
    /** Row index → y of the row's vertical centre, for the WINDOW only. */
    const centreByIndex = new Map<number, number>();
    for (const item of items) centreByIndex.set(item.index, item.start + ROW_HEIGHT / 2);

    const out: { key: string; d: string; edge: DependencyEdge }[] = [];

    for (const edge of edges) {
      const fromIndex = rowIndex.get(edge.blockerId);
      const toIndex = rowIndex.get(edge.blockedId);
      if (fromIndex === undefined || toIndex === undefined) continue;

      const fromY = centreByIndex.get(fromIndex);
      const toY = centreByIndex.get(toIndex);
      if (fromY === undefined || toY === undefined) continue;

      const fromRow = rows[fromIndex];
      const toRow = rows[toIndex];
      if (!fromRow || !toRow) continue;

      const fromSpan = rowSpan(fromRow);
      const toSpan = rowSpan(toRow);
      if (fromSpan === null || toSpan === null) continue;

      const fromRect = geometry.barRect(fromSpan);
      const toRect = geometry.barRect(toSpan);
      if (fromRect === null || toRect === null) continue;

      out.push({
        key: edgeKey(edge),
        // Blocker's END → blocked task's START: the arrow traces the constraint
        // ("this cannot begin until that has finished"), not the two tasks.
        d: dependencyPath({ x: fromRect.x + fromRect.width, y: fromY }, { x: toRect.x, y: toY }),
        edge,
      });
    }

    return out;
  }, [edges, items, rows, rowIndex, geometry]);

  if (paths.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-10 overflow-visible"
      width={geometry.totalWidth}
      height={height}
      aria-hidden
      data-testid="gantt-dependency-layer"
    >
      <defs>
        <marker
          id={ARROW_MARKER_ID}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
        </marker>
      </defs>

      {paths.map((path) => {
        const active = hoveredEdge === path.key;
        return (
          <g
            key={path.key}
            className={active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}
            onMouseEnter={() => {
              onHoverEdge(path.edge);
            }}
            onMouseLeave={() => {
              onHoverEdge(null);
            }}
          >
            {/* The hit target: invisible, 10px wide, stroke-only pointer events. */}
            <path
              d={path.d}
              fill="none"
              stroke="transparent"
              strokeWidth={10}
              style={{ pointerEvents: 'stroke' }}
            />
            <path
              d={path.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={active ? 1.75 : 1}
              strokeOpacity={active ? 1 : 0.75}
              markerEnd={`url(#${ARROW_MARKER_ID})`}
            />
          </g>
        );
      })}
    </svg>
  );
}

export default GanttDependencyLayer;
