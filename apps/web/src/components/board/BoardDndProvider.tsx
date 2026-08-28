import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Over,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { BoardResponse, Label, Status, TaskSummary, Transition } from '@flowboard/shared';

import type { TaskFilterInput } from '@/hooks/useTasks';
import { checkDrop, useMoveTask, type DropCheck } from '@/hooks/useTaskMutations';
import type { SwimlaneMode } from '@/stores/useBoardFilterStore';
import { laneKeyOf } from '@/components/board/swimlanes';
import {
  asDragData,
  isAfterOverCentre,
  planDrop,
  type BoardDragCard,
} from '@/components/board/dnd';
import { BoardCardOverlay } from '@/components/board/BoardCardOverlay';
import { taskKeyOf } from '@/components/board/BoardCard';

/**
 * The board's drag runtime: sensors, collision detection, the drop pre-check,
 * and the one call to `move()` at the end of it.
 *
 * ═══ THE DIVISION OF LABOUR ════════════════════════════════════════════════
 *
 *   `dnd.ts`         pure — which container, which index, what intent.
 *   `swimlanes.ts`   pure — lane grouping and the lane→column index mapping.
 *   THIS FILE        impure — the DOM events, the React state, the mutation.
 *   `useMoveTask`    the optimistic cache write, the rollback, the toast.
 *
 * Nothing here computes a rank or touches the query cache; nothing in the two
 * pure modules knows what a pointer is. That split is what makes the drag
 * testable at all.
 *
 * ═══ FORBIDDEN DROPS ═══════════════════════════════════════════════════════
 *
 * `checkDrop` is evaluated for EVERY column at drag START, not per hover. Two
 * reasons: the answer cannot change while one card is in the air (it depends on
 * the source status, the transition set and the column counts, all frozen for
 * the duration), and every column needs its answer simultaneously — the tint
 * that tells you where you may NOT go has to be visible before you get there,
 * not after you arrive. The server re-checks every move regardless, so this is
 * feedback, not enforcement.
 */

/** What the columns read while a card is in the air. */
export interface BoardDragState {
  /** The card being dragged, or `null` when nothing is. */
  activeTask: TaskSummary | null;
  activeDrag: BoardDragCard | null;
  /** The column currently under the pointer / keyboard cursor. */
  overStatusId: string | null;
  /** One verdict per status id, computed at drag start. Empty when idle. */
  dropChecks: Readonly<Record<string, DropCheck>>;
}

const IDLE: BoardDragState = {
  activeTask: null,
  activeDrag: null,
  overStatusId: null,
  dropChecks: {},
};

/**
 * Exported so a test can put a column into a mid-drag state without a pointer.
 * Application code reads it through {@link useBoardDrag} and never provides it —
 * `BoardDndProvider` is the only writer.
 */
export const BoardDragContext = createContext<BoardDragState>(IDLE);

/** The idle value, for a test's or a caller's baseline. */
export const IDLE_DRAG: BoardDragState = IDLE;

/** The current drag, for columns and lane cells that need to style themselves. */
export function useBoardDrag(): BoardDragState {
  return useContext(BoardDragContext);
}

/**
 * Collision detection, tuned for columns that contain lists.
 *
 * A LADDER, not a single algorithm, because the three situations a board drag
 * produces want different answers:
 *
 *   1. `pointerWithin` — the pointer is inside a droppable. The most precise
 *      answer there is, and the one that makes dropping into a narrow gap
 *      between two cards feel exact.
 *   2. `rectIntersection` — the pointer has left every droppable (the gutter
 *      between columns, or below the last card) but the dragged card still
 *      overlaps one. Falling through to this is what stops a drag "letting go"
 *      when the pointer strays a few pixels.
 *   3. `closestCorners` — nothing overlaps at all. This is also the KEYBOARD
 *      path: a keyboard drag has no pointer, so the first two always return
 *      nothing and this is what actually drives it. `closestCorners` rather
 *      than `closestCenter` because a tall column and a short card compare
 *      badly by centre — the column's centre can be hundreds of pixels from
 *      any card in it.
 */
const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;

  const rectCollisions = rectIntersection(args);
  if (rectCollisions.length > 0) return rectCollisions;

  return closestCorners(args);
};

/** Droppables are re-measured continuously so empty lane cells are hit-testable. */
const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };

export interface BoardDndProviderProps {
  projectId: string;
  projectKey: string;
  /** MUST be the same object handed to `useBoard` — see `useMoveTask`'s docs. */
  filters: TaskFilterInput;
  board: BoardResponse;
  statuses: readonly Status[];
  transitions: readonly Transition[];
  mode: SwimlaneMode;
  labelsById: ReadonlyMap<string, Label>;
  children: ReactNode;
}

export function BoardDndProvider({
  projectId,
  projectKey,
  filters,
  board,
  statuses,
  transitions,
  mode,
  labelsById,
  children,
}: BoardDndProviderProps) {
  const { t } = useTranslation(['board']);
  const { move } = useMoveTask({ projectId, filters });
  const [drag, setDrag] = useState<BoardDragState>(IDLE);

  const sensors = useSensors(
    // 4px of travel before a drag begins — below that it is a click, which is
    // what makes the whole card both a drag handle and an "open" target.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // SPACE picks up and drops; ENTER is deliberately NOT a drag activator so
      // it stays free to OPEN the card (see `BoardCard`). Escape cancels, which
      // is also what the shell's global Escape does — dnd-kit calls
      // `preventDefault`, so the two never fire together.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const statusById = useMemo(
    () => new Map(statuses.map((status) => [status.id, status])),
    [statuses],
  );

  const findTask = useCallback(
    (taskId: string): TaskSummary | null => {
      for (const column of Object.values(board.columns)) {
        const found = column.find((task) => task.id === taskId);
        if (found) return found;
      }
      return null;
    },
    [board],
  );

  const statusName = useCallback(
    (statusId: string | null | undefined): string => statusById.get(statusId ?? '')?.name ?? '',
    [statusById],
  );

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const active = asDragData(event.active.data.current);
      if (!active || active.type !== 'card') return;

      const task = findTask(active.taskId);
      if (!task) return;

      // Every column's verdict, once. See the header note.
      const dropChecks: Record<string, DropCheck> = {};
      for (const status of statuses) {
        dropChecks[status.id] = checkDrop({
          fromStatusId: active.statusId,
          targetStatus: status,
          targetCount: (board.columns[status.id] ?? []).length,
          transitions,
        });
      }

      setDrag({ activeTask: task, activeDrag: active, overStatusId: active.statusId, dropChecks });
    },
    [board.columns, findTask, statuses, transitions],
  );

  const onDragOver = useCallback((event: DragOverEvent) => {
    const over = asDragData(event.over?.data.current);
    setDrag((current) =>
      current.overStatusId === (over?.statusId ?? null)
        ? current
        : { ...current, overStatusId: over?.statusId ?? null },
    );
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const active = asDragData(event.active.data.current);
      const over = asDragData(event.over?.data.current);
      const checks = drag.dropChecks;
      setDrag(IDLE);

      if (!active || active.type !== 'card' || !over) return;

      const verdict = checks[over.statusId];
      if (verdict && !verdict.allowed) {
        const target = statusById.get(over.statusId);
        toast.error(
          verdict.reason === 'wip'
            ? t('board:drop.wip', {
                status: target?.name ?? '',
                limit: verdict.wip.limit ?? 0,
              })
            : t('board:drop.transition', {
                from: statusName(active.statusId),
                to: target?.name ?? '',
              }),
        );
        return;
      }

      const columnTasks = board.columns[over.statusId] ?? [];
      const overItems = (
        mode === 'none'
          ? columnTasks
          : columnTasks.filter((task) => laneKeyOf(task, mode) === over.laneId)
      ).map((task) => task.id);

      const intent = planDrop({
        active,
        over,
        overItems,
        columnTasks,
        mode,
        after: isAfterOverCentre(event.active.rect.current.translated, event.over?.rect),
      });

      if (intent) move(intent);
    },
    [board.columns, drag.dropChecks, mode, move, statusById, statusName, t],
  );

  const onDragCancel = useCallback(() => {
    setDrag(IDLE);
  }, []);

  /**
   * Screen-reader narration. Without it a keyboard drag is silent — the card
   * moves and nothing says so — which makes the feature technically present and
   * practically unusable.
   */
  const announcements = useMemo<Announcements>(() => {
    const keyOf = (active: Active): string => {
      const data = asDragData(active.data.current);
      if (!data || data.type !== 'card') return String(active.id);
      const task = findTask(data.taskId);
      return task ? taskKeyOf(projectKey, task) : String(active.id);
    };
    const columnOf = (over: Over | null | undefined): string =>
      statusName(asDragData(over?.data.current)?.statusId);

    return {
      onDragStart: ({ active }) =>
        t('board:dnd.picked', {
          key: keyOf(active),
          status: statusName(asDragData(active.data.current)?.statusId),
        }),
      onDragOver: ({ active, over }) =>
        over ? t('board:dnd.over', { key: keyOf(active), status: columnOf(over) }) : undefined,
      onDragEnd: ({ active, over }) =>
        over ? t('board:dnd.dropped', { key: keyOf(active), status: columnOf(over) }) : undefined,
      onDragCancel: ({ active }) =>
        t('board:dnd.cancelled', {
          key: keyOf(active),
          status: statusName(asDragData(active.data.current)?.statusId),
        }),
    };
  }, [findTask, projectKey, statusName, t]);

  const screenReaderInstructions = useMemo(() => ({ draggable: t('board:dnd.instructions') }), [t]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      measuring={MEASURING}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <BoardDragContext.Provider value={drag}>{children}</BoardDragContext.Provider>

      {/* The card in the air. Rendered outside every scroll container, which is
          the only way it can cross between two independently scrolling columns
          without being clipped by the one it left. */}
      <DragOverlay>
        {drag.activeTask ? (
          <BoardCardOverlay
            task={drag.activeTask}
            projectKey={projectKey}
            labelsById={labelsById}
            resolved={statusById.get(drag.activeTask.statusId)?.category === 'done'}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default BoardDndProvider;
