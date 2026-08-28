import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Plus, ShieldAlert, X } from 'lucide-react';
import type { CreateDependencyInput, Status, Task, TaskRef, TaskSummary } from '@flowboard/shared';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StatusDot, TaskTypeIcon, findStatus } from '@/components/tasks/task-visuals';

/**
 * The `blocks` relationship, both directions.
 *
 * ── One endpoint, two lists, and why the direction lives in the BODY ────────
 *
 * "A blocks B" and "B is blocked by A" are the same row read from two ends, so
 * there is one endpoint and one row. The direction is named in the request body
 * (`{ blockerTaskId }` vs `{ blockedTaskId }`) rather than by re-targeting the
 * POST at the other task — a caller that had to flip which task it addressed in
 * order to express the second direction would eventually flip it the wrong way
 * and write a real, wrong edge. This section therefore always POSTs to the task
 * on screen and lets the key say what it means.
 *
 * ── Nothing is optimistic here ──────────────────────────────────────────────
 *
 * The server walks the dependency graph inside the write transaction and refuses
 * anything that would close a loop; only it can answer that. Painting the edge
 * first would show a link that is about to be rejected roughly as often as
 * someone reaches for a dependency they should not have — exactly when an honest
 * answer matters most. `dependency_cycle` is already in the error catalog, so a
 * refusal arrives as a localized toast through the hook's shared `onError`.
 */

export interface DependencySectionProps {
  task: Task;
  statuses: readonly Status[];
  /** Candidates for a new edge — the project's tasks, self excluded. */
  candidates: readonly TaskSummary[];
  canEdit: boolean;
  isPending: boolean;
  onAdd: (input: CreateDependencyInput) => void;
  onRemove: (otherTaskId: string) => void;
  onOpenTask: (taskKey: string) => void;
  taskKeyOf: (task: TaskSummary) => string;
}

export function DependencySection({
  task,
  statuses,
  candidates,
  canEdit,
  isPending,
  onAdd,
  onRemove,
  onOpenTask,
  taskKeyOf,
}: DependencySectionProps) {
  const { t } = useTranslation(['tasks', 'common']);

  const { blockers, blocked } = task.dependencies;
  const empty = blockers.length === 0 && blocked.length === 0;

  // A task already on either side is not a candidate: the pair is unique, and
  // offering it again is offering a request that can only fail.
  const linkedIds = new Set([
    task.id,
    ...blockers.map((ref) => ref.id),
    ...blocked.map((ref) => ref.id),
  ]);
  const available = candidates.filter((candidate) => !linkedIds.has(candidate.id));

  return (
    <section aria-label={t('tasks:dependencies.heading')} className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        {t('tasks:dependencies.heading')}
      </h3>

      {empty && !canEdit ? (
        <p className="text-xs text-muted-foreground">{t('tasks:dependencies.empty')}</p>
      ) : null}

      <DependencyGroup
        heading={t('tasks:dependencies.blockedBy')}
        icon={<ShieldAlert className="size-3.5 text-warning" aria-hidden />}
        refs={blockers}
        statuses={statuses}
        canEdit={canEdit}
        onRemove={onRemove}
        onOpenTask={onOpenTask}
      />

      <DependencyGroup
        heading={t('tasks:dependencies.blocks')}
        icon={<Ban className="size-3.5 text-muted-foreground" aria-hidden />}
        refs={blocked}
        statuses={statuses}
        canEdit={canEdit}
        onRemove={onRemove}
        onOpenTask={onOpenTask}
      />

      {canEdit ? (
        <div className="flex flex-wrap gap-1.5">
          <AddDependency
            label={t('tasks:dependencies.addBlockedBy')}
            candidates={available}
            statuses={statuses}
            disabled={isPending}
            taskKeyOf={taskKeyOf}
            onPick={(otherTaskId) => {
              // That task blocks THIS one.
              onAdd({ blockerTaskId: otherTaskId });
            }}
          />
          <AddDependency
            label={t('tasks:dependencies.addBlocks')}
            candidates={available}
            statuses={statuses}
            disabled={isPending}
            taskKeyOf={taskKeyOf}
            onPick={(otherTaskId) => {
              // THIS task blocks that one.
              onAdd({ blockedTaskId: otherTaskId });
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

/** One direction's rows, or nothing at all when the direction is empty. */
function DependencyGroup({
  heading,
  icon,
  refs,
  statuses,
  canEdit,
  onRemove,
  onOpenTask,
}: {
  heading: string;
  icon: ReactNode;
  refs: readonly TaskRef[];
  statuses: readonly Status[];
  canEdit: boolean;
  onRemove: (otherTaskId: string) => void;
  onOpenTask: (taskKey: string) => void;
}) {
  const { t } = useTranslation(['tasks', 'common']);
  if (refs.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        {heading}
      </span>
      <ul className="flex flex-col gap-0.5">
        {refs.map((ref) => {
          const status = findStatus(statuses, ref.statusId);
          return (
            <li key={ref.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  onOpenTask(ref.key);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius)] px-1.5 py-1 text-start transition-colors duration-[var(--speed)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <StatusDot status={status} category={status?.category ?? 'todo'} />
                <TaskTypeIcon type={ref.type} />
                <span dir="ltr" className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {ref.key}
                </span>
                {/* User content — see `UserChip` in `UserAvatar`. */}
                <span dir="auto" className="truncate text-xs">
                  {ref.title}
                </span>
              </button>
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${t('tasks:dependencies.remove')} ${ref.key}`}
                  onClick={() => {
                    onRemove(ref.id);
                  }}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The "add a dependency" picker.
 *
 * The search is CLIENT-SIDE over the project's task list, which the sheet has
 * already loaded for the epic picker. There is a server search
 * (`GET /orgs/:orgId/search`), but it is cross-project by design and a
 * dependency may only point inside one project — so using it here would mean
 * offering rows the endpoint would then refuse.
 */
function AddDependency({
  label,
  candidates,
  statuses,
  disabled,
  taskKeyOf,
  onPick,
}: {
  label: string;
  candidates: readonly TaskSummary[];
  statuses: readonly Status[];
  disabled: boolean;
  taskKeyOf: (task: TaskSummary) => string;
  onPick: (taskId: string) => void;
}) {
  const { t } = useTranslation(['tasks', 'common']);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className="gap-1.5">
          <Plus aria-hidden />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command label={label}>
          <CommandInput placeholder={t('tasks:dependencies.search')} autoFocus />
          <CommandList>
            <CommandEmpty>{t('tasks:dependencies.noMatches')}</CommandEmpty>
            {candidates.map((candidate) => {
              const status = findStatus(statuses, candidate.statusId);
              const key = taskKeyOf(candidate);
              return (
                <CommandItem
                  // The KEY is the match target — `FLOW-142` is what people
                  // paste — and the title is a keyword, so both find the row.
                  key={candidate.id}
                  value={key}
                  keywords={[candidate.title]}
                  onSelect={() => {
                    onPick(candidate.id);
                    setOpen(false);
                  }}
                >
                  <StatusDot status={status} category={status?.category ?? 'todo'} />
                  <TaskTypeIcon type={candidate.type} />
                  <span dir="ltr" className="shrink-0 font-mono text-[11px]">
                    {key}
                  </span>
                  <span dir="auto" className="truncate">
                    {candidate.title}
                  </span>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default DependencySection;
