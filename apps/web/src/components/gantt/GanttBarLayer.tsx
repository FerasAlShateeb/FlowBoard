import type { VirtualItem } from '@tanstack/react-virtual';
import type { StatusCategory } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { ROW_HEIGHT, type GanttGeometry } from '@/components/gantt/useGanttGeometry';
import type { GanttRow } from '@/components/gantt/gantt-rows';
import GanttBar from '@/components/gantt/GanttBar';

/**
 * The rows of the canvas: one absolutely-positioned strip per virtual item,
 * each holding at most one bar.
 *
 * IT TAKES THE VIRTUALIZER'S ITEMS RATHER THAN THE ROWS. `virtualItem.start` is
 * the authoritative y for a row, and the sidebar is handed the SAME items — so
 * the two panes cannot disagree about where row 47 is even by a pixel, at any
 * scroll offset. Recomputing `index * ROW_HEIGHT` here instead would be right
 * today and wrong the moment a row measured differently.
 *
 * `virtualItem.start` already includes the virtualizer's `paddingStart`
 * (= `AXIS_HEIGHT`), so these tops are absolute within the canvas's scroll
 * content and the axis sits above them without any offset arithmetic here.
 *
 * THE `left-0` UTILITIES HERE ARE PHYSICAL ON PURPOSE. Everything in this file
 * is inside the canvas's `dir="ltr"` island (see `GanttChart`): x is time, and
 * time does not mirror. `start-0` would flip these strips under Arabic while
 * the geometry that positions the bars on them stayed left-origin.
 */
export function GanttBarLayer({
  rows,
  items,
  geometry,
  categoryByStatusId,
  canWrite,
  hoveredTaskIds,
  locale,
  onCommit,
  onOpen,
  onHover,
}: {
  rows: readonly GanttRow[];
  items: readonly VirtualItem[];
  geometry: GanttGeometry;
  categoryByStatusId: ReadonlyMap<string, StatusCategory>;
  canWrite: boolean;
  /** Task ids lit up by a hovered dependency arrow. */
  hoveredTaskIds: ReadonlySet<string>;
  locale: string;
  onCommit: (taskId: string, patch: { startDate: string; dueDate: string }) => Promise<unknown>;
  onOpen: (taskId: string) => void;
  onHover: (taskId: string | null) => void;
}) {
  return (
    <div
      className="absolute left-0 top-0 z-10"
      style={{ width: geometry.totalWidth }}
      data-testid="gantt-bar-layer"
    >
      {items.map((item) => {
        const row = rows[item.index];
        if (!row) return null;

        return (
          <div
            key={row.id}
            className={cn(
              'absolute left-0 border-b border-border/40',
              // A group header has no bar; tinting its whole strip is what makes
              // the "No epic" divider read as a section rather than as a gap.
              row.kind === 'group' && 'bg-surface-raised/60',
            )}
            style={{
              top: item.start,
              height: ROW_HEIGHT,
              width: geometry.totalWidth,
            }}
          >
            {row.kind === 'group' ? null : (
              <GanttBar
                row={row}
                geometry={geometry}
                category={categoryByStatusId.get(row.task.statusId)}
                editable={canWrite}
                highlighted={hoveredTaskIds.has(row.task.id)}
                locale={locale}
                onCommit={onCommit}
                onOpen={onOpen}
                onHover={onHover}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default GanttBarLayer;
