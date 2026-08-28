import type { BoardResponse, TaskPriority, TaskSummary } from '@flowboard/shared';

import type { SwimlaneMode } from '@/stores/useBoardFilterStore';

/**
 * Swimlanes — the board's optional horizontal grouping, and the index
 * arithmetic that keeps a lane-relative drop honest against the column-relative
 * move contract.
 *
 * ═══ THE PROBLEM THIS FILE SOLVES ══════════════════════════════════════════
 *
 * `useMoveTask`'s intent is column-relative: `toIndex` is a position within the
 * TARGET COLUMN, counted after the dragged card has been lifted out (dnd-kit's
 * sortable semantics). But when swimlanes are on, a column is drawn as several
 * stacked CELLS and dnd-kit reports an index within one cell. Handing that
 * number straight to `move()` would place a card by counting only its own
 * lane's members — dropping "second in the Bugs lane" into a column whose first
 * five cards belong to other lanes would compute neighbours five cards too high
 * and produce a rank that renders somewhere else entirely.
 *
 * {@link laneIndexToColumnIndex} is the translation. Everything here is a pure
 * function over plain data for the same reason `lib/board-cache.ts` is: the
 * arithmetic is the part that can be wrong, and it is testable without React,
 * dnd-kit, or a DOM.
 *
 * ═══ WHAT A LANE IS ════════════════════════════════════════════════════════
 *
 * A lane is identified by a KEY derived from a card ({@link laneKeyOf}) — an
 * assignee id, an epic id, a priority literal. Cards with no value for the
 * grouping field fall into the {@link NO_LANE} bucket, which always sorts LAST:
 * "Unassigned" is a residue, not a person, and floating it to the top of the
 * board pushes the actual work down.
 */

/** The bucket for cards with no value for the current grouping. */
export const NO_LANE = 'none';

/** The single implicit lane when grouping is off — never rendered as a header. */
export const ALL_LANE = '*';

/**
 * Priority lanes run highest → lowest.
 *
 * Fixed rather than first-appearance order (which is what the id-based modes
 * use): priority is an ORDERED scale, and a board whose "Highest" lane sits
 * below "Low" because no highest-priority card happened to be first in the
 * to-do column is actively misleading.
 */
export const PRIORITY_LANE_ORDER: readonly TaskPriority[] = [
  'highest',
  'high',
  'medium',
  'low',
  'lowest',
];

/**
 * Which lane a card belongs to, under one grouping mode.
 *
 * `priority` never yields {@link NO_LANE} — the contract makes it a required
 * enum — which is why the priority mode has no "none" lane at all.
 */
export function laneKeyOf(task: TaskSummary, mode: SwimlaneMode): string {
  switch (mode) {
    case 'assignee':
      return task.assignee?.id ?? NO_LANE;
    case 'epic':
      return task.epicId ?? NO_LANE;
    case 'priority':
      return task.priority;
    case 'none':
      return ALL_LANE;
  }
}

/** One lane: its id, its per-column cards, and its total across the board. */
export interface Swimlane {
  /** The lane key — a user id, an epic id, a priority literal, or `none`. */
  id: string;
  /** Cards of this lane, per status id, each preserving the column's order. */
  columns: Record<string, TaskSummary[]>;
  /** How many cards the lane holds across every column. */
  count: number;
}

/**
 * Groups a board into lanes.
 *
 * `statusIds` is passed rather than read off the board because the COLUMN SET
 * is the project's workflow, not whatever the response happened to include: a
 * column with no cards is still a column, and scanning `board.columns` alone
 * would silently drop it from every lane.
 *
 * LANE ORDER. `priority` uses {@link PRIORITY_LANE_ORDER} (an ordered scale);
 * `assignee` and `epic` use FIRST-APPEARANCE order, scanning columns in board
 * order — which keeps the lane stack stable across renders and puts the lanes
 * with early to-do work at the top. {@link NO_LANE} is always last.
 *
 * Modes other than `none` emit a lane only when it holds at least one card: an
 * empty lane per org member would be a board of headers.
 */
export function groupIntoSwimlanes(
  board: BoardResponse,
  statusIds: readonly string[],
  mode: SwimlaneMode,
): Swimlane[] {
  const emptyColumns = (): Record<string, TaskSummary[]> =>
    Object.fromEntries(statusIds.map((statusId) => [statusId, [] as TaskSummary[]]));

  if (mode === 'none') {
    const columns = emptyColumns();
    let count = 0;
    for (const statusId of statusIds) {
      const tasks = board.columns[statusId] ?? [];
      columns[statusId] = [...tasks];
      count += tasks.length;
    }
    return [{ id: ALL_LANE, columns, count }];
  }

  const lanes = new Map<string, Swimlane>();
  /** Insertion order for the id-based modes; ignored by `priority`. */
  const seen: string[] = [];

  for (const statusId of statusIds) {
    for (const task of board.columns[statusId] ?? []) {
      const laneId = laneKeyOf(task, mode);
      let lane = lanes.get(laneId);
      if (!lane) {
        lane = { id: laneId, columns: emptyColumns(), count: 0 };
        lanes.set(laneId, lane);
        seen.push(laneId);
      }
      lane.columns[statusId]?.push(task);
      lane.count += 1;
    }
  }

  const order =
    mode === 'priority'
      ? PRIORITY_LANE_ORDER.filter((priority) => lanes.has(priority))
      : seen.filter((laneId) => laneId !== NO_LANE);

  const ordered = order
    .map((laneId) => lanes.get(laneId))
    .filter((lane): lane is Swimlane => lane !== undefined);

  // The residue bucket, always last.
  const residue = lanes.get(NO_LANE);
  if (residue && mode !== 'priority') ordered.push(residue);

  return ordered;
}

/**
 * Translates a LANE-relative drop index into the COLUMN-relative `toIndex` that
 * `useMoveTask`'s `move()` takes.
 *
 * @param columnTasks the full target column with the dragged card ALREADY
 *   lifted out — the same list `planBoardMove` will read its neighbours from,
 *   so the two cannot disagree about what index N means.
 * @param laneIndex the insertion index within the lane's cell of that column,
 *   likewise counted with the dragged card lifted out.
 *
 * ── THE THREE CASES ────────────────────────────────────────────────────────
 *
 * 1. **Insert before an existing lane member** (`laneIndex` addresses one) —
 *    return that member's position in the full column. `planRank` then computes
 *    a rank between it and whatever physically precedes it, which may belong to
 *    another lane. That is correct and invisible: lanes are a VIEW, and the
 *    only thing the user can observe is that the card lands before that member
 *    inside its own lane.
 * 2. **Append after the lane's last member** (`laneIndex >= members`) — return
 *    that member's position + 1.
 * 3. **The lane is empty in this column** — return the column's length, i.e.
 *    the end. There is no lane member to anchor to, and the rank a card gets
 *    within a column has no bearing on which LANE CELL it renders in (that is
 *    decided by its own field), so appending is both correct and the least
 *    surprising: the card appears at the top of a cell that had nothing in it.
 *
 * With `mode: 'none'` the lane IS the column, so the index passes through.
 */
export function laneIndexToColumnIndex(
  columnTasks: readonly TaskSummary[],
  mode: SwimlaneMode,
  laneId: string,
  laneIndex: number,
): number {
  if (mode === 'none') {
    return Math.min(Math.max(laneIndex, 0), columnTasks.length);
  }

  const positions: number[] = [];
  for (const [index, task] of columnTasks.entries()) {
    if (laneKeyOf(task, mode) === laneId) positions.push(index);
  }

  if (positions.length === 0) return columnTasks.length;

  if (laneIndex <= 0) return positions[0] ?? columnTasks.length;
  if (laneIndex >= positions.length) {
    const last = positions[positions.length - 1];
    return last === undefined ? columnTasks.length : last + 1;
  }
  return positions[laneIndex] ?? columnTasks.length;
}

/**
 * How many cards of `laneId` a column already holds, with `excludeTaskId`
 * lifted out.
 *
 * This is the anchor for a drop that lands in ANOTHER lane's cell. A board move
 * writes `statusId` and `boardRank` and nothing else — it cannot change a
 * card's assignee, epic or priority — so a card dropped on the "Bob" lane stays
 * in the "Alice" lane and simply changes column. Refusing such a drop would
 * make half the board undroppable for no gain; silently pretending the card
 * landed where the pointer was would be a lie. So it lands at the END of its
 * OWN lane's cell in the target column, and {@link laneIndexToColumnIndex}
 * turns that into the column index. See `dnd.ts`'s `resolveDropTarget`.
 */
export function laneCellCount(
  columnTasks: readonly TaskSummary[],
  mode: SwimlaneMode,
  laneId: string,
  excludeTaskId?: string,
): number {
  if (mode === 'none') {
    return columnTasks.filter((task) => task.id !== excludeTaskId).length;
  }
  return columnTasks.filter((task) => task.id !== excludeTaskId && laneKeyOf(task, mode) === laneId)
    .length;
}
