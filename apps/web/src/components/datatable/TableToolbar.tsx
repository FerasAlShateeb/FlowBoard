import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ListFilter, LoaderCircle, Search, X } from 'lucide-react';
import type { Label, Sprint, Status } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useOrgUsers } from '@/hooks/useOrgs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LabelDot } from '@/components/common/LabelDot';
import { UserAvatar } from '@/components/common/UserAvatar';
import ColumnConfigPopover from '@/components/datatable/ColumnConfigPopover';
import {
  FILTER_KEYS,
  NONE_SENTINEL,
  activeFilterCount,
  clearFilter,
  emptyTableFilters,
  toggleFilterValue,
  type TableFilterKey,
  type TableFilterState,
} from '@/components/datatable/table-filters';
import type { TableColumnPrefs } from '@/components/datatable/table-prefs';
import {
  PriorityIcon,
  TASK_PRIORITIES,
  TASK_TYPES,
  TaskTypeIcon,
  useTaskFieldLabels,
} from '@/components/datatable/task-fields';
import { CSV_EXPORT_CAP } from '@/components/datatable/useCsvExport';

/**
 * The bar above the grid: search, six filter popovers, the active-filter chips,
 * the column configuration, and the export.
 *
 * THE SEARCH IS DEBOUNCED, THE FILTERS ARE NOT. A keystroke is a draft — firing
 * a request per character would burn a round trip on every prefix of a word and
 * make the grid flicker through four intermediate result sets. A checkbox click
 * is a decision, and delaying it would feel broken. 300ms is the usual
 * compromise: below it a fast typist still triggers several requests, above it
 * the pause becomes noticeable.
 *
 * CHIPS ARE THE UNDO. A filter popover shows what is selected only while it is
 * open, so an active filter is otherwise invisible on a screen full of rows —
 * which is exactly how a user concludes the table is missing data. Every active
 * value gets a chip with its own dismiss, plus one "clear all".
 */

/** Milliseconds between the last keystroke and the request. */
const SEARCH_DEBOUNCE_MS = 300;

export interface TableToolbarProps {
  orgId: string | null;
  filters: TableFilterState;
  onFiltersChange: (next: TableFilterState) => void;
  statuses: readonly Status[];
  labels: readonly Label[];
  sprints: readonly Sprint[];
  columnPrefs: TableColumnPrefs;
  onColumnPrefsChange: (next: TableColumnPrefs) => void;
  onColumnPrefsReset: () => void;
  onExport: () => void;
  isExporting: boolean;
}

export function TableToolbar({
  orgId,
  filters,
  onFiltersChange,
  statuses,
  labels,
  sprints,
  columnPrefs,
  onColumnPrefsChange,
  onColumnPrefsReset,
  onExport,
  isExporting,
}: TableToolbarProps) {
  const { t } = useTranslation(['table', 'common']);
  const { typeLabel, priorityLabel } = useTaskFieldLabels();
  const { data: orgUsers } = useOrgUsers(orgId);

  const options = useMemo<Record<TableFilterKey, FilterOption[]>>(
    () => ({
      statusId: statuses.map((status) => ({
        value: status.id,
        label: status.name,
        icon: <LabelDot color={status.color} />,
      })),
      type: TASK_TYPES.map((type) => ({
        value: type,
        label: typeLabel(type),
        icon: <TaskTypeIcon type={type} />,
      })),
      priority: TASK_PRIORITIES.map((priority) => ({
        value: priority,
        label: priorityLabel(priority),
        icon: <PriorityIcon priority={priority} />,
      })),
      assigneeId: [
        { value: NONE_SENTINEL, label: t('table:filters.unassigned') },
        ...(orgUsers ?? []).map((entry) => ({
          value: entry.user.id,
          label: entry.user.name,
          icon: <UserAvatar user={entry.user} size="xs" label="" />,
        })),
      ],
      labelId: labels.map((label) => ({
        value: label.id,
        label: label.name,
        icon: <LabelDot color={label.color} />,
      })),
      sprintId: [
        { value: NONE_SENTINEL, label: t('table:filters.backlog') },
        ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name })),
      ],
    }),
    [statuses, labels, sprints, orgUsers, typeLabel, priorityLabel, t],
  );

  /**
   * The popover titles, spelled out rather than built from a template.
   *
   * `t()` is typed against the English catalog, so a computed
   * `` t(`table:filters.${key}`) `` widens to `` `table:filters.${string}` ``
   * and stops matching the key union — the compile-time key checking this
   * project relies on would be silently lost for these six strings.
   */
  const filterNames = useMemo<Record<TableFilterKey, string>>(
    () => ({
      statusId: t('table:filters.status'),
      type: t('table:filters.type'),
      priority: t('table:filters.priority'),
      assigneeId: t('table:filters.assignee'),
      labelId: t('table:filters.label'),
      sprintId: t('table:filters.sprint'),
    }),
    [t],
  );

  const activeCount = activeFilterCount(filters);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <SearchField
          value={filters.q}
          onCommit={(q) => {
            onFiltersChange({ ...filters, q });
          }}
        />

        {FILTER_KEYS.map((key) => (
          <FilterPopover
            key={key}
            name={filterNames[key]}
            options={options[key]}
            selected={filters[key]}
            onToggle={(value) => {
              onFiltersChange(toggleFilterValue(filters, key, value));
            }}
            onClear={() => {
              onFiltersChange(clearFilter(filters, key));
            }}
          />
        ))}

        <div className="ms-auto flex items-center gap-1.5">
          <ColumnConfigPopover
            prefs={columnPrefs}
            onChange={onColumnPrefsChange}
            onReset={onColumnPrefsReset}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={onExport} disabled={isExporting}>
                {isExporting ? (
                  <LoaderCircle aria-hidden className="animate-spin" />
                ) : (
                  <Download aria-hidden />
                )}
                <span className="hidden sm:inline">
                  {isExporting ? t('table:toolbar.exporting') : t('table:toolbar.export')}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {t('table:toolbar.exportHint', { cap: CSV_EXPORT_CAP })}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {activeCount > 0 ? (
        <ul aria-label={t('table:filters.active')} className="flex flex-wrap items-center gap-1">
          {filters.q.trim() ? (
            <li>
              <Chip
                label={t('table:filters.searchChip', { value: filters.q.trim() })}
                removeLabel={t('table:filters.clearSearch')}
                onRemove={() => {
                  onFiltersChange({ ...filters, q: '' });
                }}
              />
            </li>
          ) : null}

          {FILTER_KEYS.flatMap((key) =>
            filters[key].map((value) => {
              const option = options[key].find((entry) => entry.value === value);
              return (
                <li key={`${key}:${value}`}>
                  <Chip
                    icon={option?.icon}
                    label={option?.label ?? value}
                    removeLabel={t('table:filters.clearOne', {
                      name: option?.label ?? value,
                    })}
                    onRemove={() => {
                      onFiltersChange(toggleFilterValue(filters, key, value));
                    }}
                  />
                </li>
              );
            }),
          )}

          <li>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                onFiltersChange(emptyTableFilters());
              }}
            >
              {t('table:toolbar.clearFilters')}
            </Button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

interface FilterOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

/**
 * The debounced search box.
 *
 * The draft is LOCAL and only re-seeded when the committed value changes from
 * the outside (a chip dismissal, a restored session). Mirroring the prop on
 * every render would fight the user's typing whenever a request resolved
 * mid-word.
 */
function SearchField({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const { t } = useTranslation(['table']);
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (draft === committed.current) return;

    const timer = setTimeout(() => {
      committed.current = draft;
      onCommit(draft);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [draft, onCommit]);

  return (
    <div className="relative w-full sm:w-64">
      <Search
        aria-hidden
        className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={draft}
        aria-label={t('table:toolbar.searchLabel')}
        placeholder={t('table:toolbar.searchPlaceholder')}
        className="h-7 ps-7 text-sm"
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            // Enter is "I am done typing" — skip the remaining debounce.
            event.preventDefault();
            committed.current = draft;
            onCommit(draft);
          }
        }}
      />
    </div>
  );
}

/** One multi-select filter, as a popover of checkboxes. */
function FilterPopover({
  name,
  options,
  selected,
  onToggle,
  onClear,
}: {
  name: string;
  options: FilterOption[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation(['table', 'common']);
  const chosen = new Set(selected);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn(chosen.size > 0 && 'border-primary/50')}>
          <ListFilter aria-hidden />
          {name}
          {chosen.size > 0 ? (
            <Badge variant="soft-primary" className="tabular-nums" dir="ltr">
              {chosen.size}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-60 p-2">
        {options.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">{t('table:filters.empty')}</p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {options.map((option) => (
              <li key={option.value}>
                <label className="flex cursor-default items-center gap-2 rounded-[var(--radius)] px-1.5 py-1 text-xs hover:bg-accent">
                  <Checkbox
                    checked={chosen.has(option.value)}
                    onCheckedChange={() => {
                      onToggle(option.value);
                    }}
                  />
                  {option.icon}
                  <span className="truncate">{option.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {chosen.size > 0 ? (
          <Button variant="ghost" size="xs" className="mt-1 w-full justify-start" onClick={onClear}>
            {t('common:actions.clear')}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** One active-filter chip with its own dismiss. */
function Chip({
  icon,
  label,
  removeLabel,
  onRemove,
}: {
  icon?: ReactNode;
  label: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-border bg-surface-raised py-0.5 pe-1 ps-1.5 text-xs">
      {icon}
      <span className="max-w-[12rem] truncate">{label}</span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="inline-flex size-4 items-center justify-center rounded-[var(--btn-radius)] text-muted-foreground transition-colors duration-[var(--speed)] hover:text-foreground"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

export default TableToolbar;
