import { useMemo, useState, type ReactNode } from 'react';
import {
  columnOrderingFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnVisibilityState,
  type Row,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react';
import type { PaginationMeta } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AriaSort } from '@/components/datatable/table-sort';
import { useTableChromeCopy } from '@/components/dashboard/chrome-copy';
import { ColumnsMenu, type ColumnToggle } from '@/components/dashboard/table/ColumnsMenu';
import { DraggableHeader } from '@/components/dashboard/table/DraggableHeader';
import { FacetFilter, type FacetDef } from '@/components/dashboard/table/FacetFilter';

export type { FacetDef, FacetOption } from '@/components/dashboard/table/FacetFilter';

/**
 * The generic dashboard grid: sortable headers, column visibility and drag
 * reordering, facet filters, a density toggle, a pagination footer, skeleton
 * rows, an empty state, and optional page-scoped selection.
 *
 * ═══ TWO MODES, CHOSEN BY `meta` ═════════════════════════════════════════
 *
 *  - **server** (`meta` present) — `manualSorting`; the header buttons report a
 *    {@link SortState} and the caller re-queries. Every row handed in is
 *    rendered as-is, in the order the API returned it.
 *  - **client** (no `meta`) — TanStack's sorted row model orders the rows in
 *    the browser using each column's `accessor`, and every row is rendered.
 *    There is no client pagination: an unpaginated table that pages itself
 *    hides rows the caller believes it handed over.
 *
 * The `meta` PRESENCE is the switch rather than a `mode` prop because the two
 * facts are the same fact — a grid has server pagination exactly when the
 * server told it how many pages there are — and two props that must agree are
 * two props that eventually disagree.
 *
 * ═══ TANSTACK v9, NOT v8 ═════════════════════════════════════════════════
 *
 * Four things differ from every v8 DataTable example, and all four are
 * load-bearing here (the same notes as `components/datatable/table-columns.tsx`,
 * which is this repo's other v9 table):
 *
 * 1. **Features are registered, not assumed.** `state.columnOrder` does not
 *    exist until `columnOrderingFeature` is in the feature set. The three below
 *    are exactly what this grid uses; nothing else is registered, which is what
 *    keeps the rest of the library out of the bundle.
 * 2. **Row models are factories in the FEATURE SET, not options.**
 *    `getCoreRowModel()` is gone (core is automatic) and client sorting needs
 *    `sortedRowModel: createSortedRowModel()` registered alongside
 *    `rowSortingFeature` — `manualSorting` then decides whether it is applied.
 * 3. **`columnDef.sortFn`, not `sortingFn`,** and the undefined-priority knob
 *    is `sortUndefined` (set to `false` here so {@link compareValues} sees
 *    every value itself — see its note).
 * 4. **`columnMeta` is a type-only slot on the feature set.** v8 required
 *    global declaration merging on `ColumnMeta` to type `columnDef.meta`; v9
 *    takes `columnMeta: {} as DashboardColumnMeta` in `tableFeatures()`, so
 *    this grid's meta shape is scoped to this grid instead of leaking onto
 *    every other table in the app.
 *
 * ═══ LAYOUT STATE IS IN-MEMORY, BY DESIGN ════════════════════════════════
 *
 * Column visibility, column order and density live in `useState` and reset on
 * refresh. They are a momentary investigative posture, not a query: serializing
 * them would put a table layout in every pasted link (see `useGridUrlState`'s
 * header) and resurrect a persistence story the grid deliberately does not
 * have. Filters, sort and paging are the caller's, and belong in the URL.
 *
 * ═══ COPY ════════════════════════════════════════════════════════════════
 *
 * Every string this grid renders comes from `chrome-copy.ts` — the one module
 * in the kit that reads the catalog — except `aria-label`, `emptyMessage`, the
 * facet labels and the selection labels, which are the caller's and are already
 * translated where they were built.
 */

/* ------------------------------------------------------------------ */
/* Feature set                                                         */
/* ------------------------------------------------------------------ */

/** Extra per-column presentation, carried through `columnDef.meta`. */
export interface DashboardColumnMeta {
  align?: 'start' | 'end';
  className?: string;
  /** Wire field name the header's sort button reports (server grids). */
  sortField?: string;
  /** Plain-text column name — headers may render arbitrary nodes. */
  label?: string;
}

/**
 * The registered feature set. MODULE SCOPE, because `useTable` treats
 * `features` as a model input and a fresh object per render would invalidate
 * every derived model on every render.
 */
export const dashboardTableFeatures = tableFeatures({
  columnVisibilityFeature,
  columnOrderingFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnMeta: {} as DashboardColumnMeta,
});

export type DashboardTableFeatures = typeof dashboardTableFeatures;

/** A column definition this grid accepts. Produced by {@link col}. */
export type DashboardColumnDef<T extends RowData> = ColumnDef<DashboardTableFeatures, T, unknown>;

/* ------------------------------------------------------------------ */
/* Column definitions                                                  */
/* ------------------------------------------------------------------ */

export type SortDirection = 'asc' | 'desc';

/** Server-shaped sort: a whitelisted field plus an optional direction. */
export interface SortState {
  sort?: string;
  order?: SortDirection;
}

/** The ergonomic column shape {@link col} accepts. */
export interface ColumnSpec<T extends RowData> {
  id: string;
  /** Already-translated header text. Also the Columns-menu label. */
  header: string;
  cell: (row: T) => ReactNode;
  /**
   * Wire field this column sorts by. Defaults to `id` when an `accessor` is
   * given, so a client grid is sortable without repeating itself.
   */
  sortField?: string;
  /**
   * Comparable value for CLIENT-side sorting. Its presence is what makes a
   * column sortable without a server round-trip — v9's `getCanSort()` requires
   * an `accessorFn`, so a display column can never be sortable.
   */
  accessor?: (row: T) => string | number | boolean | null | undefined;
  /** Alignment is LOGICAL: `end` is right in English and left in Arabic. */
  align?: 'start' | 'end';
  className?: string;
  /** `false` pins the column visible (never offered in the Columns menu). */
  enableHiding?: boolean;
}

/**
 * A predictable comparator: numbers numerically, everything else as text,
 * EMPTY LAST.
 *
 * "Empty" is `null`, `undefined` and `''` alike, because a blank cell reads the
 * same whichever of the three produced it. The comparator itself is PURE and
 * direction-blind — TanStack re-inverts its result for a descending sort, so
 * blanks sink to the bottom ascending and rise to the top descending, and a
 * direction-aware comparator here would fight the library rather than the
 * problem. `sortUndefined: false` on every column is what routes `undefined`
 * through here instead of letting v9 pre-sort it.
 */
export function compareValues(a: unknown, b: unknown): number {
  const aEmpty = a == null || a === '';
  const bEmpty = b == null || b === '';
  if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * Builds a v9 `ColumnDef` from the flat spec a page writes.
 *
 * `align` / `className` / `sortField` / `label` land in `meta` (the grid reads
 * them back when it renders the cell), `accessor` becomes the `accessorFn` that
 * client sorting compares, and `enableHiding` defaults to true.
 *
 * `sortDescFirst: false` is not cosmetic: without it v9 samples the loaded rows
 * to guess a first direction, and the toggle cycle would differ per column and
 * per page. The cycle this grid promises is asc → desc → cleared, always.
 */
export function col<T extends RowData>(spec: ColumnSpec<T>): DashboardColumnDef<T> {
  const meta: DashboardColumnMeta = {
    align: spec.align,
    className: spec.className,
    sortField: spec.sortField ?? (spec.accessor ? spec.id : undefined),
    label: spec.header,
  };

  const base = {
    id: spec.id,
    header: spec.header,
    cell: (context: { row: Row<DashboardTableFeatures, T> }) => spec.cell(context.row.original),
    enableHiding: spec.enableHiding ?? true,
    enableSorting: spec.accessor != null,
    sortDescFirst: false,
    sortUndefined: false as const,
    meta,
  };

  const { accessor } = spec;
  if (!accessor) return base as DashboardColumnDef<T>;

  return {
    ...base,
    accessorFn: (row: T) => accessor(row),
    sortFn: (
      a: Row<DashboardTableFeatures, T>,
      b: Row<DashboardTableFeatures, T>,
      columnId: string,
    ) => compareValues(a.getValue<unknown>(columnId), b.getValue<unknown>(columnId)),
  } as DashboardColumnDef<T>;
}

function metaOf<T extends RowData>(def: DashboardColumnDef<T>): DashboardColumnMeta {
  return def.meta ?? {};
}

/** The wire field a column sorts by (its id when it never declared one). */
function sortFieldOf<T extends RowData>(def: DashboardColumnDef<T>): string | undefined {
  return metaOf(def).sortField ?? (typeof def.id === 'string' ? def.id : undefined);
}

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

/** The page sizes the footer offers. Mirrors the API's own whitelist. */
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export type Density = 'comfortable' | 'compact';

/** Rows drawn while `loading` — enough to read as a table, not as a page. */
const SKELETON_ROWS = 5;

/**
 * Page-scoped, caller-owned row selection.
 *
 * Deliberately NOT TanStack's `rowSelection` state: the owning page has to
 * clear it whenever the page, query or filter changes, and it usually needs the
 * selected ids for a bulk action anyway. The grid only reports intent.
 *
 * The two labels are REQUIRED because they are the only chrome in this file
 * that cannot be generic: "Select all" is worse copy than "Select every user on
 * this page", and only the caller knows what a row is.
 */
export interface TableSelection<T extends RowData> {
  selectedKeys: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Accessible name for the header checkbox, already translated. */
  allLabel: string;
  /** Accessible name for one row's checkbox, already translated. */
  rowLabel: (row: T) => string;
}

export interface DataTableProps<T extends RowData> {
  columns: DashboardColumnDef<T>[];
  rows: T[];
  /** Stable row identity. Also the key a {@link TableSelection} carries. */
  rowKey: (row: T) => string;
  loading?: boolean;
  /**
   * Pagination meta from the API. Renders the footer AND switches the grid into
   * server mode (see the header). Absent ⇒ client mode.
   */
  meta?: PaginationMeta | null;
  onPageChange?: (page: number) => void;
  /** Enables the footer's page-size selector. */
  onPageSizeChange?: (pageSize: number) => void;
  sort?: SortState;
  /** Present ⇒ the caller owns the sort. Absent ⇒ the grid keeps it in memory. */
  onSortChange?: (sort: SortState) => void;
  /** Overrides the generic "no matches" sentence. */
  emptyMessage?: string;
  /** Toolbar slot above the grid (search input, export button). */
  toolbar?: ReactNode;
  /** Caller-owned facet filters, rendered in their own row. */
  facets?: FacetDef[];
  /** Row actions, rendered as a trailing column. */
  actions?: (row: T) => ReactNode;
  selection?: TableSelection<T>;
  /** Extra classes per row (e.g. dimming a deactivated account). */
  rowClassName?: (row: T) => string | undefined;
  /** `data-testid` stamped on the row's `<tr>`. */
  rowTestId?: (row: T) => string;
  /** Show the Columns menu (default true; renders nothing with no hideable column). */
  enableColumnVisibility?: boolean;
  /** Allow drag-reordering the data columns (default true). In-memory only. */
  enableColumnReorder?: boolean;
  /** Show the compact/comfortable row-height toggle (default true). */
  enableDensity?: boolean;
  /** Names the grid for assistive tech. Required, and already translated. */
  'aria-label': string;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function DataTable<T extends RowData>({
  columns,
  rows,
  rowKey,
  loading = false,
  meta,
  onPageChange,
  onPageSizeChange,
  sort,
  onSortChange,
  emptyMessage,
  toolbar,
  facets,
  actions,
  selection,
  rowClassName,
  rowTestId,
  enableColumnVisibility = true,
  enableColumnReorder = true,
  enableDensity = true,
  'aria-label': ariaLabel,
}: DataTableProps<T>) {
  const copy = useTableChromeCopy();

  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [density, setDensity] = useState<Density>('comfortable');
  const [innerSort, setInnerSort] = useState<SortState>({});

  // `onSortChange` present ⇒ the caller owns the sort; otherwise the grid keeps
  // it in memory (client tables that just want clickable headers).
  const controlledSort = onSortChange != null;
  const activeSort = controlledSort ? (sort ?? {}) : innerSort;
  const clientSort = meta == null;

  const emitSort = (next: SortState) => {
    if (onSortChange) onSortChange(next);
    else setInnerSort(next);
  };

  const sorting = useMemo<SortingState>(() => {
    if (!activeSort.sort) return [];
    const target = columns.find((def) => sortFieldOf(def) === activeSort.sort);
    const id = typeof target?.id === 'string' ? target.id : undefined;
    return id ? [{ id, desc: activeSort.order === 'desc' }] : [];
  }, [activeSort.sort, activeSort.order, columns]);

  const table = useTable<DashboardTableFeatures, T>({
    features: dashboardTableFeatures,
    columns,
    data: rows,
    getRowId: (row) => rowKey(row),
    state: { sorting, columnVisibility, columnOrder },
    // The header buttons below own the sort cycle end to end, so the table is
    // never asked to update it — but a controlled slice still wants its updater
    // declared, and a no-op says "nothing else may move this" out loud.
    onSortingChange: () => undefined,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    // Server mode: the API already sorted. Client mode: `sortedRowModel` (in
    // the feature set) orders the rows here.
    manualSorting: !clientSort,
    enableMultiSort: false,
    enableSortingRemoval: true,
    sortDescFirst: false,
  });

  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const columnIds = headers.map((header) => header.column.id);
  const colCount = headers.length + (actions ? 1 : 0) + (selection ? 1 : 0);

  /* -------- selection (caller-owned, page-scoped) -------- */

  const pageKeys = rows.map(rowKey);
  const selectedOnPage = selection
    ? pageKeys.filter((key) => selection.selectedKeys.has(key)).length
    : 0;

  // The header box mirrors THIS PAGE only: all → checked, some → indeterminate.
  // A tri-state box that meant "all 900 results" would be a box nobody can
  // truthfully tick, because the grid has only ever seen twenty-five of them.
  const headerChecked: boolean | 'indeterminate' =
    pageKeys.length > 0 && selectedOnPage === pageKeys.length
      ? true
      : selectedOnPage > 0
        ? 'indeterminate'
        : false;

  const toggleAllOnPage = (checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selectedKeys);
    for (const key of pageKeys) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    selection.onChange(next);
  };

  const toggleOne = (key: string, checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selectedKeys);
    if (checked) next.add(key);
    else next.delete(key);
    selection.onChange(next);
  };

  /* -------- sorting (3-state header toggle: asc → desc → cleared) -------- */

  const toggleSort = (field: string) => {
    if (activeSort.sort !== field) emitSort({ sort: field, order: 'asc' });
    else if (activeSort.order === 'asc') emitSort({ sort: field, order: 'desc' });
    else if (activeSort.order === 'desc') emitSort({});
    // Sorted on this field with NO explicit direction — the server's own
    // default ordering. The first click has to produce a direction, not clear a
    // sort the user never set.
    else emitSort({ sort: field, order: 'asc' });
  };

  /** The direction a click would move a header to — its `sr-only` hint. */
  const nextSortHint = (field: string): string => {
    if (activeSort.sort !== field) return copy.sortTo.asc;
    if (activeSort.order === 'asc') return copy.sortTo.desc;
    if (activeSort.order === 'desc') return copy.sortTo.none;
    return copy.sortTo.asc;
  };

  /* -------- column reorder -------- */

  const sensors = useSensors(
    // 8px of travel before a drag starts, so a plain click still sorts.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** All leaf column ids, HIDDEN ONES INCLUDED — the reorder domain. */
  const allColumnIds = () => table.getAllLeafColumns().map((column) => column.id);

  const labelOf = (id: string): string => {
    const found = columns.find((def) => def.id === id);
    return (found ? metaOf(found).label : undefined) ?? id;
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    // Reorder across ALL leaf columns rather than the visible ones, so unhiding
    // a column later puts it back where the operator left it instead of at the
    // end of the row.
    const ids = allColumnIds();
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setColumnOrder(arrayMove(ids, from, to));
  };

  /**
   * Narrated in the user's language, naming the COLUMN.
   *
   * dnd-kit's built-in commentary announces the droppable INDEX and is
   * hard-coded English — two problems at once on an Arabic page. Same contract
   * as the task table's column popover (`table:config.dnd.*`).
   */
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const ids = allColumnIds();
      return copy.reorderAnnouncements.picked({
        name: labelOf(String(active.id)),
        position: ids.indexOf(String(active.id)) + 1,
        total: ids.length,
      });
    },
    onDragOver: ({ active, over }) => {
      if (!over) return undefined;
      const ids = allColumnIds();
      return copy.reorderAnnouncements.over({
        name: labelOf(String(active.id)),
        position: ids.indexOf(String(over.id)) + 1,
        total: ids.length,
      });
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return undefined;
      const ids = allColumnIds();
      return copy.reorderAnnouncements.dropped({
        name: labelOf(String(active.id)),
        position: ids.indexOf(String(over.id)) + 1,
        total: ids.length,
      });
    },
    onDragCancel: ({ active }) => {
      const ids = allColumnIds();
      return copy.reorderAnnouncements.cancelled({
        name: labelOf(String(active.id)),
        position: ids.indexOf(String(active.id)) + 1,
      });
    },
  };

  /* -------- chrome -------- */

  const toggles: ColumnToggle[] = enableColumnVisibility
    ? table
        .getAllLeafColumns()
        .filter((column) => column.getCanHide())
        .map((column) => ({
          id: column.id,
          label: labelOf(column.id),
          visible: column.getIsVisible(),
          onToggle: (visible: boolean) => {
            column.toggleVisibility(visible);
          },
        }))
    : [];

  const compact = density === 'compact';
  const padY = compact ? 'py-1' : 'py-[var(--row-pad)]';
  const showChrome = toggles.length > 0 || enableDensity;

  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;
  const rangeFrom = meta && meta.total > 0 ? (meta.page - 1) * meta.pageSize + 1 : 0;
  const rangeTo = meta ? Math.min(meta.page * meta.pageSize, meta.total) : 0;

  const headerCells = headers.map((header) => {
    const def = header.column.columnDef as DashboardColumnDef<T>;
    const headerMeta = metaOf(def);
    const field = sortFieldOf(def);
    // A header is sortable when the caller owns the sort (server grids) or the
    // column can be compared locally (client grids) — and only ever when the
    // column declared a wire field to sort BY.
    const sortable =
      field != null &&
      Boolean(headerMeta.sortField) &&
      (controlledSort || header.column.getCanSort());
    const active = sortable && activeSort.sort === field;
    const label = headerMeta.label ?? header.column.id;

    const SortIcon =
      active && activeSort.order === 'desc'
        ? ArrowDown
        : active && activeSort.order === 'asc'
          ? ArrowUp
          : ArrowUpDown;

    const content =
      sortable && field != null ? (
        <button
          type="button"
          onClick={() => {
            toggleSort(field);
          }}
          className="-mx-1 inline-flex min-w-0 items-center gap-1 rounded-[var(--btn-radius)] px-1 transition-colors duration-[var(--speed)] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <table.FlexRender header={header} />
          <SortIcon className={cn('size-3 shrink-0', !active && 'opacity-50')} aria-hidden />
          {/* The ACTION, not the state: `aria-sort` on the `<th>` already
              announces the state, and a button whose name never changes tells
              you nothing about what pressing it does. Same shape as the task
              grid's header (`components/datatable/TaskDataTable`), deliberately.

              Note for anyone reading a jsdom test failure: `sr-only` sets
              `position:absolute`, which blockifies the span, so a real browser
              inserts a word boundary and the name reads "Members Sort
              ascending". jsdom loads no CSS, computes the span as inline, and
              concatenates to "MembersSort ascending" — a limitation of the test
              environment, not of the markup. */}
          <span className="sr-only">{nextSortHint(field)}</span>
        </button>
      ) : (
        <table.FlexRender header={header} />
      );

    // `aria-sort` is set on every SORTABLE header, including the unsorted ones:
    // an absent attribute is announced as "not a sort control", which is a
    // different claim from "sortable, currently unsorted".
    const ariaSort: AriaSort | undefined = !sortable
      ? undefined
      : active && activeSort.order
        ? activeSort.order === 'desc'
          ? 'descending'
          : 'ascending'
        : 'none';

    const className = cn('px-3', padY, headerMeta.align === 'end' ? 'text-end' : 'text-start');

    return enableColumnReorder ? (
      <DraggableHeader
        key={header.id}
        id={header.column.id}
        label={label}
        ariaSort={ariaSort}
        copy={copy}
        className={className}
      >
        {content}
      </DraggableHeader>
    ) : (
      <TableHead key={header.id} scope="col" aria-sort={ariaSort} className={className}>
        {content}
      </TableHead>
    );
  });

  const headerRow = (
    <TableRow className="hover:bg-transparent">
      {selection ? (
        <TableHead scope="col" className={cn('w-0 px-3', padY)}>
          <Checkbox
            checked={headerChecked}
            onCheckedChange={(value) => {
              toggleAllOnPage(value === true);
            }}
            aria-label={selection.allLabel}
            data-testid="table-select-all"
          />
        </TableHead>
      ) : null}
      {enableColumnReorder ? (
        <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
          {headerCells}
        </SortableContext>
      ) : (
        headerCells
      )}
      {actions ? (
        <TableHead scope="col" className={cn('px-3 text-end', padY)}>
          <span className="sr-only">{copy.actionsHeader}</span>
        </TableHead>
      ) : null}
    </TableRow>
  );

  const grid = (
    <Table
      className="min-w-max"
      containerClassName="rounded-[var(--card-radius)] border border-border bg-surface"
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
    >
      <TableHeader>{headerRow}</TableHeader>
      <TableBody>
        {loading ? (
          Array.from({ length: SKELETON_ROWS }, (_, rowIndex) => (
            <TableRow key={`skeleton-${String(rowIndex)}`} className="hover:bg-transparent">
              {Array.from({ length: colCount }, (_, cellIndex) => (
                <TableCell key={`cell-${String(cellIndex)}`} className={cn('px-3', padY)}>
                  <Skeleton className="h-4 w-full max-w-32" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={colCount} className="px-3 py-10 text-center text-muted-foreground">
              {emptyMessage ?? copy.empty}
            </TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map((tableRow) => {
            const row = tableRow.original;
            return (
              <TableRow
                key={tableRow.id}
                data-testid={rowTestId?.(row)}
                className={rowClassName?.(row)}
              >
                {selection ? (
                  <TableCell className={cn('w-0 px-3', padY)}>
                    <Checkbox
                      checked={selection.selectedKeys.has(tableRow.id)}
                      onCheckedChange={(value) => {
                        toggleOne(tableRow.id, value === true);
                      }}
                      aria-label={selection.rowLabel(row)}
                    />
                  </TableCell>
                ) : null}
                {tableRow.getVisibleCells().map((cell) => {
                  const cellMeta = metaOf(cell.column.columnDef as DashboardColumnDef<T>);
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'px-3',
                        padY,
                        cellMeta.align === 'end' && 'text-end tabular-nums',
                        cellMeta.className,
                      )}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  );
                })}
                {actions ? (
                  <TableCell className={cn('px-3 text-end whitespace-nowrap', padY)}>
                    {actions(row)}
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );

  return (
    <div data-slot="data-table" data-print-region>
      {toolbar || showChrome ? (
        <div className="mb-3 flex flex-wrap items-center gap-2" data-print-hide>
          {toolbar}
          <div className="ms-auto flex items-center gap-2">
            {enableDensity ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={compact}
                aria-label={copy.density.label}
                title={compact ? copy.density.compact : copy.density.comfortable}
                data-testid="table-density"
                onClick={() => {
                  setDensity(compact ? 'comfortable' : 'compact');
                }}
              >
                {compact ? (
                  <ChevronsUpDown className="size-3.5" aria-hidden />
                ) : (
                  <ChevronsDownUp className="size-3.5" aria-hidden />
                )}
              </Button>
            ) : null}
            <ColumnsMenu columns={toggles} copy={copy} />
          </div>
        </div>
      ) : null}

      {facets && facets.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2" data-print-hide>
          {facets.map((facet) => (
            <FacetFilter key={facet.id} facet={facet} copy={copy} />
          ))}
        </div>
      ) : null}

      {enableColumnReorder ? (
        <DndContext
          sensors={sensors}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: copy.reorderHint },
          }}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={handleDragEnd}
        >
          {grid}
        </DndContext>
      ) : (
        grid
      )}

      {meta ? (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
          data-print-hide
        >
          <span data-testid="table-range">
            {copy.footer.range({ from: rangeFrom, to: rangeTo, total: meta.total })}
          </span>
          <div className="flex items-center gap-2">
            {onPageSizeChange ? (
              <span className="flex items-center gap-1.5">
                <span>{copy.footer.rowsPerPage}</span>
                <Select
                  value={String(meta.pageSize)}
                  onValueChange={(value) => {
                    onPageSizeChange(Number(value));
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-[4.5rem] text-xs"
                    aria-label={copy.footer.rowsPerPage}
                    data-testid="table-page-size"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={String(option)}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            ) : null}
            {onPageChange ? (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={copy.footer.previous}
                  data-testid="table-prev-page"
                  disabled={meta.page <= 1 || loading}
                  onClick={() => {
                    onPageChange(meta.page - 1);
                  }}
                >
                  {/* Directional: the previous page is toward the reading
                      START, which is the right edge in Arabic. */}
                  <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
                </Button>
                <span className="px-1.5 tabular-nums" data-testid="table-page">
                  {copy.footer.page({ page: meta.page, pages: totalPages })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={copy.footer.next}
                  data-testid="table-next-page"
                  disabled={meta.page >= totalPages || loading}
                  onClick={() => {
                    onPageChange(meta.page + 1);
                  }}
                >
                  <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
