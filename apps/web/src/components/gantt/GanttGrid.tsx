import { memo } from 'react';

import { AXIS_HEIGHT, type GanttGeometry } from '@/components/gantt/useGanttGeometry';

/**
 * The chart's background: weekend shading, one vertical rule per lower-axis
 * cell, and the today line.
 *
 * IT READS THE SAME `axis.lower` THE HEADER DOES. That is not a convenience —
 * it is the reason a gridline is always exactly under the cell that labels it,
 * at every zoom, including the clipped segments at either end of the range.
 * A grid drawn from its own `for` loop over `dayWidth` would agree with the
 * header right up until the range stopped falling on a whole month.
 *
 * Absolutely positioned and `pointer-events-none`, under everything: the bars
 * and the arrow layer must receive the pointer, and the grid must never eat a
 * drag that started a pixel outside a bar.
 *
 * `left-0` and `border-l` ARE PHYSICAL ON PURPOSE: this grid lives inside the
 * canvas's `dir="ltr"` island (see `GanttChart`), where x is time and a rule
 * belongs at the EARLIER edge of its cell in every language. Logicalising them
 * would mirror the rules away from the bars they align with.
 */
export const GanttGrid = memo(function GanttGrid({
  geometry,
  height,
}: {
  geometry: GanttGeometry;
  /** Height of the ROWS region — the canvas total minus the axis. */
  height: number;
}) {
  const { axis, weekendBands, totalWidth, todayX } = geometry;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 z-0"
      style={{ top: AXIS_HEIGHT, width: totalWidth, height }}
    >
      {weekendBands.map((band) => (
        <div
          key={band.key}
          className="absolute top-0 h-full bg-secondary/40"
          style={{ left: band.x, width: band.width }}
        />
      ))}

      {axis.lower.map((segment) => (
        <div
          key={segment.key}
          className="absolute top-0 h-full border-l border-border/40"
          style={{ left: segment.x, width: segment.width }}
        />
      ))}

      {/*
        The today line. `--accent` rather than `--primary`: primary is the
        product's action colour and is already carrying every in-progress bar,
        so a primary line down the chart would read as one more bar.
      */}
      {todayX === null ? null : (
        <div
          className="absolute top-0 h-full w-px bg-[var(--accent)]"
          style={{ left: todayX }}
          data-testid="gantt-today-line"
        />
      )}
    </div>
  );
});

export default GanttGrid;
