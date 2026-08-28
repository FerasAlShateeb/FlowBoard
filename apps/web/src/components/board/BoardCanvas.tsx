import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import type {
  BoardResponse,
  Label,
  Status,
  TaskPriority,
  TaskSummary,
  Transition,
} from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useTaskList, type TaskFilterInput } from '@/hooks/useTasks';
import {
  laneStorageKey,
  useBoardFilterStore,
  type SwimlaneMode,
} from '@/stores/useBoardFilterStore';
import { UserAvatar } from '@/components/common/UserAvatar';
import { BoardColumn, BoardColumnHeader, COLUMN_WIDTH } from '@/components/board/BoardColumn';
import { BoardDndProvider } from '@/components/board/BoardDndProvider';
import { QuickAddCard } from '@/components/board/QuickAddCard';
import { SwimlaneSection } from '@/components/board/SwimlaneSection';
import { PriorityIcon } from '@/components/common/task-icons';
import { useTaskVocabulary } from '@/components/common/task-vocabulary';
import { NO_LANE, groupIntoSwimlanes, type Swimlane } from '@/components/board/swimlanes';

/**
 * The scrolling board itself: the drag runtime, the columns, and — when
 * grouping is on — the lane stack.
 *
 * ── TWO LAYOUTS, ONE DRAG ──────────────────────────────────────────────────
 * With swimlanes OFF each column is a self-contained scroller: header pinned,
 * cards scrolling under it, composer pinned at the foot. With swimlanes ON that
 * is impossible — lanes cut across every column, so a per-column scrollbar
 * would let one column's lane 3 sit beside another's lane 1 — and the whole
 * canvas becomes one two-dimensional scroll area with the column headers stuck
 * to its top and the lane labels stuck to its reading start.
 *
 * Both feed the SAME drag contract: a droppable per (column × lane) cell, and
 * `dnd.ts` translating whatever dnd-kit reports into one column-relative
 * `toIndex`. See `swimlanes.laneIndexToColumnIndex` for that arithmetic.
 *
 * ── WHY THE HORIZONTAL SCROLLER BLEEDS PAST THE PAGE PADDING ───────────────
 * `-mx-[var(--page-pad)]` + matching padding: the columns scroll all the way to
 * the window edge instead of stopping inside a gutter, which is what makes a
 * six-column board feel like a board rather than a widget. The symmetric
 * margin is direction-agnostic, so RTL needs no second rule — and the browser
 * flips `overflow-x` itself once `<html dir>` is `rtl`.
 */

/**
 * Epics for the `epic` swimlane labels.
 *
 * A module CONSTANT so its identity is stable — `qk.tasks.list` hashes the
 * filter's CONTENTS, but a fresh object every render would still churn the
 * `useTaskList` call's props for no reason.
 */
const EPIC_FILTER: TaskFilterInput = { type: ['epic'] };

/** Board height: the viewport minus the shell chrome, header and filter bar. */
const CANVAS_HEIGHT = 'h-[calc(100dvh-15rem)] min-h-[20rem]';

/** The first card of a lane, whichever column it is in. */
function firstTaskOf(lane: Swimlane): TaskSummary | undefined {
  for (const tasks of Object.values(lane.columns)) {
    const first = tasks[0];
    if (first) return first;
  }
  return undefined;
}

export interface BoardCanvasProps {
  projectId: string;
  projectKey: string;
  statuses: readonly Status[];
  labels: readonly Label[];
  transitions: readonly Transition[];
  board: BoardResponse;
  /** The SAME object `useBoard` was given — see `useMoveTask`'s contract. */
  filters: TaskFilterInput;
  mode: SwimlaneMode;
  collapsedLanes: readonly string[];
  canWrite: boolean;
}

export function BoardCanvas({
  projectId,
  projectKey,
  statuses,
  labels,
  transitions,
  board,
  filters,
  mode,
  collapsedLanes,
  canWrite,
}: BoardCanvasProps) {
  const { t } = useTranslation(['board']);
  const vocabulary = useTaskVocabulary();
  const navigate = useNavigate();
  const toggleLane = useBoardFilterStore((store) => store.toggleLane);

  /** Which column's composer is open. One at a time — two would compete for focus. */
  const [composerStatusId, setComposerStatusId] = useState<string | null>(null);

  const labelsById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);

  // Only fetched when the epic lanes actually need titles: a `null` project id
  // is how `useTaskList` spells "disabled", and the hook itself stays
  // unconditional (rules of hooks).
  const { data: epics } = useTaskList(mode === 'epic' ? projectId : null, EPIC_FILTER);
  const epicTitleById = useMemo(
    () => new Map((epics ?? []).map((epic) => [epic.id, epic.title])),
    [epics],
  );

  const statusIds = useMemo(() => statuses.map((status) => status.id), [statuses]);

  const lanes = useMemo(
    () => (mode === 'none' ? [] : groupIntoSwimlanes(board, statusIds, mode)),
    [board, statusIds, mode],
  );

  /**
   * Opens the task sheet.
   *
   * A RELATIVE navigation (`t/FLOW-142`), which react-router resolves against
   * this page's ROUTE rather than the current URL — so it lands on
   * `…/board/t/FLOW-142` whether or not a sheet is already open, and the board
   * behind it never unmounts.
   */
  const openTask = useCallback(
    (taskKey: string) => {
      void navigate(`t/${taskKey}`);
    },
    [navigate],
  );

  /** The label and glyph for one lane, resolved per grouping mode. */
  const describeLane = (lane: Swimlane) => {
    if (mode === 'priority') {
      const priority = lane.id as TaskPriority;
      return {
        name: vocabulary.priorityName(priority),
        icon: <PriorityIcon priority={priority} />,
      };
    }

    if (mode === 'epic') {
      const title = epicTitleById.get(lane.id);
      return {
        name:
          lane.id === NO_LANE
            ? t('board:swimlanes.noEpic')
            : (title ?? t('board:swimlanes.epicName', { key: lane.id.slice(0, 8) })),
        icon:
          lane.id === NO_LANE ? undefined : (
            <Zap className="size-3.5 text-[var(--chart-1)]" aria-hidden />
          ),
      };
    }

    // assignee — read the person off any card in the lane rather than looking
    // them up in the org directory: the board already carries the summary.
    const assignee = firstTaskOf(lane)?.assignee ?? null;
    return {
      name: lane.id === NO_LANE ? t('board:swimlanes.noAssignee') : (assignee?.name ?? lane.id),
      icon: <UserAvatar user={assignee} size="xs" label="" />,
    };
  };

  const collapsed = new Set(collapsedLanes);

  return (
    <BoardDndProvider
      projectId={projectId}
      projectKey={projectKey}
      filters={filters}
      board={board}
      statuses={statuses}
      transitions={transitions}
      mode={mode}
      labelsById={labelsById}
    >
      <div
        data-slot="board-canvas"
        data-swimlane-mode={mode}
        className={cn(
          '-mx-[var(--page-pad)] overflow-auto px-[var(--page-pad)] pb-2',
          CANVAS_HEIGHT,
        )}
      >
        {mode === 'none' ? (
          <div className="flex h-full min-w-max items-stretch gap-[var(--gap)]">
            {statuses.map((status) => (
              <BoardColumn
                key={status.id}
                projectId={projectId}
                status={status}
                tasks={board.columns[status.id] ?? []}
                projectKey={projectKey}
                labelsById={labelsById}
                canWrite={canWrite}
                composerOpen={composerStatusId === status.id}
                onComposerChange={(open) => {
                  setComposerStatusId(open ? status.id : null);
                }}
                onOpen={openTask}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-w-max flex-col gap-1">
            {/* Column headers, drawn once and stuck to the top of the canvas —
                a lane stack can be far taller than the viewport. */}
            <div className="sticky top-0 z-20 flex items-start gap-[var(--gap)] bg-background pb-1">
              {statuses.map((status) => (
                <div key={status.id} className={cn(COLUMN_WIDTH, 'shrink-0')}>
                  <BoardColumnHeader
                    status={status}
                    count={(board.columns[status.id] ?? []).length}
                    canWrite={canWrite}
                    onQuickAdd={() => {
                      setComposerStatusId(status.id);
                    }}
                    className="rounded-[var(--radius)] border border-border bg-surface-raised/60 px-2"
                  />
                </div>
              ))}
            </div>

            {lanes.map((lane) => {
              const { name, icon } = describeLane(lane);
              return (
                <SwimlaneSection
                  key={lane.id}
                  lane={lane}
                  name={name}
                  icon={icon}
                  statuses={statuses}
                  collapsed={collapsed.has(laneStorageKey(mode, lane.id))}
                  onToggle={() => {
                    toggleLane(projectId, laneStorageKey(mode, lane.id));
                  }}
                  projectKey={projectKey}
                  labelsById={labelsById}
                  canWrite={canWrite}
                  onOpen={openTask}
                />
              );
            })}

            {/* Adding is a COLUMN action, not a lane one: a new card's lane is
                decided by the fields it gets, so the composer row sits under
                every lane rather than inside one. */}
            {canWrite ? (
              <div className="flex items-start gap-[var(--gap)] pt-1">
                {statuses.map((status) => (
                  <div key={status.id} className={cn(COLUMN_WIDTH, 'shrink-0')}>
                    <QuickAddCard
                      projectId={projectId}
                      statusId={status.id}
                      statusName={status.name}
                      open={composerStatusId === status.id}
                      onOpenChange={(open) => {
                        setComposerStatusId(open ? status.id : null);
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </BoardDndProvider>
  );
}

export default BoardCanvas;
