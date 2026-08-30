import { memo, type CSSProperties, type KeyboardEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { CalendarDays, MessageSquare, Paperclip, TextAlignStart } from 'lucide-react';
import type { Label, TaskSummary } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { getIntlLocale } from '@/lib/lang-policy';
import { LabelDot } from '@/components/common/LabelDot';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PriorityIcon, TaskTypeIcon } from '@/components/common/task-icons';
import { useTaskVocabulary } from '@/components/common/task-vocabulary';
import {
  MAX_LABEL_DOTS,
  formatDueDate,
  formatPoints,
  isOverdue,
} from '@/components/board/board-meta';
import type { BoardDragCard } from '@/components/board/dnd';
import { DropSettle } from '@/components/board/DropSettle';

/**
 * The board card — the densest component in FlowBoard, and the one it renders
 * the most copies of.
 *
 * THE LINEAR READING ORDER, three rows, no decoration:
 *   1. type glyph + key (`FLOW-142`, mono, muted) — the identity line.
 *   2. the title, clamped to two lines. It is the only thing at full contrast.
 *   3. the metadata rail: priority, label dots, points, due date, then the
 *      assignee pinned to the reading END. Every item is OPTIONAL and absent
 *      when the field is empty — a card with only a title draws only a title,
 *      which is what keeps a wall of them scannable.
 *
 * PRESENTATION IS SPLIT FROM DRAGGING on purpose ({@link BoardCardFace} vs
 * {@link BoardCard}): the `DragOverlay` needs the same pixels without a
 * `useSortable` of its own — two sortables with one id is a broken drag — so
 * the face is a plain component and the sortable is a thin wrapper.
 */

export interface BoardCardFaceProps {
  task: TaskSummary;
  /** The `FLOW` in `FLOW-142`; a summary carries the number, not the key. */
  projectKey: string;
  /** The project's label vocabulary, for turning `labelIds` into dots. */
  labelsById: ReadonlyMap<string, Label>;
  /**
   * True in a `done`-category column. A resolved card is not "overdue" — the
   * work happened — so the due chip drops its danger tint there instead of
   * leaving a column of red on a finished board.
   */
  resolved?: boolean;
  /** Lifts the card visually while it rides the DragOverlay. */
  lifted?: boolean;
  className?: string;
}

/** The task key a human reads: `FLOW-142`. */
export function taskKeyOf(projectKey: string, task: Pick<TaskSummary, 'number'>): string {
  return `${projectKey}-${task.number}`;
}

/** The pixels. No drag, no routing — just the card. */
export function BoardCardFace({
  task,
  projectKey,
  labelsById,
  resolved = false,
  lifted = false,
  className,
}: BoardCardFaceProps) {
  const { t } = useTranslation(['board']);
  const locale = getIntlLocale();

  const vocabulary = useTaskVocabulary();
  const key = taskKeyOf(projectKey, task);

  const labels = task.labelIds
    .map((labelId) => labelsById.get(labelId))
    .filter((label): label is Label => label !== undefined);
  const shownLabels = labels.slice(0, MAX_LABEL_DOTS);
  const hiddenLabels = labels.length - shownLabels.length;

  const overdue = task.dueDate !== null && !resolved && isOverdue(task.dueDate);

  return (
    <article
      data-slot="board-card"
      data-task-id={task.id}
      data-overdue={overdue ? 'true' : undefined}
      className={cn(
        'group flex w-full flex-col gap-1.5 rounded-[var(--card-radius)] border border-border bg-surface p-2.5 text-start shadow-[var(--shadow-1)]',
        'transition-colors duration-[var(--speed)] hover:border-primary/40 hover:bg-surface-raised',
        lifted && 'rotate-[1.2deg] border-primary/50 shadow-[var(--shadow-2)]',
        className,
      )}
    >
      {/* ── identity row ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5">
        <TaskTypeIcon type={task.type} label={vocabulary.typeAria(task.type)} />
        {/* A task key is a Latin identifier in every locale — it must not be
            mirrored, and it reads best in the mono face. */}
        <span dir="ltr" className="font-mono text-[11px] tracking-tight text-muted-foreground">
          {key}
        </span>

        <span className="ms-auto flex items-center gap-1 text-muted-foreground">
          {task.hasDescription ? (
            <TextAlignStart className="size-3" aria-label={t('board:card.hasDescription')} />
          ) : null}
          {task.commentCount > 0 ? (
            <span
              className="flex items-center gap-0.5 text-[11px] tabular-nums"
              aria-label={t('board:card.comments', { count: task.commentCount })}
            >
              <MessageSquare className="size-3" aria-hidden />
              {task.commentCount}
            </span>
          ) : null}
          {task.attachmentCount > 0 ? (
            <span
              className="flex items-center gap-0.5 text-[11px] tabular-nums"
              aria-label={t('board:card.attachments', { count: task.attachmentCount })}
            >
              <Paperclip className="size-3" aria-hidden />
              {task.attachmentCount}
            </span>
          ) : null}
        </span>
      </div>

      {/* ── title ───────────────────────────────────────────────────────── */}
      {/* `dir="auto"` on USER-GENERATED text (WP5.1): a title is written in
          whatever alphabet its author used, and a Latin title inheriting the
          page's `rtl` gets clamped from the wrong end. See `UserChip` in
          `components/common/UserAvatar.tsx` for the full note. */}
      <p dir="auto" className="line-clamp-2 text-[13px] leading-snug font-medium text-foreground">
        {task.title}
      </p>

      {/* ── metadata rail ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5">
        <PriorityIcon priority={task.priority} label={vocabulary.priorityAria(task.priority)} />

        {shownLabels.length > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="flex items-center gap-0.5"
                aria-label={t('board:card.labelsLabel', {
                  names: labels.map((label) => label.name).join(', '),
                })}
              >
                {shownLabels.map((label) => (
                  <LabelDot key={label.id} color={label.color} />
                ))}
                {hiddenLabels > 0 ? (
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {t('board:card.moreLabels', { count: hiddenLabels })}
                  </span>
                ) : null}
              </span>
            </TooltipTrigger>
            <TooltipContent>{labels.map((label) => label.name).join(' · ')}</TooltipContent>
          </Tooltip>
        ) : null}

        {task.storyPoints !== null ? (
          <span
            className="rounded-[var(--radius)] bg-secondary px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums"
            aria-label={t('board:card.pointsLabel', {
              points: formatPoints(task.storyPoints, locale),
            })}
          >
            {formatPoints(task.storyPoints, locale)}
          </span>
        ) : null}

        {task.dueDate !== null ? (
          <span
            data-slot="due-chip"
            className={cn(
              'inline-flex items-center gap-1 rounded-[var(--radius)] px-1 text-[11px] whitespace-nowrap',
              overdue ? 'bg-danger/12 text-danger' : 'text-muted-foreground',
            )}
            aria-label={
              overdue
                ? t('board:card.overdue', { date: formatDueDate(task.dueDate, locale) })
                : t('board:card.due', { date: formatDueDate(task.dueDate, locale) })
            }
          >
            <CalendarDays className="size-3" aria-hidden />
            {formatDueDate(task.dueDate, locale)}
          </span>
        ) : null}

        <span className="ms-auto flex shrink-0 items-center">
          <UserAvatar
            user={task.assignee}
            size="xs"
            label={
              task.assignee
                ? t('board:card.assignedTo', { name: task.assignee.name })
                : t('board:card.unassigned')
            }
          />
        </span>
      </div>
    </article>
  );
}

export interface BoardCardProps extends BoardCardFaceProps {
  /** Which column + lane cell this card is drawn in — the drag payload. */
  drag: BoardDragCard;
  /** Opens the task sheet. Given the KEY, since that is what the route takes. */
  onOpen: (taskKey: string) => void;
  /** Viewers can read the board but not rearrange it. */
  disabled?: boolean;
}

/**
 * The draggable, clickable card.
 *
 * WHY THE WHOLE CARD IS THE DRAG HANDLE (unlike `workflow/StatusRow`, where
 * only the grip is): a card contains no text field or control to click INTO, so
 * a grip would be a smaller target for the same gesture and one more thing to
 * aim at on a dense board. The `PointerSensor`'s 4px activation distance is
 * what keeps a plain click a click.
 *
 * WHY ENTER OPENS AND SPACE DRAGS. `BoardDndProvider` narrows the keyboard
 * sensor's activator to Space alone, freeing Enter — so the two keyboard
 * affordances a card owes ("look at this" and "move this") do not fight over
 * one key. Both are announced through `attributes`' `aria-describedby`.
 */
function BoardCardImpl({ drag, onOpen, disabled = false, ...face }: BoardCardProps) {
  const { t } = useTranslation(['board']);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: drag.taskId,
    data: drag,
    disabled,
  });

  const style: CSSProperties = {
    // `Translate`, not `Transform`: the sortable strategy also reports a scale
    // for cards of differing heights, and a card that grows as it passes its
    // neighbours reads as a rendering bug.
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const key = taskKeyOf(face.projectKey, face.task);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    listeners?.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(key);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'cursor-default touch-none outline-none',
        // The original stays in place as a ghost while the DragOverlay carries
        // the real card — removing it would collapse the column under the
        // pointer and make every neighbour jump.
        isDragging && 'opacity-40',
      )}
      data-slot="board-card-sortable"
      data-dragging={isDragging ? 'true' : undefined}
      {...attributes}
      {...listeners}
      onKeyDown={handleKeyDown}
      onClick={() => {
        onOpen(key);
      }}
      aria-label={t('board:card.open', { key })}
    >
      {/*
        The settle wraps the FACE, inside the sortable node — never around it.
        The outer div owns dnd-kit's live `transform`/`transition`, and a second
        animated transform on the same element would fight it mid-drag; nesting
        keeps the two on different nodes, so the spring can only ever run after
        dnd-kit has released its own. Focus also lives on the outer div, so the
        settle's remount cannot steal it from a keyboard drop.
      */}
      <DropSettle taskId={drag.taskId}>
        <BoardCardFace {...face} />
      </DropSettle>
    </div>
  );
}

/**
 * `memo` is not decoration here. One optimistic drop rewrites the board cache,
 * which re-renders every column; without this, a 200-card board re-renders 200
 * cards per drag frame. The props are all primitives or stable references
 * (`labelsById` is memoized by the canvas), so the shallow compare is sound.
 */
export const BoardCard = memo(BoardCardImpl);

export default BoardCard;
