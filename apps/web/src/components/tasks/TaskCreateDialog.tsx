import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Check, ChevronsUpDown } from 'lucide-react';
import type { z } from 'zod';
import { createTaskInputSchema, type Task } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useCreateTask } from '@/hooks/useTaskMutations';
import { useLabels } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { useStatuses } from '@/hooks/useWorkflow';
import FormDialog from '@/components/common/FormDialog';
import UserSelect from '@/components/common/UserSelect';
import { LabelChip, LabelDot } from '@/components/common/LabelDot';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useTaskVocabulary } from '@/components/common/task-vocabulary';
import {
  StatusDot,
  TASK_PRIORITIES,
  TASK_TYPES,
  TaskPriorityIcon,
  TaskTypeIcon,
} from '@/components/tasks/task-visuals';

/**
 * The standalone "create task" dialog.
 *
 * ── Why it lives in WP3.2 but is used by nobody here ────────────────────────
 *
 * Creating a task is a BOARD, BACKLOG and COMMAND-PALETTE action ("C" from
 * anywhere), and each of those is a different work package. What they must not
 * do is each build their own dialog: three dialogs means three sets of defaults,
 * three answers to "does this respect the workflow's first column", and three
 * places for the create contract to drift. So the dialog is authored once, next
 * to the task domain it belongs to, and EXPORTED for those callers to mount.
 *
 * ── Two decisions worth knowing ─────────────────────────────────────────────
 *
 * 1. **`statusId` is optional on the wire and optional here.** Omitted, the
 *    server drops the task in the project's first `todo` column — which is what
 *    a quick-add wants, and what keeps the client from having to know the
 *    workflow's shape. The field is still offered, because a create dialog
 *    opened from a board COLUMN should be able to say which one.
 *
 * 2. **The form binds the schema's INPUT type.** `createTaskInputSchema` gives
 *    almost every field a `.default()`, so its input type has them optional and
 *    its output type does not. Binding the input keeps `defaultValues` honest,
 *    and `onSubmit` fills the gaps explicitly rather than widening the
 *    mutation's signature — the contract stays the single authority on what a
 *    create looks like.
 */

type CreateTaskValues = z.input<typeof createTaskInputSchema>;

/** Radix Select has no empty value, so "unset" needs a sentinel. */
const NONE_VALUE = '__none__';

function emptyValues(): CreateTaskValues {
  return {
    title: '',
    description: null,
    type: 'task',
    priority: 'medium',
    assigneeId: null,
    storyPoints: null,
    startDate: null,
    dueDate: null,
    sprintId: null,
    epicId: null,
    parentId: null,
    labelIds: [],
    watcherIds: [],
  };
}

export interface TaskCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string | null | undefined;
  /** Pre-selects a column — what a board's per-column "+" passes. */
  defaultStatusId?: string;
  /** Pre-selects a sprint — what the backlog's per-sprint quick-add passes. */
  defaultSprintId?: string | null;
  /** Fires with the created task, for callers that navigate to it. */
  onCreated?: (task: Task) => void;
}

export function TaskCreateDialog({
  open,
  onOpenChange,
  projectId,
  orgId,
  defaultStatusId,
  defaultSprintId = null,
  onCreated,
}: TaskCreateDialogProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const vocabulary = useTaskVocabulary();

  const createTask = useCreateTask(projectId);
  const { statuses } = useStatuses(projectId);
  const { data: sprints } = useSprints(projectId);
  const { data: labels } = useLabels(projectId);

  const form = useForm<CreateTaskValues>({
    resolver: zodResolver(createTaskInputSchema),
    defaultValues: { ...emptyValues(), statusId: defaultStatusId, sprintId: defaultSprintId },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const { reset } = form;

  // Re-seed on OPEN, not on mount: the dialog stays mounted between uses, and a
  // second open must not arrive holding the previous attempt's text.
  useEffect(() => {
    if (!open) return;
    reset({ ...emptyValues(), statusId: defaultStatusId, sprintId: defaultSprintId });
  }, [open, reset, defaultStatusId, defaultSprintId]);

  const onSubmit = (values: CreateTaskValues) => {
    createTask.mutate(
      {
        title: values.title,
        description: values.description ?? null,
        type: values.type ?? 'task',
        // `undefined`, not `null`: the field is OPTIONAL on the wire, and
        // sending an explicit null would be a different (invalid) request.
        ...(values.statusId === undefined ? {} : { statusId: values.statusId }),
        priority: values.priority ?? 'medium',
        assigneeId: values.assigneeId ?? null,
        storyPoints: values.storyPoints ?? null,
        startDate: values.startDate ?? null,
        dueDate: values.dueDate ?? null,
        sprintId: values.sprintId ?? null,
        epicId: values.epicId ?? null,
        parentId: values.parentId ?? null,
        labelIds: values.labelIds ?? [],
        watcherIds: values.watcherIds ?? [],
      },
      {
        onSuccess: (task) => {
          onOpenChange(false);
          onCreated?.(task);
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('tasks:create.title')}
      form={form}
      onSubmit={onSubmit}
      submitLabel={t('tasks:create.submit')}
      isPending={createTask.isPending}
    >
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('tasks:create.titleField')}</FormLabel>
            <FormControl>
              <Input {...field} autoFocus placeholder={t('tasks:create.titlePlaceholder')} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('tasks:create.typeField')}</FormLabel>
              <Select value={field.value ?? 'task'} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {TASK_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      <TaskTypeIcon type={type} />
                      {vocabulary.typeName(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="statusId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('tasks:create.statusField')}</FormLabel>
              <Select
                value={field.value ?? NONE_VALUE}
                onValueChange={(value) => {
                  field.onChange(value === NONE_VALUE ? undefined : value);
                }}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {/* "Let the server decide" is a real choice, not a blank. */}
                  <SelectItem value={NONE_VALUE}>{t('tasks:category.todo')}</SelectItem>
                  {statuses.map((status) => (
                    <SelectItem key={status.id} value={status.id}>
                      <StatusDot status={status} />
                      {status.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="assigneeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('tasks:create.assigneeField')}</FormLabel>
              <UserSelect
                orgId={orgId}
                value={field.value ?? null}
                onChange={field.onChange}
                ariaLabel={t('tasks:create.assigneeField')}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="priority"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('tasks:create.priorityField')}</FormLabel>
              <Select value={field.value ?? 'medium'} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {TASK_PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      <TaskPriorityIcon priority={priority} />
                      {vocabulary.priorityName(priority)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="storyPoints"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('tasks:create.pointsField')}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  inputMode="decimal"
                  // Halves are legal estimates; `parseFloat`, never `parseInt`.
                  step={0.5}
                  min={0}
                  max={1000}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={field.value ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value;
                    if (raw.trim() === '') {
                      field.onChange(null);
                      return;
                    }
                    const parsed = Number.parseFloat(raw);
                    field.onChange(Number.isFinite(parsed) ? parsed : null);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="sprintId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('tasks:create.sprintField')}</FormLabel>
              <Select
                value={field.value ?? NONE_VALUE}
                onValueChange={(value) => {
                  field.onChange(value === NONE_VALUE ? null : value);
                }}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>{t('tasks:fields.backlog')}</SelectItem>
                  {(sprints ?? []).map((sprint) => (
                    <SelectItem key={sprint.id} value={sprint.id}>
                      {sprint.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="labelIds"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('tasks:create.labelsField')}</FormLabel>
            <LabelMultiSelect
              all={labels ?? []}
              selected={field.value ?? []}
              onChange={field.onChange}
            />
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('tasks:create.descriptionField')}</FormLabel>
            <FormControl>
              <Textarea
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                value={field.value ?? ''}
                rows={4}
                placeholder={t('tasks:create.descriptionPlaceholder')}
                onChange={(event) => {
                  // The contract's "no description" is `null`, not `''`.
                  const next = event.target.value;
                  field.onChange(next.length === 0 ? null : next);
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialog>
  );
}

/**
 * A plain multi-select over the project's labels.
 *
 * A PLAIN textarea and a plain picker are the point of this dialog: creating a
 * task is a fast, low-ceremony act, and a markdown editor with mention
 * autocomplete belongs on the detail sheet where the writing actually happens.
 */
function LabelMultiSelect({
  all,
  selected,
  onChange,
}: {
  all: readonly { id: string; name: string; color: string; projectId: string }[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation(['tasks', 'common']);
  const [open, setOpen] = useState(false);

  const selectedSet = new Set(selected);
  const chosen = all.filter((label) => selectedSet.has(label.id));

  const toggle = (labelId: string) => {
    const next = new Set(selectedSet);
    if (next.has(labelId)) next.delete(labelId);
    else next.add(labelId);
    onChange([...next]);
  };

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
            aria-label={t('tasks:create.labelsField')}
            className="h-8 w-full justify-between gap-2 font-normal"
          >
            <span className={cn('truncate', chosen.length === 0 && 'text-muted-foreground')}>
              {chosen.length === 0
                ? t('tasks:fields.noLabels')
                : chosen.map((label) => label.name).join(', ')}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command label={t('tasks:create.labelsField')}>
            <CommandInput placeholder={t('tasks:fields.searchLabels')} autoFocus />
            <CommandList>
              <CommandEmpty>{t('tasks:fields.noLabelMatches')}</CommandEmpty>
              {all.map((label) => (
                <CommandItem
                  key={label.id}
                  value={label.name}
                  // The popover stays OPEN: labelling is a burst of decisions.
                  onSelect={() => {
                    toggle(label.id);
                  }}
                >
                  <LabelDot color={label.color} />
                  <span dir="auto" className="truncate">
                    {label.name}
                  </span>
                  {selectedSet.has(label.id) ? (
                    <Check className="ms-auto size-3.5" aria-hidden />
                  ) : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {chosen.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {chosen.map((label) => (
            <li key={label.id}>
              <LabelChip label={label} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default TaskCreateDialog;
