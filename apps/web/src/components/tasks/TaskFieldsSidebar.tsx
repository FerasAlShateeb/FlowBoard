import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Check, ChevronsUpDown, Loader2, Plus, X } from 'lucide-react';
import type {
  Label as TaskLabel,
  PatchTaskInput,
  Sprint,
  Task,
  TaskPriority,
  TaskSummary,
} from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useLang } from '@/lib/lang-policy';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LabelChip, LabelDot } from '@/components/common/LabelDot';
import { UserAvatar } from '@/components/common/UserAvatar';
import { UserSelect } from '@/components/common/UserSelect';
import { useTaskVocabulary } from '@/components/common/task-vocabulary';
import { TASK_PRIORITIES, TaskPriorityIcon, TaskTypeIcon } from '@/components/tasks/task-visuals';
import { formatDateOnly, fromDateOnly, isOverdue, toDateOnly } from '@/components/tasks/task-dates';

/**
 * The task sheet's right-hand fields column.
 *
 * ── Every field commits on CHANGE ───────────────────────────────────────────
 *
 * There is no Save button and no dirty state: picking an assignee PATCHes the
 * assignee. A form here would mean a user could set four fields, navigate away,
 * and lose all four — and it would fight the socket layer, which pushes other
 * people's edits into the same cache. The only field with a commit boundary is
 * story points, and only because a number input is mid-edit on every keystroke
 * (see below).
 *
 * ── Two traps this file exists to avoid ─────────────────────────────────────
 *
 * 1. **Dates never round-trip through `Date`.** `startDate`/`dueDate` are
 *    `YYYY-MM-DD` calendar days. `components/tasks/task-dates.ts` converts them
 *    with LOCAL accessors in both directions; a `new Date(value)` /
 *    `toISOString()` pair would shift the day by one for every reader outside
 *    UTC, in opposite directions depending on which side of it they sit.
 *
 * 2. **Story points are fractional.** `0.5` is a legal estimate
 *    (`storyPointsSchema` allows it, and half-point scales are common), so the
 *    input uses `step="0.5"` and `Number.parseFloat` — never `parseInt`, never
 *    `Math.round`, both of which silently turn a half into a whole and look like
 *    the server rejecting the value.
 */

export interface TaskFieldsSidebarProps {
  task: Task;
  orgId: string | null | undefined;
  /** Every sprint of the project — the picker's options plus "Backlog". */
  sprints: readonly Sprint[];
  /** Candidate epics: the project's `type=epic` tasks, self already excluded. */
  epics: readonly TaskSummary[];
  /** The project's label vocabulary. */
  labels: readonly TaskLabel[];
  canEdit: boolean;
  /** True while a patch is in flight — drives the inline saving indicator. */
  isSaving: boolean;
  onPatch: (patch: PatchTaskInput) => void;
  /** Creates a label and attaches it. Absent when the role may not create one. */
  onCreateLabel?: (name: string) => void;
}

/** A labelled row. The label is a `<span>`, not a `<label>` — most controls here
 *  are composite widgets (a combobox button, a popover) with no single `<input>`
 *  for `htmlFor` to point at, so each control carries its own `aria-label`. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2 py-1">
      <span className="pt-1 text-[11px] text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A read-only row, for reporter and the timestamps. */
function ReadOnlyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2 py-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="min-w-0 text-xs text-foreground">{children}</div>
    </div>
  );
}

/** The `null` sprint (backlog) and `null` epic need a non-empty select value. */
const NONE_VALUE = '__none__';

export function TaskFieldsSidebar({
  task,
  orgId,
  sprints,
  epics,
  labels,
  canEdit,
  isSaving,
  onPatch,
  onCreateLabel,
}: TaskFieldsSidebarProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const vocabulary = useTaskVocabulary();
  const lang = useLang();

  /**
   * Story points live in local state while the field has focus.
   *
   * A number input is in an INVALID intermediate state on almost every
   * keystroke — "0." on the way to "0.5", "" on the way to a new value — and
   * PATCHing each of those would send a stream of nonsense and fight the user's
   * caret when the response wrote a normalized value back. So the draft is
   * local, and the commit happens on blur or Enter.
   */
  const [pointsDraft, setPointsDraft] = useState<string>(
    task.storyPoints === null ? '' : String(task.storyPoints),
  );

  // Re-seed when the SERVER's value changes (another tab, a socket patch, or a
  // different task in the sheet) — but not on every render, which would fight
  // typing.
  useEffect(() => {
    setPointsDraft(task.storyPoints === null ? '' : String(task.storyPoints));
  }, [task.id, task.storyPoints]);

  const commitPoints = () => {
    const trimmed = pointsDraft.trim();
    if (trimmed === '') {
      if (task.storyPoints !== null) onPatch({ storyPoints: null });
      return;
    }
    // parseFloat, never parseInt: 0.5 is a legal estimate.
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setPointsDraft(task.storyPoints === null ? '' : String(task.storyPoints));
      return;
    }
    if (parsed !== task.storyPoints) onPatch({ storyPoints: parsed });
  };

  const labelIds = useMemo(() => new Set(task.labels.map((label) => label.id)), [task.labels]);

  const toggleLabel = (labelId: string) => {
    const next = new Set(labelIds);
    if (next.has(labelId)) next.delete(labelId);
    else next.add(labelId);
    onPatch({ labelIds: [...next] });
  };

  return (
    <aside
      aria-label={t('tasks:fields.heading')}
      className="flex flex-col gap-0.5 rounded-[var(--card-radius)] border border-border bg-surface-raised/40 p-3"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{t('tasks:fields.heading')}</h3>
        {isSaving ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            {t('tasks:fields.saving')}
          </span>
        ) : null}
      </div>

      {/* ── Assignee ──────────────────────────────────────────────────────── */}
      <Field label={t('tasks:fields.assignee')}>
        <UserSelect
          orgId={orgId}
          value={task.assignee?.id ?? null}
          disabled={!canEdit}
          ariaLabel={t('tasks:fields.assignee')}
          placeholder={t('tasks:fields.unassigned')}
          onChange={(userId) => {
            onPatch({ assigneeId: userId });
          }}
        />
      </Field>

      {/* ── Priority ──────────────────────────────────────────────────────── */}
      <Field label={t('tasks:fields.priority')}>
        <Select
          value={task.priority}
          disabled={!canEdit}
          onValueChange={(value) => {
            onPatch({ priority: value as TaskPriority });
          }}
        >
          <SelectTrigger size="sm" aria-label={t('tasks:fields.priority')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_PRIORITIES.map((priority) => (
              <SelectItem key={priority} value={priority}>
                <TaskPriorityIcon priority={priority} />
                {vocabulary.priorityName(priority)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* ── Story points ──────────────────────────────────────────────────── */}
      <Field label={t('tasks:fields.storyPoints')}>
        <Input
          type="number"
          inputMode="decimal"
          // Halves are a real estimate on a Fibonacci-ish scale, so the stepper
          // must offer them and the parser must keep them.
          step={0.5}
          min={0}
          max={1000}
          value={pointsDraft}
          disabled={!canEdit}
          aria-label={t('tasks:fields.storyPoints')}
          title={t('tasks:fields.storyPointsHint')}
          className="h-8 w-24"
          onChange={(event) => {
            setPointsDraft(event.target.value);
          }}
          onBlur={commitPoints}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitPoints();
            }
          }}
        />
      </Field>

      {/* ── Dates ─────────────────────────────────────────────────────────── */}
      <Field label={t('tasks:fields.startDate')}>
        <DateField
          value={task.startDate}
          lang={lang}
          disabled={!canEdit}
          ariaLabel={t('tasks:fields.startDate')}
          onChange={(next) => {
            onPatch({ startDate: next });
          }}
        />
      </Field>

      <Field label={t('tasks:fields.dueDate')}>
        <DateField
          value={task.dueDate}
          lang={lang}
          disabled={!canEdit}
          highlightOverdue
          ariaLabel={t('tasks:fields.dueDate')}
          onChange={(next) => {
            onPatch({ dueDate: next });
          }}
        />
      </Field>

      {/* ── Sprint ────────────────────────────────────────────────────────── */}
      <Field label={t('tasks:fields.sprint')}>
        <Select
          value={task.sprintId ?? NONE_VALUE}
          disabled={!canEdit}
          onValueChange={(value) => {
            onPatch({ sprintId: value === NONE_VALUE ? null : value });
          }}
        >
          <SelectTrigger size="sm" aria-label={t('tasks:fields.sprint')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* Backlog is `sprintId: null`, not a sprint with a special name. */}
            <SelectItem value={NONE_VALUE}>{t('tasks:fields.backlog')}</SelectItem>
            {sprints.map((sprint) => (
              <SelectItem key={sprint.id} value={sprint.id}>
                {sprint.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* ── Epic ──────────────────────────────────────────────────────────── */}
      <Field label={t('tasks:fields.epic')}>
        <Select
          value={task.epicId ?? NONE_VALUE}
          disabled={!canEdit}
          onValueChange={(value) => {
            onPatch({ epicId: value === NONE_VALUE ? null : value });
          }}
        >
          <SelectTrigger size="sm" aria-label={t('tasks:fields.epic')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>{t('tasks:fields.noEpic')}</SelectItem>
            {epics.map((epic) => (
              <SelectItem key={epic.id} value={epic.id}>
                <TaskTypeIcon type="epic" />
                {epic.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* ── Labels ────────────────────────────────────────────────────────── */}
      <Field label={t('tasks:fields.labels')}>
        <LabelPicker
          all={labels}
          selected={task.labels}
          disabled={!canEdit}
          onToggle={toggleLabel}
          onCreate={onCreateLabel}
        />
      </Field>

      <div className="my-1 h-px bg-border" />

      {/* ── Read-only provenance ──────────────────────────────────────────── */}
      <ReadOnlyField label={t('tasks:fields.reporter')}>
        <span className="flex items-center gap-1.5">
          <UserAvatar user={task.reporter} size="xs" label="" />
          {/* User content: `dir="auto"` — see `UserChip` in `UserAvatar`. */}
          <span dir="auto" className="truncate">
            {task.reporter?.name ?? '—'}
          </span>
        </span>
      </ReadOnlyField>

      <ReadOnlyField label={t('tasks:fields.created')}>
        <time dateTime={task.createdAt} className="text-muted-foreground">
          {formatDateTimeLabel(task.createdAt, lang)}
        </time>
      </ReadOnlyField>

      <ReadOnlyField label={t('tasks:fields.updated')}>
        <time dateTime={task.updatedAt} className="text-muted-foreground">
          {formatDateTimeLabel(task.updatedAt, lang)}
        </time>
      </ReadOnlyField>

      {task.resolvedAt === null ? null : (
        <ReadOnlyField label={t('tasks:fields.resolved')}>
          <time dateTime={task.resolvedAt} className="text-success">
            {formatDateTimeLabel(task.resolvedAt, lang)}
          </time>
        </ReadOnlyField>
      )}
    </aside>
  );
}

/** Local shim so the import list stays honest about what this file uses. */
function formatDateTimeLabel(value: string, lang: string): string {
  // Deliberately the DATE-ONLY reading of an instant: the sidebar has ~90px of
  // room, and "3 Mar 2026, 14:22" wraps to two lines in both languages.
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateOnly(toDateOnly(date), lang);
}

// ───────────────────────────────────────────────────────────────────────────
// Date field
// ───────────────────────────────────────────────────────────────────────────

/**
 * A `YYYY-MM-DD` field: a button showing the day, a calendar in a popover, and
 * a clear affordance.
 *
 * The popover closes on selection. A date picker that stays open after a pick
 * makes the user hunt for a way out of a decision they have already made.
 */
function DateField({
  value,
  lang,
  disabled,
  ariaLabel,
  highlightOverdue = false,
  onChange,
}: {
  value: string | null;
  lang: string;
  disabled: boolean;
  ariaLabel: string;
  highlightOverdue?: boolean;
  onChange: (next: string | null) => void;
}) {
  const { t } = useTranslation(['tasks', 'common']);
  const [open, setOpen] = useState(false);

  const selected = fromDateOnly(value);
  const overdue = highlightOverdue && isOverdue(value);

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={ariaLabel}
            className={cn('h-8 flex-1 justify-start gap-1.5 font-normal', overdue && 'text-danger')}
          >
            <CalendarDays className="size-3.5 opacity-60" aria-hidden />
            <span className={cn('truncate', value === null && 'text-muted-foreground')}>
              {value === null ? t('tasks:fields.pickDate') : formatDateOnly(value, lang)}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            autoFocus
            onSelect={(next) => {
              // `toDateOnly` reads LOCAL Y/M/D — see the header note on why
              // `toISOString().slice(0, 10)` is wrong here.
              onChange(next ? toDateOnly(next) : null);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      {value !== null && !disabled ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          // Named after the FIELD: the sidebar carries two of these, and two
          // buttons both called "Clear date" are indistinguishable to anyone
          // navigating by voice or by screen reader.
          aria-label={t('tasks:fields.clearDate', { field: ariaLabel })}
          onClick={() => {
            onChange(null);
          }}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Label picker
// ───────────────────────────────────────────────────────────────────────────

/**
 * A multi-select over the project's label vocabulary, with inline creation.
 *
 * The popover STAYS OPEN while toggling — labelling is a burst of decisions,
 * and closing after each one turns four labels into four round trips through
 * the trigger (the same reasoning `common/UserMultiSelect` documents).
 *
 * Inline creation is offered only when `onCreate` is supplied, which the sheet
 * gates on the caller's project role: creating a label edits the project's
 * shared vocabulary, so it is not something a member does by accident from a
 * task panel — but a member who is allowed to should not have to leave for
 * Settings mid-thought.
 */
function LabelPicker({
  all,
  selected,
  disabled,
  onToggle,
  onCreate,
}: {
  all: readonly TaskLabel[];
  selected: readonly TaskLabel[];
  disabled: boolean;
  onToggle: (labelId: string) => void;
  onCreate?: (name: string) => void;
}) {
  const { t } = useTranslation(['tasks', 'common']);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedIds = new Set(selected.map((label) => label.id));
  const trimmed = search.trim();
  const exists = all.some((label) => label.name.toLowerCase() === trimmed.toLowerCase());
  const canCreate = onCreate !== undefined && trimmed !== '' && !exists;

  return (
    <div className="flex flex-col gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            aria-label={t('tasks:fields.labels')}
            className="h-8 w-full justify-between gap-2 font-normal"
          >
            {/* Label names are user content — see `UserChip` in `UserAvatar`. */}
            <span
              dir="auto"
              className={cn('truncate', selected.length === 0 && 'text-muted-foreground')}
            >
              {selected.length === 0
                ? t('tasks:fields.noLabels')
                : selected.map((label) => label.name).join(', ')}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command label={t('tasks:fields.labels')}>
            <CommandInput
              placeholder={t('tasks:fields.searchLabels')}
              autoFocus
              // `onInput`, not `onChange`: `ui/command` OWNS the input's value
              // and its `onChange` (they are `Omit`ted from its props), so this
              // is the read-only mirror the "create" row needs to know what was
              // typed — the filtering itself still happens inside Command.
              onInput={(event) => {
                setSearch(event.currentTarget.value);
              }}
            />
            <CommandList>
              <CommandEmpty>{t('tasks:fields.noLabelMatches')}</CommandEmpty>
              {all.map((label) => (
                <CommandItem
                  key={label.id}
                  value={label.name}
                  onSelect={() => {
                    onToggle(label.id);
                  }}
                >
                  <LabelDot color={label.color} />
                  <span dir="auto" className="truncate">
                    {label.name}
                  </span>
                  {selectedIds.has(label.id) ? (
                    <Check className="ms-auto size-3.5" aria-hidden />
                  ) : null}
                </CommandItem>
              ))}
            </CommandList>

            {canCreate ? (
              <div className="border-t border-border p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    onCreate(trimmed);
                    setSearch('');
                    setOpen(false);
                  }}
                >
                  <Plus aria-hidden />
                  {t('tasks:fields.createLabel', { name: trimmed })}
                </Button>
              </div>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {selected.map((label) => (
            <li key={label.id}>
              <LabelChip label={label} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default TaskFieldsSidebar;
