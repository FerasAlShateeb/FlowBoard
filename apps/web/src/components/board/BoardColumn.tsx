import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { Label, Status, TaskSummary } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { wipStateOf } from '@/hooks/useTaskMutations';
import { Button } from '@/components/ui/button';
import { BoardCard } from '@/components/board/BoardCard';
import { QuickAddCard } from '@/components/board/QuickAddCard';
import { WipLimitBadge } from '@/components/board/WipLimitBadge';
import { useBoardDrag } from '@/components/board/BoardDndProvider';
import { containerId } from '@/components/board/dnd';
import { ALL_LANE } from '@/components/board/swimlanes';

/**
 * A board column — and, in swimlane mode, one CELL of one.
 *
 * THE FILE IS DELIBERATELY THREE COMPONENTS, not one with flags. Swimlanes
 * split a column into a header drawn ONCE at the top of the board and a stack
 * of independent drop lists underneath it, so "the header" and "a drop list"
 * are genuinely separate things that happen to sit together when grouping is
 * off. Folding them into one component would mean a `renderHeader` prop, which
 * is the shape you reach for right before you regret it.
 *
 *   {@link BoardColumnHeader}  colour, name, count, WIP badge, quick-add.
 *   {@link BoardCardList}      the droppable + sortable list. One per lane cell.
 *   {@link BoardColumn}        both, plus the footer composer — the no-lane case.
 */

/** Every column is this wide, so the board reads as a grid rather than a chart. */
export const COLUMN_WIDTH = 'w-[17.5rem]';

// ───────────────────────────────────────────────────────────────────────────
// Header
// ───────────────────────────────────────────────────────────────────────────

export function BoardColumnHeader({
  status,
  count,
  canWrite,
  onQuickAdd,
  className,
}: {
  status: Status;
  count: number;
  canWrite: boolean;
  /** Opens this column's composer. Omitted, the `+` button is not rendered. */
  onQuickAdd?: () => void;
  className?: string;
}) {
  const { t } = useTranslation(['board']);
  const wip = wipStateOf(status, count);

  return (
    <div
      data-slot="board-column-header"
      className={cn('flex items-center gap-2 px-1 py-1.5', className)}
    >
      {/* Status colour is per-project DATA, so it can only arrive as an inline
          style — the same exemption `common/LabelDot` documents. */}
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: status.color }}
      />
      <h2 className="truncate text-xs font-semibold tracking-tight text-foreground">
        {status.name}
      </h2>
      <span
        className="text-xs text-muted-foreground tabular-nums"
        aria-label={t('board:column.count', { count })}
      >
        {count}
      </span>

      <span className="ms-auto flex items-center gap-1">
        <WipLimitBadge wip={wip} statusName={status.name} />
        {canWrite && onQuickAdd ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('board:column.add', { status: status.name })}
            onClick={onQuickAdd}
          >
            <Plus aria-hidden />
          </Button>
        ) : null}
      </span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// The drop list
// ───────────────────────────────────────────────────────────────────────────

export interface BoardCardListProps {
  statusId: string;
  /** Named in the refusal message, which has to stand on its own. */
  statusName: string;
  /** {@link ALL_LANE} when swimlanes are off. */
  laneId?: string;
  tasks: readonly TaskSummary[];
  projectKey: string;
  labelsById: ReadonlyMap<string, Label>;
  /** True for a `done`-category column — suppresses the overdue tint. */
  resolved?: boolean;
  /** Viewers see the board; they do not rearrange it. */
  disabled?: boolean;
  onOpen: (taskKey: string) => void;
  className?: string;
  /** Minimum height, so an empty cell is still a target you can hit. */
  minHeight?: string;
}

/**
 * One droppable, sortable list of cards.
 *
 * THE FORBIDDEN-DROP TREATMENT lives here rather than on the column shell
 * because the LIST is the drop target: a `not-allowed` cursor on a header the
 * pointer never crosses teaches nobody anything. Three signals, in one place —
 * a low-alpha `--danger` wash, a dashed danger outline, and the cursor — plus a
 * one-line reason when this is also the column being hovered, since a tint says
 * "no" and only the sentence says "why".
 */
export function BoardCardList({
  statusId,
  statusName,
  laneId = ALL_LANE,
  tasks,
  projectKey,
  labelsById,
  resolved = false,
  disabled = false,
  onOpen,
  className,
  minHeight = 'min-h-16',
}: BoardCardListProps) {
  const { t } = useTranslation(['board']);
  const drag = useBoardDrag();

  const id = containerId(statusId, laneId);
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: 'container', statusId, laneId },
  });

  const verdict = drag.activeTask ? drag.dropChecks[statusId] : undefined;
  const blocked = verdict !== undefined && !verdict.allowed;
  const hovered = drag.overStatusId === statusId;

  const items = tasks.map((task) => task.id);

  return (
    <div
      ref={setNodeRef}
      data-slot="board-card-list"
      data-status-id={statusId}
      data-lane-id={laneId}
      data-drop-blocked={blocked ? 'true' : undefined}
      data-drop-over={isOver ? 'true' : undefined}
      className={cn(
        'flex flex-col gap-1.5 rounded-[var(--radius)] p-1 transition-colors duration-[var(--speed)]',
        minHeight,
        blocked && 'cursor-not-allowed bg-danger/8 outline-1 outline-dashed outline-danger/50',
        !blocked && isOver && 'bg-primary/6 outline-1 outline-dashed outline-primary/40',
        className,
      )}
    >
      {blocked && hovered ? (
        <p
          role="status"
          className="rounded-[var(--radius)] bg-danger/12 px-1.5 py-1 text-[11px] text-danger"
        >
          {verdict.reason === 'wip'
            ? t('board:drop.wip', { status: statusName, limit: verdict.wip.limit ?? 0 })
            : t('board:drop.blocked')}
        </p>
      ) : null}

      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            projectKey={projectKey}
            labelsById={labelsById}
            resolved={resolved}
            disabled={disabled}
            onOpen={onOpen}
            drag={{ type: 'card', taskId: task.id, statusId, laneId }}
          />
        ))}
      </SortableContext>

      {tasks.length === 0 && !blocked ? (
        <p className="px-1 py-2 text-[11px] text-muted-foreground">
          {isOver ? t('board:column.dropHere') : t('board:column.empty')}
        </p>
      ) : null}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// The whole column (swimlanes off)
// ───────────────────────────────────────────────────────────────────────────

export function BoardColumn({
  projectId,
  status,
  tasks,
  projectKey,
  labelsById,
  canWrite,
  composerOpen,
  onComposerChange,
  onOpen,
}: {
  projectId: string;
  status: Status;
  tasks: readonly TaskSummary[];
  projectKey: string;
  labelsById: ReadonlyMap<string, Label>;
  canWrite: boolean;
  composerOpen: boolean;
  onComposerChange: (open: boolean) => void;
  onOpen: (taskKey: string) => void;
}) {
  const { t } = useTranslation(['board']);

  return (
    <section
      data-slot="board-column"
      data-status-id={status.id}
      aria-label={t('board:column.region', { status: status.name })}
      className={cn(
        COLUMN_WIDTH,
        'flex max-h-full shrink-0 flex-col rounded-[var(--card-radius)] border border-border bg-surface-raised/60',
      )}
    >
      <BoardColumnHeader
        status={status}
        count={tasks.length}
        canWrite={canWrite}
        onQuickAdd={() => {
          onComposerChange(true);
        }}
        className="border-b border-border px-2"
      />

      {/* The column owns its own vertical scroll, which is what lets the header
          and the composer stay put while a long column scrolls under them. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <BoardCardList
          statusId={status.id}
          statusName={status.name}
          tasks={tasks}
          projectKey={projectKey}
          labelsById={labelsById}
          resolved={status.category === 'done'}
          disabled={!canWrite}
          onOpen={onOpen}
          minHeight="min-h-24"
        />
      </div>

      {canWrite ? (
        <div className="border-t border-border p-1">
          <QuickAddCard
            projectId={projectId}
            statusId={status.id}
            statusName={status.name}
            open={composerOpen}
            onOpenChange={onComposerChange}
          />
        </div>
      ) : null}
    </section>
  );
}

export default BoardColumn;
