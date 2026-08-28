import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, MoreHorizontal, Trash2 } from 'lucide-react';
import type { Status, Task, TaskType, Transition } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { isTransitionAllowed } from '@/lib/board-cache';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { CopyButton } from '@/components/common/CopyButton';
import { useTaskVocabulary } from '@/components/common/task-vocabulary';
import { StatusDot, TASK_TYPES, TaskTypeIcon, findStatus } from '@/components/tasks/task-visuals';

/**
 * The task sheet's header: identity on one side, the three controls that change
 * what the task IS on the other.
 *
 * ── The status menu is the interesting part ─────────────────────────────────
 *
 * A project's workflow may whitelist transitions (`workflow_transitions`), and
 * the rule is per SOURCE status: zero rows out of a status means every move is
 * allowed, one or more means only those are. {@link statusMenuOptions} applies
 * that rule — the same pure `isTransitionAllowed` the board's drag pre-check
 * uses, so a move the board refuses is a move this menu greys out.
 *
 * Disallowed targets are RENDERED AND DISABLED rather than hidden, with the
 * reason in a tooltip. Hiding them would leave a user staring at a column they
 * can see on the board and cannot find in the menu, with nothing to explain the
 * absence; a greyed row that says why is the difference between "broken" and "a
 * rule I did not know about".
 *
 * The check is advisory in the same sense the board's is: the server re-validates
 * every status change, so skipping it would cost a toast, not correctness.
 */

/** One row of the status menu: the column, and whether it may be moved to. */
export interface StatusMenuOption {
  status: Status;
  allowed: boolean;
  /** True for the column the task is already in. */
  current: boolean;
}

/**
 * The status menu's rows, in board order.
 *
 * Extracted as a pure function because "which targets are reachable from here"
 * is the one piece of logic in this file worth asserting on its own, and doing
 * so through an opened Radix menu would be a test about portals.
 */
export function statusMenuOptions(
  statuses: readonly Status[],
  transitions: readonly Transition[],
  currentStatusId: string,
): StatusMenuOption[] {
  return [...statuses]
    .sort((a, b) => a.position - b.position)
    .map((status) => ({
      status,
      allowed: isTransitionAllowed(transitions, currentStatusId, status.id),
      current: status.id === currentStatusId,
    }));
}

export interface TaskHeaderBarProps {
  task: Task;
  statuses: readonly Status[];
  transitions: readonly Transition[];
  /** Deep link to this task — what the copy button puts on the clipboard. */
  taskUrl: string;
  canEdit: boolean;
  isWatching: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onChangeType: (type: TaskType) => void;
  onChangeStatus: (statusId: string) => void;
  onToggleWatch: (watching: boolean) => void;
  onDelete: () => void;
}

export function TaskHeaderBar({
  task,
  statuses,
  transitions,
  taskUrl,
  canEdit,
  isWatching,
  isSaving,
  isDeleting,
  onChangeType,
  onChangeStatus,
  onToggleWatch,
  onDelete,
}: TaskHeaderBarProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const vocabulary = useTaskVocabulary();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const currentStatus = findStatus(statuses, task.statusId);
  const options = statusMenuOptions(statuses, transitions, task.statusId);

  return (
    // `pe-8` KEEPS THE OVERFLOW MENU CLICKABLE. The sheet renders its own close
    // button absolutely at `end-3 top-3` (`ui/sheet.tsx`), and it is painted
    // after this row — so without the reserved inline-end space the "More
    // actions" trigger sits directly underneath the X and every click on it hits
    // the close button instead, which made "Delete task" unreachable in the UI.
    // Logical padding, so the reservation follows the close button under RTL.
    <div className="flex flex-wrap items-center gap-1.5 pe-8">
      {/* The key is an IDENTIFIER: mono, `dir="ltr"` so `FLOW-142` never
          reorders on an Arabic page, and never translated. */}
      <span
        dir="ltr"
        className="rounded-[var(--radius)] border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
      >
        {task.key}
      </span>

      <CopyButton value={taskUrl} label={t('tasks:header.copyLink')} size="icon-xs" />

      {/* ── Issue type ─────────────────────────────────────────────────── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!canEdit}>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={t('tasks:header.changeType')}
            className="gap-1.5"
          >
            <TaskTypeIcon type={task.type} />
            {vocabulary.typeName(task.type)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t('tasks:header.changeType')}</DropdownMenuLabel>
          {TASK_TYPES.map((type) => (
            <DropdownMenuItem
              key={type}
              onSelect={() => {
                if (type !== task.type) onChangeType(type);
              }}
            >
              <TaskTypeIcon type={type} />
              {vocabulary.typeName(type)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ── Status ─────────────────────────────────────────────────────── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!canEdit}>
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-label={t('tasks:header.changeStatus')}
            className="gap-1.5"
          >
            <StatusDot status={currentStatus} category={currentStatus?.category ?? 'todo'} />
            {currentStatus?.name ?? t('tasks:category.todo')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuLabel>{t('tasks:header.changeStatus')}</DropdownMenuLabel>
          {options.map((option) => {
            const item = (
              <DropdownMenuItem
                key={option.status.id}
                disabled={!option.allowed}
                data-current={option.current || undefined}
                onSelect={() => {
                  if (!option.current) onChangeStatus(option.status.id);
                }}
              >
                <StatusDot status={option.status} />
                <span className={cn('truncate', option.current && 'font-medium text-foreground')}>
                  {option.status.name}
                </span>
                <span className="ms-auto text-[10px] text-muted-foreground">
                  {t(`tasks:category.${option.status.category}`)}
                </span>
              </DropdownMenuItem>
            );

            if (option.allowed) return item;

            // A disabled Radix item has `pointer-events: none`, so the tooltip
            // has to be triggered by a WRAPPER that still receives hovers.
            return (
              <Tooltip key={option.status.id}>
                <TooltipTrigger asChild>
                  <span className="block">{item}</span>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {t('tasks:header.transitionBlocked', {
                    from: currentStatus?.name ?? '',
                    to: option.status.name,
                  })}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {isSaving ? (
        <span className="text-[11px] text-muted-foreground">{t('tasks:fields.saving')}</span>
      ) : null}

      <div className="ms-auto flex items-center gap-1">
        {/* ── Watch toggle ─────────────────────────────────────────────── */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-pressed={isWatching}
              aria-label={isWatching ? t('tasks:header.unwatch') : t('tasks:header.watch')}
              className="gap-1.5"
              onClick={() => {
                onToggleWatch(!isWatching);
              }}
            >
              {isWatching ? (
                // `fill-current` is the "filled icon when watching" affordance:
                // one glyph, two states, no second import.
                <Eye className="fill-primary/25 text-primary" aria-hidden />
              ) : (
                <EyeOff aria-hidden />
              )}
              <span className="tabular-nums">{task.watcherIds.length}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t('tasks:header.watcherCount', { count: task.watcherIds.length })}
          </TooltipContent>
        </Tooltip>

        {/* ── Overflow ─────────────────────────────────────────────────── */}
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('tasks:header.more')}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('tasks:header.more')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  setConfirmingDelete(true);
                }}
              >
                <Trash2 aria-hidden />
                {t('tasks:header.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            {t('tasks:fields.readOnly')}
          </Badge>
        )}
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('tasks:header.deleteTitle', { key: task.key })}
        description={t('tasks:header.deleteBody')}
        confirmLabel={t('common:actions.delete')}
        isPending={isDeleting}
        onConfirm={onDelete}
      />
    </div>
  );
}

export default TaskHeaderBar;
