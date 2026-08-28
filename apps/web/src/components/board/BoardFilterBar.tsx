import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronsUpDown, Rows3, Search, X } from 'lucide-react';
import type { TaskPriority, TaskType } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useLabels } from '@/hooks/useProjects';
import { useOrgUsers } from '@/hooks/useOrgs';
import {
  NO_VALUE,
  SWIMLANE_MODES,
  activeFilterCount,
  useBoardFilterState,
  useBoardFilterStore,
  type SwimlaneMode,
} from '@/stores/useBoardFilterStore';
import { LabelDot } from '@/components/common/LabelDot';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import {
  PriorityIcon,
  TASK_PRIORITIES,
  TASK_TYPES,
  TaskTypeIcon,
} from '@/components/common/task-icons';
import { useTaskVocabulary } from '@/components/common/task-vocabulary';

/**
 * The board's filter bar: four multi-selects, a text query, the swimlane
 * picker, and a chip row showing exactly what is currently narrowing the board.
 *
 * ── WHY THE CHIP ROW EXISTS ────────────────────────────────────────────────
 * Filters PERSIST per project (`fb-board-filters-v1`), so the board you come
 * back to tomorrow may already be filtered. Without a visible, individually
 * removable chip for every active value, "where did my cards go?" has no
 * answer on screen — and a count badge alone tells you that something is
 * filtered without telling you what.
 *
 * ── WHY THE TEXT QUERY IS DEBOUNCED HERE, NOT IN THE STORE ─────────────────
 * `q` is a SERVER filter (trigram + key prefix), and it is part of the board's
 * cache key. A store write per keystroke would be a request per keystroke and a
 * cache entry per prefix. The live value lives in local state; the store — and
 * therefore the query — sees it 300ms after typing stops.
 */

const DEBOUNCE_MS = 300;

interface FilterOption {
  value: string;
  label: string;
  icon?: ReactNode;
  /** Extra match targets for the command palette's matcher (e.g. an email). */
  keywords?: string[];
}

/**
 * A popover multi-select over `ui/command`.
 *
 * The popover deliberately stays OPEN while values are toggled: filtering is a
 * burst ("these two people, those three labels"), and closing after each pick
 * turns five choices into five round trips through the trigger. Same call the
 * `UserMultiSelect` in `common/UserSelect` makes.
 */
function FilterPopover({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly FilterOption[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}) {
  const { t } = useTranslation(['board']);
  const [open, setOpen] = useState(false);
  const chosen = new Set(selected);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className={cn('gap-1.5 font-normal', chosen.size > 0 && 'border-primary/50')}
        >
          {label}
          {chosen.size > 0 ? (
            <Badge
              variant="soft-primary"
              className="px-1 tabular-nums"
              aria-label={t('board:filters.selected', { count: chosen.size })}
            >
              {chosen.size}
            </Badge>
          ) : null}
          <ChevronsUpDown className="size-3 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-56 p-0">
        <Command label={label}>
          <CommandInput placeholder={t('board:filters.optionSearch')} autoFocus />
          <CommandList>
            <CommandEmpty>{t('board:filters.noMatches')}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={option.label}
                keywords={option.keywords}
                onSelect={() => {
                  onToggle(option.value);
                }}
              >
                {option.icon}
                <span className="truncate">{option.label}</span>
                {chosen.has(option.value) ? (
                  <Check className="ms-auto size-3.5" aria-hidden />
                ) : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** One active value, with the control that removes it. */
function FilterChip({
  label,
  icon,
  onRemove,
  removeLabel,
}: {
  label: string;
  icon?: ReactNode;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-border bg-surface-raised py-0.5 pe-1 ps-1.5 text-xs">
      {icon}
      <span className="max-w-[10rem] truncate">{label}</span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="inline-flex size-4 items-center justify-center rounded-[var(--btn-radius)] text-muted-foreground transition-colors duration-[var(--speed)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

export function BoardFilterBar({
  projectId,
  orgId,
  className,
}: {
  projectId: string;
  orgId: string | null;
  className?: string;
}) {
  const { t } = useTranslation(['board', 'common']);
  const vocabulary = useTaskVocabulary();
  const state = useBoardFilterState(projectId);

  const toggleAssignee = useBoardFilterStore((store) => store.toggleAssignee);
  const toggleType = useBoardFilterStore((store) => store.toggleType);
  const togglePriority = useBoardFilterStore((store) => store.togglePriority);
  const toggleLabel = useBoardFilterStore((store) => store.toggleLabel);
  const setQuery = useBoardFilterStore((store) => store.setQuery);
  const setSwimlane = useBoardFilterStore((store) => store.setSwimlane);
  const clearFilters = useBoardFilterStore((store) => store.clearFilters);

  const { data: users } = useOrgUsers(orgId);
  const { data: labels } = useLabels(projectId);

  // ── the debounced text query ──────────────────────────────────────────────
  const [text, setText] = useState(state.query);

  // Follow the store when it changes from elsewhere — "clear filters", or a
  // project switch restoring a different saved query.
  useEffect(() => {
    setText(state.query);
  }, [state.query]);

  useEffect(() => {
    if (text === state.query) return;
    const timer = setTimeout(() => {
      setQuery(projectId, text);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text, state.query, projectId, setQuery]);

  // ── options ───────────────────────────────────────────────────────────────
  const assigneeOptions = useMemo<FilterOption[]>(() => {
    const options: FilterOption[] = [
      {
        value: NO_VALUE,
        label: t('board:filters.unassigned'),
        icon: <UserAvatar user={null} size="xs" label="" />,
      },
    ];
    for (const entry of users ?? []) {
      options.push({
        value: entry.user.id,
        label: entry.user.name,
        keywords: [entry.email],
        icon: <UserAvatar user={entry.user} size="xs" label="" />,
      });
    }
    return options;
  }, [users, t]);

  const typeOptions = useMemo<FilterOption[]>(
    () =>
      TASK_TYPES.map((type) => ({
        value: type,
        label: vocabulary.typeName(type),
        icon: <TaskTypeIcon type={type} />,
      })),
    [vocabulary],
  );

  const priorityOptions = useMemo<FilterOption[]>(
    () =>
      TASK_PRIORITIES.map((priority) => ({
        value: priority,
        label: vocabulary.priorityName(priority),
        icon: <PriorityIcon priority={priority} />,
      })),
    [vocabulary],
  );

  const labelOptions = useMemo<FilterOption[]>(
    () =>
      (labels ?? []).map((label) => ({
        value: label.id,
        label: label.name,
        icon: <LabelDot color={label.color} />,
      })),
    [labels],
  );

  const optionLabel = (options: readonly FilterOption[], value: string): string =>
    options.find((option) => option.value === value)?.label ?? value;
  const optionIcon = (options: readonly FilterOption[], value: string): ReactNode =>
    options.find((option) => option.value === value)?.icon;

  const activeCount = activeFilterCount(state);

  return (
    <div
      data-slot="board-filter-bar"
      role="search"
      aria-label={t('board:filters.label')}
      className={cn('flex flex-col gap-2', className)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative">
          {/* `start-2` + `ps-7`: the glyph sits at the reading start, so it
              swaps sides with the text under Arabic without a second rule. */}
          <Search
            className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            placeholder={t('board:filters.searchPlaceholder')}
            aria-label={t('board:filters.searchLabel')}
            className="h-7 w-48 ps-7 text-xs"
          />
        </div>

        <FilterPopover
          label={t('board:filters.assignee')}
          options={assigneeOptions}
          selected={state.assigneeIds}
          onToggle={(value) => {
            toggleAssignee(projectId, value);
          }}
        />
        <FilterPopover
          label={t('board:filters.type')}
          options={typeOptions}
          selected={state.types}
          onToggle={(value) => {
            toggleType(projectId, value as TaskType);
          }}
        />
        <FilterPopover
          label={t('board:filters.priority')}
          options={priorityOptions}
          selected={state.priorities}
          onToggle={(value) => {
            togglePriority(projectId, value as TaskPriority);
          }}
        />
        <FilterPopover
          label={t('board:filters.labels')}
          options={labelOptions}
          selected={state.labelIds}
          onToggle={(value) => {
            toggleLabel(projectId, value);
          }}
        />

        <Select
          value={state.swimlane}
          onValueChange={(value) => {
            setSwimlane(projectId, value as SwimlaneMode);
          }}
        >
          <SelectTrigger size="sm" aria-label={t('board:swimlanes.label')} className="ms-auto">
            <Rows3 className="size-3.5" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {SWIMLANE_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {t(`board:swimlanes.${mode}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activeCount > 0 ? (
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label={t('board:filters.activeLabel', { count: activeCount })}
        >
          {state.assigneeIds.map((value) => (
            <FilterChip
              key={`assignee-${value}`}
              label={optionLabel(assigneeOptions, value)}
              icon={optionIcon(assigneeOptions, value)}
              removeLabel={t('board:filters.remove', {
                name: optionLabel(assigneeOptions, value),
              })}
              onRemove={() => {
                toggleAssignee(projectId, value);
              }}
            />
          ))}
          {state.types.map((value) => (
            <FilterChip
              key={`type-${value}`}
              label={optionLabel(typeOptions, value)}
              icon={optionIcon(typeOptions, value)}
              removeLabel={t('board:filters.remove', { name: optionLabel(typeOptions, value) })}
              onRemove={() => {
                toggleType(projectId, value);
              }}
            />
          ))}
          {state.priorities.map((value) => (
            <FilterChip
              key={`priority-${value}`}
              label={optionLabel(priorityOptions, value)}
              icon={optionIcon(priorityOptions, value)}
              removeLabel={t('board:filters.remove', {
                name: optionLabel(priorityOptions, value),
              })}
              onRemove={() => {
                togglePriority(projectId, value);
              }}
            />
          ))}
          {state.labelIds.map((value) => (
            <FilterChip
              key={`label-${value}`}
              label={optionLabel(labelOptions, value)}
              icon={optionIcon(labelOptions, value)}
              removeLabel={t('board:filters.remove', { name: optionLabel(labelOptions, value) })}
              onRemove={() => {
                toggleLabel(projectId, value);
              }}
            />
          ))}
          {state.query.trim().length > 0 ? (
            <FilterChip
              label={t('board:filters.queryChip', { value: state.query })}
              removeLabel={t('board:filters.remove', { name: state.query })}
              onRemove={() => {
                setQuery(projectId, '');
              }}
            />
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              clearFilters(projectId);
            }}
          >
            {t('board:filters.clearAll')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default BoardFilterBar;
