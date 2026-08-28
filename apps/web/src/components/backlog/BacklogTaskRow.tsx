import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Ellipsis, ExternalLink, GripVertical } from 'lucide-react';
import type { Label, Sprint, Status, TaskSummary } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { getIntlLocale, useLang } from '@/lib/lang-policy';
import type { SprintBucket } from '@/lib/board-cache';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LabelDot } from '@/components/common/LabelDot';
import { UserAvatar } from '@/components/common/UserAvatar';
import { formatPoints } from '@/components/backlog/backlog-points';
import { PriorityIcon, TaskTypeIcon } from '@/components/common/task-icons';
import { useTaskVocabulary } from '@/components/common/task-vocabulary';

/**
 * One line of the backlog — the densest component in the product.
 *
 * A planning session is a person reading eighty of these at once and deciding
 * what goes into the next two weeks, so the row is a single 32px line and every
 * element on it earns its width: type, key, title, priority, labels, points,
 * assignee, status. Anything that needs two lines belongs in the task sheet,
 * which the title links to.
 *
 * ── The handle appears on hover AND on focus ────────────────────────────────
 * `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` — the second
 * half is the part that matters and the part usually forgotten: a control that
 * only exists on hover is a control a keyboard user cannot find. It stays in the
 * layout at all times (opacity, not `hidden`), so the row does not shift by 20px
 * when the pointer crosses it.
 *
 * ── The whole row is not a link ─────────────────────────────────────────────
 * Only the TITLE navigates. A row-wide link would swallow the drag, and every
 * control on it (the menu, the handle) would have to stop propagation to work —
 * the classic reason a board card becomes undraggable on touch.
 *
 * ── `overlay` ───────────────────────────────────────────────────────────────
 * The same markup renders inside dnd-kit's `DragOverlay`, where there is no
 * sortable context and no transform to apply. That mode drops the interactive
 * bits (they are not reachable in a ghost) and adds the lifted shadow.
 */

export interface BacklogTaskRowProps {
  task: TaskSummary;
  /** `FLOW`, for composing the `FLOW-142` chip a human reads. */
  projectKey: string;
  /** The project's label vocabulary — rows carry ids, not colours. */
  labels: readonly Label[];
  statuses: readonly Status[];
  /** Where "Move to →" can send this row. Completed sprints are not offered. */
  moveTargets?: readonly Sprint[];
  /** The bucket this row is currently in, so the menu can grey it out. */
  currentSprintId?: SprintBucket;
  canWrite?: boolean;
  onMove?: (sprintId: SprintBucket) => void;
  /** Renders the drag ghost: no sortable wiring, no controls. */
  overlay?: boolean;
  /**
   * 1-based position in the WHOLE bucket, and the bucket's total length.
   *
   * Only supplied by a WINDOWED list (`TaskRowList` above its virtualisation
   * threshold), where the number of `<li>`s in the DOM is a rendering detail
   * rather than the size of the list. Without these a screen reader announces
   * "item 3 of 9" for row 3 of 480 — a count that changes as you scroll.
   */
  position?: number;
  setSize?: number;
}

export function BacklogTaskRow({
  task,
  projectKey,
  labels,
  statuses,
  moveTargets = [],
  currentSprintId = null,
  canWrite = false,
  onMove,
  overlay = false,
  position,
  setSize,
}: BacklogTaskRowProps) {
  const { t } = useTranslation(['backlog', 'common']);
  const vocabulary = useTaskVocabulary();
  useLang();
  const locale = getIntlLocale();

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !canWrite || overlay });

  const taskKey = `${projectKey}-${task.number}`;
  const status = statuses.find((entry) => entry.id === task.statusId);
  const rowLabels = labels.filter((label) => task.labelIds.includes(label.id));

  return (
    <li
      ref={overlay ? undefined : setNodeRef}
      data-slot="backlog-row"
      aria-posinset={position}
      aria-setsize={setSize}
      style={
        overlay
          ? undefined
          : {
              // dnd-kit's own transform helper — `CSS.Transform` mirrors
              // correctly under RTL because it emits a translate, not an inset.
              transform: CSS.Transform.toString(transform),
              transition,
            }
      }
      className={cn(
        'group flex h-8 items-center gap-2 rounded-[var(--radius)] border border-transparent px-1.5 text-sm',
        'hover:border-border hover:bg-surface-raised',
        'focus-within:border-border',
        overlay && 'border-border bg-surface-raised shadow-[var(--shadow-2)]',
        // The ORIGINAL row while its ghost is in the air: kept in the layout so
        // the list does not collapse, faded so the ghost is the real one.
        isDragging && 'opacity-40',
      )}
    >
      {canWrite && !overlay ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={t('backlog:actions.reorder')}
          className={cn(
            'flex size-5 shrink-0 cursor-grab items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground opacity-0 transition-opacity duration-[var(--speed)]',
            'group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
          )}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      ) : (
        <span className="size-5 shrink-0" aria-hidden />
      )}

      <TaskTypeIcon type={task.type} label={vocabulary.typeAria(task.type)} />

      {/* A task key is a Latin identifier in every locale — `dir=ltr` keeps
          `FLOW-142` from rendering as `142-FLOW` on an Arabic page. */}
      <span dir="ltr" className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {taskKey}
      </span>

      {/* `dir="auto"`: a title is user content and this row truncates — see
          `UserChip` in `components/common/UserAvatar.tsx`. */}
      {overlay ? (
        <span dir="auto" className="min-w-0 flex-1 truncate text-foreground">
          {task.title}
        </span>
      ) : (
        <Link
          dir="auto"
          to={`t/${taskKey}`}
          className="min-w-0 flex-1 truncate text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          {task.title}
        </Link>
      )}

      <PriorityIcon priority={task.priority} label={vocabulary.priorityAria(task.priority)} />

      {rowLabels.length > 0 ? (
        <span className="flex shrink-0 items-center gap-1">
          {rowLabels.slice(0, 3).map((label) => (
            <LabelDot key={label.id} color={label.color} />
          ))}
        </span>
      ) : null}

      {task.storyPoints !== null ? (
        <Badge variant="secondary" aria-label={t('backlog:row.pointsLabel')}>
          {t('backlog:row.points', { points: formatPoints(task.storyPoints, locale) })}
        </Badge>
      ) : null}

      <UserAvatar
        user={task.assignee}
        size="xs"
        label={task.assignee ? task.assignee.name : t('backlog:row.unassigned')}
      />

      <Badge
        variant="outline"
        className="hidden max-w-28 truncate sm:inline-flex"
        style={
          status
            ? {
                // The colour is DATA (a per-project value someone picked), which
                // is the same exemption `common/LabelDot` documents.
                backgroundColor: `color-mix(in oklab, ${status.color} 12%, transparent)`,
                borderColor: `color-mix(in oklab, ${status.color} 28%, transparent)`,
              }
            : undefined
        }
      >
        {status?.name ?? t('backlog:row.noStatus')}
      </Badge>

      {overlay ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label={t('backlog:actions.rowMenu')}
            >
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild>
              <Link to={`t/${taskKey}`}>
                <ExternalLink aria-hidden />
                {t('backlog:actions.openTask')}
              </Link>
            </DropdownMenuItem>

            {canWrite && onMove ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{t('backlog:actions.moveTo')}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                    <DropdownMenuItem
                      disabled={currentSprintId === null}
                      onSelect={() => {
                        onMove(null);
                      }}
                    >
                      {t('backlog:row.moveToBacklog')}
                    </DropdownMenuItem>
                    {moveTargets.map((sprint) => (
                      <DropdownMenuItem
                        key={sprint.id}
                        disabled={currentSprintId === sprint.id}
                        onSelect={() => {
                          onMove(sprint.id);
                        }}
                      >
                        <span className="truncate">{sprint.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

export default BacklogTaskRow;
