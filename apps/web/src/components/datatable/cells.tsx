import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarDays, LoaderCircle, X } from 'lucide-react';
import type { TaskPriority, TaskSummary, TaskType } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { isTransitionAllowed } from '@/lib/board-cache';
import { UserAvatar } from '@/components/common/UserAvatar';
import { UserSelect } from '@/components/common/UserSelect';
import { LabelDot } from '@/components/common/LabelDot';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useIsEditing, useTableGrid } from '@/components/datatable/grid-context';
import {
  PriorityIcon,
  TASK_PRIORITIES,
  TASK_TYPES,
  TaskTypeIcon,
  formatPoints,
  parseIsoDate,
  toIsoDate,
  useTableFormatters,
  useTaskFieldLabels,
} from '@/components/datatable/task-fields';
import { parsePoints } from '@/components/datatable/useCellPatch';

/**
 * The Table view's cells — one component per column, each a DISPLAY form that
 * swaps to an EDITOR while its coordinate is the grid's `editing` cell.
 *
 * ── The editing contract, once, so every cell can be read quickly ───────────
 *
 * * **Opening** is not a cell's decision. The grid-cell wrapper in
 *   `TaskDataTable` owns roving focus and turns a click or an Enter/F2 press
 *   into `beginEdit({ taskId, columnId })`. A cell only asks "is that me?".
 * * **Committing** goes through `patcher.commit(taskId, field, value)`, which
 *   is one `PATCH /tasks/:id` and one per-cell spinner. Every editor commits on
 *   the interaction that ENDS the edit — a select, a blur, an Enter — and never
 *   per keystroke.
 * * **Cancelling** is Escape, and it means "leave the value alone", so the
 *   editor closes without a request.
 * * **Unchanged is not a commit.** Every editor compares against the value it
 *   opened with and skips the request when nothing moved. Without that, tabbing
 *   through a row fires ten PATCHes, each writing an activity entry that says
 *   nothing happened.
 * * **Closing always returns focus to the cell** (`endEdit` bumps the grid's
 *   focus token), so a keyboard user is never dropped back to the document.
 *
 * A viewer (`canWrite: false`) gets the display form only — the wrapper never
 * calls `beginEdit`, so the editors below are simply unreachable.
 */

/**
 * Radix `Select` forbids `value=""` (an empty value is how it spells "show the
 * placeholder"), so a nullable field needs a sentinel for its "none" option.
 * Chosen to be impossible as a uuid.
 */
const NONE_VALUE = '__none__';

export interface CellProps {
  task: TaskSummary;
}

// ───────────────────────────────────────────────────────────────────────────
// Shared cell chrome
// ───────────────────────────────────────────────────────────────────────────

/** The dash a null value renders as, so an empty cell still has a baseline. */
function EmptyValue() {
  return (
    <span aria-hidden className="text-muted-foreground/60">
      —
    </span>
  );
}

/**
 * The subtle per-cell saving indicator.
 *
 * Absolutely positioned at the cell's reading END rather than replacing the
 * value: the row must not reflow while a request is in flight, and the previous
 * value is still the truth until the response lands (`usePatchTask` writes the
 * authoritative row on success, so a cell shows old-value-plus-spinner in
 * between — which is honest).
 */
function SavingDot({ active }: { active: boolean }) {
  const { t } = useTranslation(['table']);
  if (!active) return null;

  return (
    <LoaderCircle
      role="status"
      aria-label={t('table:grid.saving')}
      className="absolute end-1 top-1/2 size-3 -translate-y-1/2 animate-spin text-muted-foreground"
    />
  );
}

/** The display shell: truncating content plus the saving dot. */
function Display({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5 truncate', className)}>{children}</span>
  );
}

/**
 * A `Select`-shaped editor, opened immediately and closed on either outcome.
 *
 * `defaultOpen` rather than a controlled `open`: the editor is MOUNTED by the
 * act of opening it, so its first render is already the open state and Radix
 * runs its own focus/typeahead machinery from there. Closing — whether by
 * choosing an option or by Escape — ends the edit, which unmounts this.
 */
function SelectEditor({
  value,
  ariaLabel,
  onSelect,
  onDismiss,
  children,
  renderValue,
}: {
  value: string;
  ariaLabel: string;
  onSelect: (next: string) => void;
  onDismiss: () => void;
  children: ReactNode;
  renderValue: ReactNode;
}) {
  return (
    <Select
      value={value}
      defaultOpen
      onValueChange={onSelect}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={ariaLabel}
        className="h-6 w-full border-0 px-1 shadow-none"
      >
        <SelectValue>{renderValue}</SelectValue>
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// key — read-only, links into the task sheet
// ───────────────────────────────────────────────────────────────────────────

/**
 * The task key as a mono chip that deep-links to the sheet.
 *
 * `tabIndex={-1}` is the ARIA grid pattern, not an accessibility slip: the CELL
 * carries the roving tab stop, and a focusable descendant would add a second
 * one per row — 100 rows would put 100 extra stops between the toolbar and the
 * footer. The wrapper's Enter handler follows the link instead.
 *
 * The path is RELATIVE (`t/FB-142`), because the sheet is a child route of this
 * view: `/o/acme/p/FB/table/t/FB-142` keeps the table mounted underneath.
 */
export function KeyCell({ task }: CellProps) {
  const { projectKey } = useTableGrid();
  const { t } = useTranslation(['table']);
  const key = `${projectKey}-${task.number}`;

  return (
    <Link
      to={`t/${key}`}
      tabIndex={-1}
      aria-label={t('table:grid.openTask', { key })}
      // `dir="ltr"`: a task key is a Latin identifier and must not be reordered
      // by the surrounding RTL paragraph direction.
      dir="ltr"
      className="rounded-[var(--radius)] px-1 font-mono text-xs tracking-tight text-muted-foreground tabular-nums transition-colors duration-[var(--speed)] hover:bg-accent hover:text-foreground"
    >
      {key}
    </Link>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// title
// ───────────────────────────────────────────────────────────────────────────

export function TitleCell({ task }: CellProps) {
  const { patcher, endEdit } = useTableGrid();
  const editing = useIsEditing(task.id, 'title');
  const { t } = useTranslation(['table']);
  const [draft, setDraft] = useState(task.title);
  const committed = useRef(false);

  // Re-seed whenever the editor opens, so a cancelled edit followed by a second
  // open does not resurrect the abandoned draft.
  useEffect(() => {
    if (editing) {
      setDraft(task.title);
      committed.current = false;
    }
  }, [editing, task.title]);

  if (!editing) {
    return (
      <Display>
        {/* User content — see `UserChip` in `components/common/UserAvatar.tsx`. */}
        <span dir="auto" className="truncate">
          {task.title}
        </span>
        <SavingDot active={patcher.isSaving(task.id, 'title')} />
      </Display>
    );
  }

  const commit = () => {
    if (committed.current) return;
    committed.current = true;

    const next = draft.trim();
    // An empty title is not a delete — the contract requires one — so an
    // emptied field reverts rather than erroring.
    if (next && next !== task.title) patcher.commit(task.id, 'title', next);
    endEdit();
  };

  return (
    <Input
      autoFocus
      value={draft}
      aria-label={t('table:editors.title')}
      maxLength={200}
      className="h-6 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-1"
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          committed.current = true;
          endEdit();
        }
      }}
    />
  );
}

// ───────────────────────────────────────────────────────────────────────────
// type / priority — icon selects over closed enums
// ───────────────────────────────────────────────────────────────────────────

export function TypeCell({ task }: CellProps) {
  const { patcher, endEdit } = useTableGrid();
  const editing = useIsEditing(task.id, 'type');
  const { typeLabel } = useTaskFieldLabels();
  const { t } = useTranslation(['table']);

  if (!editing) {
    return (
      <Display>
        <TaskTypeIcon type={task.type} />
        <span className="truncate">{typeLabel(task.type)}</span>
        <SavingDot active={patcher.isSaving(task.id, 'type')} />
      </Display>
    );
  }

  return (
    <SelectEditor
      value={task.type}
      ariaLabel={t('table:editors.type')}
      onDismiss={endEdit}
      onSelect={(next) => {
        if (next !== task.type) patcher.commit(task.id, 'type', next as TaskType);
        endEdit();
      }}
      renderValue={
        <>
          <TaskTypeIcon type={task.type} />
          {typeLabel(task.type)}
        </>
      }
    >
      {TASK_TYPES.map((type) => (
        <SelectItem key={type} value={type}>
          <TaskTypeIcon type={type} />
          {typeLabel(type)}
        </SelectItem>
      ))}
    </SelectEditor>
  );
}

export function PriorityCell({ task }: CellProps) {
  const { patcher, endEdit } = useTableGrid();
  const editing = useIsEditing(task.id, 'priority');
  const { priorityLabel } = useTaskFieldLabels();
  const { t } = useTranslation(['table']);

  if (!editing) {
    return (
      <Display>
        <PriorityIcon priority={task.priority} />
        <span className="truncate">{priorityLabel(task.priority)}</span>
        <SavingDot active={patcher.isSaving(task.id, 'priority')} />
      </Display>
    );
  }

  return (
    <SelectEditor
      value={task.priority}
      ariaLabel={t('table:editors.priority')}
      onDismiss={endEdit}
      onSelect={(next) => {
        if (next !== task.priority) patcher.commit(task.id, 'priority', next as TaskPriority);
        endEdit();
      }}
      renderValue={
        <>
          <PriorityIcon priority={task.priority} />
          {priorityLabel(task.priority)}
        </>
      }
    >
      {TASK_PRIORITIES.map((priority) => (
        <SelectItem key={priority} value={priority}>
          <PriorityIcon priority={priority} />
          {priorityLabel(priority)}
        </SelectItem>
      ))}
    </SelectEditor>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// status — the only editor whose options depend on the CURRENT value
// ───────────────────────────────────────────────────────────────────────────

/**
 * The status editor honours the project's transition whitelist.
 *
 * FORBIDDEN TARGETS ARE OMITTED, NOT DISABLED. On the board a blocked drop needs
 * an explanation, because the user aimed at a column and it refused; here the
 * list IS the affordance, and a row of greyed options invites the same futile
 * click once per row. `isTransitionAllowed` is the same pre-check the board
 * uses, reused rather than reimplemented — and the server re-validates every
 * PATCH regardless, so this list is a convenience, never the enforcement.
 *
 * A project with no transition rows has an open workflow: every status is
 * offered, which is what `isTransitionAllowed` returns for an empty whitelist.
 */
export function StatusCell({ task }: CellProps) {
  const { patcher, endEdit, statuses, transitions } = useTableGrid();
  const editing = useIsEditing(task.id, 'status');
  const { t } = useTranslation(['table']);

  const current = statuses.find((status) => status.id === task.statusId) ?? null;

  if (!editing) {
    return (
      <Display>
        {current ? (
          <>
            <LabelDot color={current.color} />
            <span className="truncate">{current.name}</span>
          </>
        ) : (
          <EmptyValue />
        )}
        <SavingDot active={patcher.isSaving(task.id, 'statusId')} />
      </Display>
    );
  }

  const reachable = statuses.filter((status) =>
    isTransitionAllowed(transitions, task.statusId, status.id),
  );

  return (
    <SelectEditor
      value={task.statusId}
      ariaLabel={t('table:editors.status')}
      onDismiss={endEdit}
      onSelect={(next) => {
        if (next !== task.statusId) patcher.commit(task.id, 'statusId', next);
        endEdit();
      }}
      renderValue={
        current ? (
          <>
            <LabelDot color={current.color} />
            {current.name}
          </>
        ) : null
      }
    >
      {reachable.map((status) => (
        <SelectItem key={status.id} value={status.id}>
          <LabelDot color={status.color} />
          {status.name}
        </SelectItem>
      ))}
    </SelectEditor>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// assignee
// ───────────────────────────────────────────────────────────────────────────

/**
 * The person picker, reusing `common/UserSelect` so the search behaviour and
 * keyboard model are the app's, not this view's.
 *
 * IT IS OPENED PROGRAMMATICALLY. `UserSelect` owns its popover state and
 * exposes no `open` prop, so entering the cell would otherwise render a closed
 * combobox that needs a SECOND click — every other editor in this table opens
 * on the first. Focusing and clicking the trigger it just rendered is the
 * smallest fix that does not fork the shared component; the alternative is a
 * second person picker in this folder that drifts from the first.
 */
export function AssigneeCell({ task }: CellProps) {
  const { patcher, endEdit, orgId } = useTableGrid();
  const editing = useIsEditing(task.id, 'assignee');
  const { t } = useTranslation(['table']);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    const trigger = hostRef.current?.querySelector<HTMLButtonElement>('button[role="combobox"]');
    trigger?.focus();
    trigger?.click();
  }, [editing]);

  if (!editing) {
    return (
      <Display>
        {task.assignee ? (
          <>
            <UserAvatar user={task.assignee} size="xs" label="" />
            <span className="truncate">{task.assignee.name}</span>
          </>
        ) : (
          <span className="truncate text-muted-foreground">{t('table:filters.unassigned')}</span>
        )}
        <SavingDot active={patcher.isSaving(task.id, 'assigneeId')} />
      </Display>
    );
  }

  return (
    <div
      ref={hostRef}
      onKeyDown={(event) => {
        // Escape reaches here only once Radix has closed its own popover, so
        // this is the "leave the cell" press rather than the "close the list"
        // one.
        if (event.key === 'Escape') {
          event.stopPropagation();
          endEdit();
        }
      }}
    >
      <UserSelect
        orgId={orgId}
        value={task.assignee?.id ?? null}
        ariaLabel={t('table:editors.assignee')}
        className="h-6 border-0 px-1 shadow-none"
        onChange={(userId) => {
          if (userId !== (task.assignee?.id ?? null)) patcher.commit(task.id, 'assigneeId', userId);
          endEdit();
        }}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// points
// ───────────────────────────────────────────────────────────────────────────

/**
 * Story points — a text input, not `type="number"`.
 *
 * A number input brings spinner buttons (a second click target inside a
 * gridcell), scroll-to-change (catastrophic in a scrolling table) and a
 * `valueAsNumber` that reads `''` as `NaN`. `inputMode="decimal"` gets the
 * numeric soft keyboard without any of that, and {@link parsePoints} does the
 * real work — including accepting a comma as the decimal separator and
 * preserving halves, which is the whole reason points are not integers.
 */
export function PointsCell({ task }: CellProps) {
  const { patcher, endEdit } = useTableGrid();
  const editing = useIsEditing(task.id, 'points');
  const { t } = useTranslation(['table']);
  const [draft, setDraft] = useState(() => formatPoints(task.storyPoints));
  const [invalid, setInvalid] = useState(false);
  const committed = useRef(false);

  useEffect(() => {
    if (editing) {
      setDraft(formatPoints(task.storyPoints));
      setInvalid(false);
      committed.current = false;
    }
  }, [editing, task.storyPoints]);

  if (!editing) {
    return (
      <Display className="justify-end tabular-nums">
        {task.storyPoints === null ? (
          <EmptyValue />
        ) : (
          <span dir="ltr">{formatPoints(task.storyPoints)}</span>
        )}
        <SavingDot active={patcher.isSaving(task.id, 'storyPoints')} />
      </Display>
    );
  }

  const commit = () => {
    if (committed.current) return;

    const parsed = parsePoints(draft);
    if (!parsed.ok) {
      // Keep the editor open on a bad value: closing it would silently discard
      // what the user typed, and they have no way to know why.
      setInvalid(true);
      return;
    }

    committed.current = true;
    if (parsed.value !== task.storyPoints) patcher.commit(task.id, 'storyPoints', parsed.value);
    endEdit();
  };

  return (
    <Input
      autoFocus
      dir="ltr"
      inputMode="decimal"
      value={draft}
      aria-label={t('table:editors.points')}
      aria-invalid={invalid || undefined}
      className="h-6 border-0 bg-transparent px-1 text-end text-sm tabular-nums shadow-none focus-visible:ring-1"
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          committed.current = true;
          endEdit();
        }
      }}
    />
  );
}

// ───────────────────────────────────────────────────────────────────────────
// sprint
// ───────────────────────────────────────────────────────────────────────────

export function SprintCell({ task }: CellProps) {
  const { patcher, endEdit, sprints } = useTableGrid();
  const editing = useIsEditing(task.id, 'sprint');
  const { t } = useTranslation(['table']);

  const current = sprints.find((sprint) => sprint.id === task.sprintId) ?? null;
  const backlogLabel = t('table:filters.backlog');

  if (!editing) {
    return (
      <Display>
        <span className={cn('truncate', !current && 'text-muted-foreground')}>
          {current?.name ?? backlogLabel}
        </span>
        <SavingDot active={patcher.isSaving(task.id, 'sprintId')} />
      </Display>
    );
  }

  return (
    <SelectEditor
      value={task.sprintId ?? NONE_VALUE}
      ariaLabel={t('table:editors.sprint')}
      onDismiss={endEdit}
      onSelect={(next) => {
        const sprintId = next === NONE_VALUE ? null : next;
        if (sprintId !== task.sprintId) patcher.commit(task.id, 'sprintId', sprintId);
        endEdit();
      }}
      renderValue={current?.name ?? backlogLabel}
    >
      <SelectItem value={NONE_VALUE}>{backlogLabel}</SelectItem>
      {sprints
        // A completed sprint's numbers are immutable — moving work into one
        // after the fact would rewrite a velocity figure that has been reported.
        .filter((sprint) => sprint.state !== 'completed')
        .map((sprint) => (
          <SelectItem key={sprint.id} value={sprint.id}>
            {sprint.name}
          </SelectItem>
        ))}
    </SelectEditor>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// labels
// ───────────────────────────────────────────────────────────────────────────

/**
 * The multi-select editor: a popover of checkboxes, committed as ONE patch when
 * it closes.
 *
 * Per-toggle commits would fire a request (and write an activity entry) for
 * every box in a burst of five, and each response would rewrite the row under
 * the open popover. A local draft plus a single `labelIds` write on close is
 * both fewer requests and the only version where the checkboxes stay still
 * while you are clicking them.
 */
export function LabelsCell({ task }: CellProps) {
  const { patcher, endEdit, labels } = useTableGrid();
  const editing = useIsEditing(task.id, 'labels');
  const { t } = useTranslation(['table']);
  const [draft, setDraft] = useState<string[]>(() => [...task.labelIds]);

  useEffect(() => {
    if (editing) setDraft([...task.labelIds]);
  }, [editing, task.labelIds]);

  const applied = labels.filter((label) => task.labelIds.includes(label.id));

  if (!editing) {
    return (
      <Display className="gap-1">
        {applied.length === 0 ? (
          <EmptyValue />
        ) : (
          applied.map((label) => (
            <span
              key={label.id}
              className="inline-flex max-w-[8rem] items-center gap-1 truncate rounded-[var(--radius)] px-1 text-xs"
              style={{ backgroundColor: `color-mix(in oklab, ${label.color} 14%, transparent)` }}
            >
              <LabelDot color={label.color} />
              <span className="truncate">{label.name}</span>
            </span>
          ))
        )}
        <SavingDot active={patcher.isSaving(task.id, 'labelIds')} />
      </Display>
    );
  }

  const close = (commit: boolean) => {
    const changed =
      commit &&
      (draft.length !== task.labelIds.length || draft.some((id) => !task.labelIds.includes(id)));

    if (changed) patcher.commit(task.id, 'labelIds', draft);
    endEdit();
  };

  return (
    <Popover
      defaultOpen
      onOpenChange={(open) => {
        if (!open) close(true);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="w-full justify-start px-1">
          {t('table:editors.labels')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        {labels.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">{t('table:editors.noLabels')}</p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {labels.map((label) => {
              const checked = draft.includes(label.id);
              return (
                <li key={label.id}>
                  <label className="flex cursor-default items-center gap-2 rounded-[var(--radius)] px-1.5 py-1 text-xs hover:bg-accent">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => {
                        setDraft((current) =>
                          current.includes(label.id)
                            ? current.filter((id) => id !== label.id)
                            : [...current, label.id],
                        );
                      }}
                    />
                    <LabelDot color={label.color} />
                    <span className="truncate">{label.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// start / due date
// ───────────────────────────────────────────────────────────────────────────

/**
 * A calendar popover over a `YYYY-MM-DD` string.
 *
 * The value never becomes an instant: {@link parseIsoDate} builds a LOCAL
 * midnight and {@link toIsoDate} reads the local parts back, so a due date the
 * user picked in Riyadh does not become the previous day for a reader in
 * London. Round-tripping through `new Date(iso)` — which is UTC for a date-only
 * string — is the bug this pair exists to prevent.
 */
function DateCell({ task, field }: CellProps & { field: 'startDate' | 'dueDate' }) {
  const { patcher, endEdit } = useTableGrid();
  const columnId = field;
  const editing = useIsEditing(task.id, columnId);
  const { t } = useTranslation(['table']);
  const { formatDate } = useTableFormatters();

  const iso = task[field];
  const selected = parseIsoDate(iso) ?? undefined;

  if (!editing) {
    const shown = formatDate(iso);
    return (
      <Display className="tabular-nums">
        {shown ? <span dir="ltr">{shown}</span> : <EmptyValue />}
        <SavingDot active={patcher.isSaving(task.id, field)} />
      </Display>
    );
  }

  const commit = (next: string | null) => {
    if (next !== iso) patcher.commit(task.id, field, next);
    endEdit();
  };

  return (
    <Popover
      defaultOpen
      onOpenChange={(open) => {
        if (!open) endEdit();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="w-full justify-start gap-1 px-1">
          <CalendarDays aria-hidden />
          <span dir="ltr" className="tabular-nums">
            {formatDate(iso) ?? t('table:editors.pickDate')}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          autoFocus
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            commit(date ? toIsoDate(date) : null);
          }}
        />
        {iso ? (
          <div className="border-t border-border p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                commit(null);
              }}
            >
              <X aria-hidden />
              {t('table:editors.clearDate')}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function StartDateCell({ task }: CellProps) {
  return <DateCell task={task} field="startDate" />;
}

export function DueDateCell({ task }: CellProps) {
  return <DateCell task={task} field="dueDate" />;
}

// ───────────────────────────────────────────────────────────────────────────
// updated — read-only
// ───────────────────────────────────────────────────────────────────────────

/**
 * "3 days ago", with the exact instant on hover.
 *
 * Relative time is what a scan wants ("is this stale?"); the absolute instant is
 * what a question wants ("when exactly?"). `<time dateTime>` carries the machine
 * form for anything reading the DOM.
 */
export function UpdatedCell({ task }: CellProps) {
  const { formatRelative, formatDateTime } = useTableFormatters();

  return (
    <Display className="text-muted-foreground">
      <time dateTime={task.updatedAt} title={formatDateTime(task.updatedAt)} className="truncate">
        {formatRelative(task.updatedAt)}
      </time>
    </Display>
  );
}
