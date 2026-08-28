import type { BoardMoveIntent } from '@/hooks/useTaskMutations';
import type { SwimlaneMode } from '@/stores/useBoardFilterStore';
import { ALL_LANE, laneCellCount, laneIndexToColumnIndex } from '@/components/board/swimlanes';
import type { TaskSummary } from '@flowboard/shared';

/**
 * The board's drag ALGEBRA: everything between "dnd-kit fired an event" and
 * "`move()` gets an intent", as pure functions.
 *
 * WHY IT IS NOT IN THE PROVIDER. `BoardDndProvider` is React plumbing —
 * sensors, a DragOverlay, some state. The part that can actually be WRONG is
 * the index arithmetic: which container was dropped on, where in it, and what
 * that means once swimlanes have folded one column into several cells. Pulling
 * it out makes it testable without a DOM, a pointer, or dnd-kit itself, which
 * is what `dnd.test.ts` asserts.
 *
 * THE INDEX CONVENTION, end to end (do not change one half of it):
 *
 *   dnd-kit sortable index  →  lane-cell index  →  column index  →  `toIndex`
 *
 * Every step counts positions with the DRAGGED CARD ALREADY LIFTED OUT, which
 * is both dnd-kit's `arrayMove` semantics and what `planBoardMove` documents.
 */

/** A draggable card's `data.current`. */
export interface BoardDragCard {
  type: 'card';
  taskId: string;
  statusId: string;
  /** {@link ALL_LANE} when swimlanes are off. */
  laneId: string;
}

/** A droppable list's `data.current` — a column, or one lane cell of one. */
export interface BoardDragContainer {
  type: 'container';
  statusId: string;
  laneId: string;
}

export type BoardDragData = BoardDragCard | BoardDragContainer;

/** Composes the dnd-kit droppable id for one lane cell of one column. */
export function containerId(statusId: string, laneId: string): string {
  return `container:${statusId}:${laneId}`;
}

/** Narrows an opaque `data.current` to our own drag payload. */
export function asDragData(value: unknown): BoardDragData | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<BoardDragCard>;
  if (candidate.type === 'card') {
    return typeof candidate.taskId === 'string' &&
      typeof candidate.statusId === 'string' &&
      typeof candidate.laneId === 'string'
      ? (value as BoardDragCard)
      : null;
  }
  if (candidate.type === 'container') {
    const container = value as Partial<BoardDragContainer>;
    return typeof container.statusId === 'string' && typeof container.laneId === 'string'
      ? (value as BoardDragContainer)
      : null;
  }
  return null;
}

/** A rectangle, reduced to the two numbers the drop side depends on. */
export interface VerticalRect {
  top: number;
  height: number;
}

/**
 * Does the dragged card's CENTRE sit past the centre of the card it is over?
 *
 * Centres rather than edges: comparing the top of one box with the bottom of
 * another makes the answer depend on the two cards' relative heights, so a
 * tall card and a short one behave differently for the same pointer position.
 * Centre-vs-centre is the rule the sortable preview draws, and it is stable
 * under any card size.
 *
 * Only consulted for a CROSS-CONTAINER drop. Within one container the sortable
 * strategy has already reordered the preview, and its `overIndex` is the answer
 * (see {@link resolveDropTarget}).
 */
export function isAfterOverCentre(
  active: VerticalRect | null | undefined,
  over: VerticalRect | null | undefined,
): boolean {
  if (!active || !over) return false;
  return active.top + active.height / 2 > over.top + over.height / 2;
}

/** Where a drop lands: a column, and an index inside the ACTIVE card's lane. */
export interface DropTarget {
  toStatusId: string;
  /**
   * Always the ACTIVE card's lane — never the lane whose cell was hovered. A
   * board move cannot change the field a lane groups by, so the card stays in
   * its own lane whatever cell it was released over.
   */
  laneId: string;
  /** Index within that lane's cell of `toStatusId`, dragged card lifted out. */
  laneIndex: number;
}

/**
 * Resolves a dnd-kit drop into a lane-relative target.
 *
 * @param overItems the card ids in the OVER container, in render order,
 *   INCLUDING the active card when it is one of them.
 * @param ownLaneCount how many cards the active card's own lane already has in
 *   the target column, dragged card lifted out — the append position used when
 *   the drop landed on a foreign lane's cell.
 * @param after result of {@link isAfterOverCentre}; ignored unless the drop is
 *   over a card in a DIFFERENT container.
 */
export function resolveDropTarget(args: {
  active: BoardDragCard;
  over: BoardDragData;
  overItems: readonly string[];
  ownLaneCount: number;
  after: boolean;
}): DropTarget {
  const { active, over, overItems, ownLaneCount, after } = args;
  const toStatusId = over.statusId;

  // A foreign lane cell: the move changes the COLUMN only, so the card lands at
  // the end of its own lane's cell there. See `swimlanes.laneCellCount`.
  if (over.laneId !== active.laneId) {
    return { toStatusId, laneId: active.laneId, laneIndex: ownLaneCount };
  }

  const lifted = overItems.filter((id) => id !== active.taskId);

  // Dropped on the container itself — the padding under the last card, or an
  // empty cell. That reads as "put it at the end".
  if (over.type === 'container') {
    return { toStatusId, laneId: active.laneId, laneIndex: lifted.length };
  }

  const overIndex = overItems.indexOf(over.taskId);
  if (overIndex === -1) {
    // The over card is not in the list we were given — a board that changed
    // under the drag. Appending is the only defensible answer.
    return { toStatusId, laneId: active.laneId, laneIndex: lifted.length };
  }

  const sameContainer = over.statusId === active.statusId;

  if (sameContainer) {
    // `arrayMove(items, from, to)` splices the card out and re-inserts it at
    // `to` — so `overIndex`, read from the list that still CONTAINS the card,
    // is already the insertion index into the lifted list. That is exactly what
    // the sortable strategy previewed, so the card lands where the gap was.
    return { toStatusId, laneId: active.laneId, laneIndex: overIndex };
  }

  // Cross-column, same lane: `lifted` equals `overItems` (the card is not in
  // it), so the over card's index is "insert before" and +1 is "insert after".
  return { toStatusId, laneId: active.laneId, laneIndex: overIndex + (after ? 1 : 0) };
}

/**
 * The last step: a lane-relative target plus the target column's contents
 * become the column-relative {@link BoardMoveIntent} `move()` takes.
 *
 * `columnTasks` is the target column STRAIGHT FROM THE BOARD CACHE — this
 * function lifts the dragged card out itself, so callers cannot get that half
 * wrong (and a same-column reorder cannot compute its neighbours against its
 * own old position, which is what `rankBetween` rejects).
 */
export function toMoveIntent(args: {
  active: BoardDragCard;
  target: DropTarget;
  columnTasks: readonly TaskSummary[];
  mode: SwimlaneMode;
}): BoardMoveIntent {
  const { active, target, columnTasks, mode } = args;
  const lifted = columnTasks.filter((task) => task.id !== active.taskId);

  return {
    taskId: active.taskId,
    fromStatusId: active.statusId,
    toStatusId: target.toStatusId,
    toIndex: laneIndexToColumnIndex(lifted, mode, target.laneId, target.laneIndex),
  };
}

/**
 * The whole pipeline in one call — what `onDragEnd` uses, and what a test can
 * drive with plain objects.
 *
 * Returns `null` when the drop is a no-op (nothing under the pointer, or the
 * card released exactly where it started), so the caller never fires a mutation
 * for a drag that did not move anything.
 */
export function planDrop(args: {
  active: BoardDragCard;
  over: BoardDragData | null;
  overItems: readonly string[];
  columnTasks: readonly TaskSummary[];
  mode: SwimlaneMode;
  after: boolean;
}): BoardMoveIntent | null {
  const { active, over, overItems, columnTasks, mode, after } = args;
  if (!over) return null;

  const ownLaneCount = laneCellCount(columnTasks, mode, active.laneId, active.taskId);
  const target = resolveDropTarget({ active, over, overItems, ownLaneCount, after });
  const intent = toMoveIntent({ active, target, columnTasks, mode });

  if (intent.fromStatusId === intent.toStatusId) {
    const currentIndex = columnTasks.findIndex((task) => task.id === active.taskId);
    // A same-column drop whose index is unchanged moves nothing. `currentIndex`
    // is read from the list that still holds the card, and `toIndex` from the
    // lifted one, so the card staying put means `toIndex === currentIndex`.
    if (currentIndex !== -1 && intent.toIndex === currentIndex) return null;
  }

  return intent;
}

/** The lane id a card carries when swimlanes are off. Re-exported for callers. */
export { ALL_LANE };
