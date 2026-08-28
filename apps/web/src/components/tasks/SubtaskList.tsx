import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerUpLeft, Loader2, Plus } from 'lucide-react';
import type { Status, Task, TaskSummary } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusDot, TaskTypeIcon, findStatus } from '@/components/tasks/task-visuals';
import { subtaskProgress } from '@/components/tasks/subtask-progress';

/**
 * The subtask checklist — progress bar, rows, quick-add.
 *
 * ── Subtasks do not nest ────────────────────────────────────────────────────
 *
 * A `subtask` cannot have subtasks (the hierarchy is one level deep by design),
 * so the whole section is replaced by a link to the PARENT when the task being
 * shown is itself a subtask. Rendering an empty, permanently-empty checklist
 * there would be an invitation to try; the parent link is the thing a reader of
 * a subtask actually wants.
 *
 * ── Quick-add is a form, not a button that opens a dialog ───────────────────
 *
 * Breaking work down is a burst activity: someone types four subtasks in a row.
 * The input therefore stays mounted and clears itself on submit, so each one is
 * "type, Enter" rather than "click, type, click, wait for a dialog to close".
 * Everything else about the new task (status, rank, reporter) is the server's
 * default — a quick-add that asked for a status would not be quick.
 */

export interface SubtaskListProps {
  task: Task;
  /** The project's subtasks of THIS task, already filtered by `parentId`. */
  subtasks: readonly TaskSummary[];
  statuses: readonly Status[];
  /** The parent, when `task` is itself a subtask. `null` while it loads. */
  parent: TaskSummary | null;
  canEdit: boolean;
  isPending: boolean;
  isCreating: boolean;
  /** Navigates the sheet to another task, by KEY (`FLOW-142`). */
  onOpenTask: (taskKey: string) => void;
  onCreate: (title: string) => void;
  /** Builds the display key for a row — `${projectKey}-${number}`. */
  taskKeyOf: (task: TaskSummary) => string;
}

export function SubtaskList({
  task,
  subtasks,
  statuses,
  parent,
  canEdit,
  isPending,
  isCreating,
  onOpenTask,
  onCreate,
  taskKeyOf,
}: SubtaskListProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const [title, setTitle] = useState('');

  // ── A subtask shows its parent instead of a checklist ────────────────────
  if (task.type === 'subtask') {
    return (
      <section aria-label={t('tasks:subtasks.parentHeading')} className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t('tasks:subtasks.parentHeading')}
        </h3>
        {parent === null ? (
          <p className="text-xs text-muted-foreground">{t('tasks:subtasks.parentHint')}</p>
        ) : (
          <TaskRow
            summary={parent}
            statuses={statuses}
            taskKey={taskKeyOf(parent)}
            icon={<CornerUpLeft className="size-3.5 text-muted-foreground" aria-hidden />}
            onOpen={onOpenTask}
          />
        )}
      </section>
    );
  }

  const progress = subtaskProgress(subtasks, statuses);

  const submit = () => {
    const trimmed = title.trim();
    if (trimmed === '') return;
    onCreate(trimmed);
    setTitle('');
  };

  return (
    <section aria-label={t('tasks:subtasks.heading')} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{t('tasks:subtasks.heading')}</h3>
        {progress.total > 0 ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {t('tasks:subtasks.progress', { done: progress.done, total: progress.total })}
          </span>
        ) : null}
      </div>

      {progress.total > 0 ? (
        // A real `progressbar`, not a styled div: a screen reader gets the
        // percentage, and the width is the ONE place the arithmetic surfaces.
        <div
          role="progressbar"
          aria-label={t('tasks:subtasks.heading')}
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 w-full overflow-hidden rounded-full bg-secondary"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-[var(--speed)]',
              progress.complete ? 'bg-success' : 'bg-primary',
            )}
            style={{ inlineSize: `${String(progress.percent)}%` }}
          />
        </div>
      ) : null}

      {isPending ? (
        <p className="text-xs text-muted-foreground">{t('common:states.loading')}</p>
      ) : subtasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('tasks:subtasks.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {subtasks.map((subtask) => (
            <li key={subtask.id}>
              <TaskRow
                summary={subtask}
                statuses={statuses}
                taskKey={taskKeyOf(subtask)}
                onOpen={onOpenTask}
              />
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            value={title}
            aria-label={t('tasks:subtasks.add')}
            placeholder={t('tasks:subtasks.placeholder')}
            className="h-8 flex-1"
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <Button type="submit" size="sm" variant="outline" disabled={isCreating}>
            {isCreating ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            {t('tasks:subtasks.create')}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

/**
 * One clickable task row — shared by the subtask list, the parent link and (in
 * spirit) the dependency section.
 *
 * A `<button>` rather than an `<a>`: the sheet navigates in place through the
 * router, and a real anchor whose `href` we then `preventDefault` is a link that
 * lies to middle-click and "open in new tab".
 */
function TaskRow({
  summary,
  statuses,
  taskKey,
  icon,
  onOpen,
}: {
  summary: TaskSummary;
  statuses: readonly Status[];
  taskKey: string;
  icon?: ReactNode;
  onOpen: (taskKey: string) => void;
}) {
  const status = findStatus(statuses, summary.statusId);
  const done = status?.category === 'done';

  return (
    <button
      type="button"
      onClick={() => {
        onOpen(taskKey);
      }}
      className="flex w-full items-center gap-2 rounded-[var(--radius)] px-1.5 py-1 text-start transition-colors duration-[var(--speed)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <StatusDot status={status} category={status?.category ?? 'todo'} />
      {icon ?? <TaskTypeIcon type={summary.type} />}
      <span dir="ltr" className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {taskKey}
      </span>
      {/* A task title is user content — see `UserChip` in `UserAvatar`. */}
      <span
        dir="auto"
        className={cn('truncate text-xs', done && 'text-muted-foreground line-through')}
      >
        {summary.title}
      </span>
    </button>
  );
}

export default SubtaskList;
