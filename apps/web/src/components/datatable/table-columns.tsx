import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  columnOrderingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/react-table';
import type { TaskSummary } from '@flowboard/shared';

import { COLUMN_SIZES, SORT_FIELD_BY_COLUMN } from '@/components/datatable/table-model';
import {
  AssigneeCell,
  DueDateCell,
  KeyCell,
  LabelsCell,
  PointsCell,
  PriorityCell,
  SprintCell,
  StartDateCell,
  StatusCell,
  TitleCell,
  TypeCell,
  UpdatedCell,
} from '@/components/datatable/cells';

/**
 * The TanStack Table v9 column model for the Table view.
 *
 * ── v9, not v8 ──────────────────────────────────────────────────────────────
 * Three things differ from every v8 example on the internet, and all three are
 * load-bearing here:
 *
 * 1. **Features are registered, not assumed.** In v8 every feature shipped with
 *    the table; in v9 `state.columnOrder` simply does not exist until
 *    `columnOrderingFeature` is in this object. The four below are exactly what
 *    this view uses — visibility and ordering (the column popover), sizing (the
 *    grid template), and sorting (the header toggles). Nothing else is
 *    registered, which is what keeps the rest of the library out of the bundle.
 * 2. **No row-model factories.** `getCoreRowModel()` is gone (the core model is
 *    automatic), and the sorted/paginated models are deliberately absent: both
 *    are the SERVER's job here, so registering `sortedRowModel` would sort the
 *    current page among itself on top of the server's global order.
 * 3. **`createColumnHelper<typeof features, TData>()`** takes the feature set as
 *    its first type argument, and `helper.columns([...])` wraps the array so
 *    each column keeps its own value type instead of widening to `unknown`.
 *
 * ── Accessors ──────────────────────────────────────────────────────────────
 * Every column is an ACCESSOR column, even the ones whose cell ignores the
 * value: v9's `column.getCanSort()` requires an `accessorFn`, so a display
 * column can never be sortable. The accessors also give the header row
 * something meaningful to describe and keep `getValue()` usable from a test.
 *
 * ── Sorting ────────────────────────────────────────────────────────────────
 * `enableSorting` mirrors {@link SORT_FIELD_BY_COLUMN}: a column is sortable
 * exactly when the shared contract gives the API a field for it. `sortDescFirst:
 * false` on every column is not cosmetic — without it v9 samples the loaded
 * rows to guess a first direction (via the filtered row model, which this table
 * does not register), and the toggle cycle would differ per column and per page.
 */

/**
 * The registered feature set. Module scope, because `useTable` treats
 * `features` as a model input and a fresh object per render invalidates every
 * derived model.
 */
export const tableViewFeatures = tableFeatures({
  columnVisibilityFeature,
  columnOrderingFeature,
  columnSizingFeature,
  rowSortingFeature,
});

export type TableViewFeatures = typeof tableViewFeatures;

const helper = createColumnHelper<TableViewFeatures, TaskSummary>();

/** Shared per-column defaults: sizing floor and the deterministic sort cycle. */
const BASE = { minSize: 64, sortDescFirst: false } as const;

/**
 * The column definitions, memoized on `t`.
 *
 * Built in a hook rather than at module scope because the HEADERS are
 * translated, and `t` changes identity exactly once per language switch — which
 * is precisely when the column model should be rebuilt and no more often.
 */
export function useTaskColumns() {
  const { t } = useTranslation(['table']);

  return useMemo(
    () =>
      helper.columns([
        helper.accessor((row) => row.number, {
          id: 'key',
          header: t('table:columns.key'),
          size: COLUMN_SIZES.key,
          // The row's identity. Hiding it would leave a table of facts about
          // rows nobody can name or open.
          enableHiding: false,
          enableSorting: SORT_FIELD_BY_COLUMN.key !== null,
          ...BASE,
          cell: (context) => <KeyCell task={context.row.original} />,
        }),
        helper.accessor((row) => row.title, {
          id: 'title',
          header: t('table:columns.title'),
          size: COLUMN_SIZES.title,
          enableSorting: SORT_FIELD_BY_COLUMN.title !== null,
          ...BASE,
          cell: (context) => <TitleCell task={context.row.original} />,
        }),
        helper.accessor((row) => row.type, {
          id: 'type',
          header: t('table:columns.type'),
          size: COLUMN_SIZES.type,
          enableSorting: SORT_FIELD_BY_COLUMN.type !== null,
          ...BASE,
          cell: (context) => <TypeCell task={context.row.original} />,
        }),
        helper.accessor((row) => row.statusId, {
          id: 'status',
          header: t('table:columns.status'),
          size: COLUMN_SIZES.status,
          enableSorting: SORT_FIELD_BY_COLUMN.status !== null,
          ...BASE,
          cell: (context) => <StatusCell task={context.row.original} />,
        }),
        helper.accessor((row) => row.priority, {
          id: 'priority',
          header: t('table:columns.priority'),
          size: COLUMN_SIZES.priority,
          enableSorting: SORT_FIELD_BY_COLUMN.priority !== null,
          ...BASE,
          cell: (context) => <PriorityCell task={context.row.original} />,
        }),
        helper.accessor((row) => row.assignee?.name ?? '', {
          id: 'assignee',
          header: t('table:columns.assignee'),
          size: COLUMN_SIZES.assignee,
          enableSorting: SORT_FIELD_BY_COLUMN.assignee !== null,
          ...BASE,
          cell: (context) => <AssigneeCell task={context.row.original} />,
        }),
        helper.accessor((row) => row.storyPoints, {
          id: 'points',
          header: t('table:columns.points'),
          size: COLUMN_SIZES.points,
          enableSorting: SORT_FIELD_BY_COLUMN.points !== null,
          ...BASE,
          cell: (context) => <PointsCell task={context.row.original} />,
        }),
        helper.accessor((row) => row.sprintId, {
          id: 'sprint',
          header: t('table:columns.sprint'),
          size: COLUMN_SIZES.sprint,
          enableSorting: SORT_FIELD_BY_COLUMN.sprint !== null,
          ...BASE,
          cell: (context) => <SprintCell task={context.row.original} />,
        }),
        helper.accessor((row) => row.labelIds.length, {
          id: 'labels',
          header: t('table:columns.labels'),
          size: COLUMN_SIZES.labels,
          enableSorting: SORT_FIELD_BY_COLUMN.labels !== null,
          ...BASE,
          cell: (context) => <LabelsCell task={context.row.original} />,
        }),
        helper.accessor((row) => row.startDate, {
          id: 'startDate',
          header: t('table:columns.startDate'),
          size: COLUMN_SIZES.startDate,
          enableSorting: SORT_FIELD_BY_COLUMN.startDate !== null,
          ...BASE,
          cell: (context) => <StartDateCell task={context.row.original} />,
        }),
        helper.accessor((row) => row.dueDate, {
          id: 'dueDate',
          header: t('table:columns.dueDate'),
          size: COLUMN_SIZES.dueDate,
          enableSorting: SORT_FIELD_BY_COLUMN.dueDate !== null,
          ...BASE,
          cell: (context) => <DueDateCell task={context.row.original} />,
        }),
        helper.accessor((row) => row.updatedAt, {
          id: 'updatedAt',
          header: t('table:columns.updatedAt'),
          size: COLUMN_SIZES.updatedAt,
          enableSorting: SORT_FIELD_BY_COLUMN.updatedAt !== null,
          ...BASE,
          cell: (context) => <UpdatedCell task={context.row.original} />,
        }),
      ]),
    [t],
  );
}

/** Localized column headers by id — reused by the config popover and the export. */
export function useColumnLabels(): Record<string, string> {
  const { t } = useTranslation(['table']);

  return useMemo(
    () => ({
      key: t('table:columns.key'),
      title: t('table:columns.title'),
      type: t('table:columns.type'),
      status: t('table:columns.status'),
      priority: t('table:columns.priority'),
      assignee: t('table:columns.assignee'),
      points: t('table:columns.points'),
      sprint: t('table:columns.sprint'),
      labels: t('table:columns.labels'),
      startDate: t('table:columns.startDate'),
      dueDate: t('table:columns.dueDate'),
      updatedAt: t('table:columns.updatedAt'),
    }),
    [t],
  );
}
