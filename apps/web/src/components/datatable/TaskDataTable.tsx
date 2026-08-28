import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTable, type OnChangeFn, type SortingState } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { Label, Sprint, Status, TaskSummary, Transition } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useLang } from '@/lib/lang-policy';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TableGridProvider,
  type EditingCell,
  type TableGridEnv,
} from '@/components/datatable/grid-context';
import { tableViewFeatures, useTaskColumns } from '@/components/datatable/table-columns';
import {
  EDITABLE_COLUMNS,
  NUMERIC_COLUMNS,
  isTableColumnId,
  type TableColumnId,
} from '@/components/datatable/table-model';
import { ariaSortOf, directionOf, nextDirectionOf } from '@/components/datatable/table-sort';
import { useCellPatch } from '@/components/datatable/useCellPatch';

/**
 * The spreadsheet itself: a virtualised, keyboard-navigable ARIA grid over one
 * server page of tasks.
 *
 * ═══ WHY THIS IS A `role="grid"` OF DIVS AND NOT A `<table>` ════════════════
 *
 * Virtualisation and native table layout are mutually exclusive. A virtualised
 * body positions its rows absolutely against a spacer of the total height,
 * which a `<tbody>` cannot do without `display: grid` — and the moment you set
 * that, the browser drops the table's implicit ARIA semantics anyway, so every
 * role has to be spelled out by hand regardless. Given that, divs plus explicit
 * roles is the honest version: one markup shape whether 12 rows are rendered or
 * 1200, and no invisible dependency on a display value.
 *
 * ═══ THE KEYBOARD MODEL (ARIA APG "grid") ══════════════════════════════════
 *
 * * **The body has ONE tab stop.** Exactly one data cell carries `tabIndex=0`
 *   (the "active" cell); every other cell and every focusable descendant —
 *   including the key column's link — is `tabIndex=-1`. Without this, a
 *   100-row table would put hundreds of stops between the toolbar and the
 *   footer, and Tab would stop being a navigation key.
 * * **Arrows move the active cell**, and they are MIRRORED under RTL:
 *   ArrowRight moves toward the reading START in Arabic, because the user means
 *   "the cell my eye moves to", not "the cell at a larger column index".
 *   Home/End jump within the row, Ctrl+Home/End to the first/last cell,
 *   PageUp/PageDown by a screenful.
 * * **Enter or F2 activates** the active cell: an editor for an editable
 *   column, the task sheet for the key column. Escape closes an editor and
 *   returns focus to the cell it belonged to — never to the document.
 * * **Tab is left alone.** Inside an open editor it moves within that editor's
 *   own widgets; outside one it leaves the grid entirely. That is the whole
 *   point of the single tab stop.
 *
 * Focus is moved by a bumped token rather than by an effect on `active` alone,
 * so a POINTER click (which the browser already focused) does not trigger a
 * second, redundant `.focus()` — and a virtualised row is scrolled into
 * existence before the focus attempt, because a cell that is not rendered
 * cannot be focused.
 */

/** Row height in px. Fixed, not measured — see {@link TaskDataTable}. */
const ROW_HEIGHT = 34;

/**
 * Below this many rows, virtualisation costs more than it saves: the absolute
 * positioning, the spacer and the scroll listener all have to exist for a body
 * the browser would have laid out in one pass. A page size of 25 or 50 renders
 * in full; 100 virtualises.
 */
const VIRTUALIZE_ABOVE = 50;

/** Rows rendered outside the viewport, so a fast scroll does not show gaps. */
const OVERSCAN = 8;

export interface TaskDataTableProps {
  projectId: string;
  orgId: string | null;
  projectKey: string;
  /** One server page, already filtered, sorted and paginated. */
  tasks: TaskSummary[];
  isPending: boolean;
  statuses: readonly Status[];
  transitions: readonly Transition[];
  labels: readonly Label[];
  sprints: readonly Sprint[];
  /** `false` for a viewer — every cell renders read-only. */
  canWrite: boolean;
  columnOrder: TableColumnId[];
  columnVisibility: Record<string, boolean>;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  /** 0-based index of this page's first row across the whole result set. */
  rowOffset: number;
  /** `meta.total` — what `aria-rowcount` announces. */
  totalRowCount: number;
  /** Rendered in place of the body when the page has no rows. */
  emptyState: ReactNode;
}

export function TaskDataTable({
  projectId,
  orgId,
  projectKey,
  tasks,
  isPending,
  statuses,
  transitions,
  labels,
  sprints,
  canWrite,
  columnOrder,
  columnVisibility,
  sorting,
  onSortingChange,
  rowOffset,
  totalRowCount,
  emptyState,
}: TaskDataTableProps) {
  const { t } = useTranslation(['table']);
  const isRtl = useLang() === 'ar';

  const columns = useTaskColumns();
  const patcher = useCellPatch(projectId);

  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [active, setActive] = useState({ row: 0, col: 0 });
  /** Bumped whenever focus should MOVE. Zero means "do not touch focus". */
  const [focusToken, setFocusToken] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const table = useTable({
    features: tableViewFeatures,
    columns,
    data: tasks,
    // The row id is the task id, so a re-fetch that reorders rows keeps every
    // row's identity — which is what stops an open editor jumping to a
    // different task when a page refreshes underneath it.
    getRowId: (row) => row.id,
    state: { sorting, columnOrder, columnVisibility },
    onSortingChange,
    // The server sorts. Registering `sortedRowModel` would sort this page among
    // itself ON TOP of the server's global order.
    //
    // There is deliberately no `manualPagination`/`rowCount` here: those belong
    // to `rowPaginationFeature`, which this table does not register at all. The
    // page window is the PAGE's state (it is part of the request), so the table
    // only ever sees one already-paginated slice and `aria-rowcount` comes from
    // the envelope's `meta` via {@link TaskDataTableProps.totalRowCount}.
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: true,
    sortDescFirst: false,
  });

  const rows = table.getRowModel().rows;
  const visibleColumns = table.getVisibleLeafColumns();
  const headerGroups = table.getHeaderGroups();

  /**
   * The CSS grid template.
   *
   * `title` is `minmax(size, 1fr)` — it absorbs the leftover width, which is
   * what makes a wide screen show more of the one column anybody reads. Every
   * other column is fixed, so the columns line up between the sticky header and
   * the body without a measurement pass.
   */
  const gridTemplateColumns = useMemo(
    () =>
      visibleColumns
        .map((column) =>
          column.id === 'title' ? `minmax(${column.getSize()}px, 1fr)` : `${column.getSize()}px`,
        )
        .join(' '),
    [visibleColumns],
  );

  /** Total fixed width, so narrow viewports scroll instead of crushing columns. */
  const minWidth = useMemo(
    () => visibleColumns.reduce((total, column) => total + column.getSize(), 0),
    [visibleColumns],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: OVERSCAN,
    // Rows are a fixed height by design, so dynamic measurement is skipped: it
    // would run a ResizeObserver per visible row for a number this component
    // already knows.
  });

  const virtualized = rows.length > VIRTUALIZE_ABOVE;

  // Keep the active cell inside the grid when the page, the sort or the column
  // set changes underneath it. Without this, paging from 100 rows to 12 leaves
  // `active.row` pointing at nothing and the next arrow press does nothing.
  useEffect(() => {
    setActive((current) => {
      const row = Math.min(current.row, Math.max(rows.length - 1, 0));
      const col = Math.min(current.col, Math.max(visibleColumns.length - 1, 0));
      return row === current.row && col === current.col ? current : { row, col };
    });
  }, [rows.length, visibleColumns.length]);

  /** Closes the editor and hands focus back to the cell that owned it. */
  const endEdit = useCallback(() => {
    setEditing(null);
    setFocusToken((token) => token + 1);
  }, []);

  const beginEdit = useCallback(
    (cell: EditingCell) => {
      if (!canWrite) return;
      setEditing(cell);
    },
    [canWrite],
  );

  const env = useMemo<TableGridEnv>(
    () => ({
      projectId,
      orgId,
      projectKey,
      statuses,
      transitions,
      labels,
      sprints,
      canWrite,
      patcher,
      editing,
      beginEdit,
      endEdit,
    }),
    [
      projectId,
      orgId,
      projectKey,
      statuses,
      transitions,
      labels,
      sprints,
      canWrite,
      patcher,
      editing,
      beginEdit,
      endEdit,
    ],
  );

  // Focus follows the active cell, but ONLY after an explicit request. A
  // pointer click is already focused by the browser; re-focusing it here would
  // fight text selection inside an editor that opened in the same click.
  useEffect(() => {
    if (focusToken === 0) return;
    const cell = gridRef.current?.querySelector<HTMLElement>('[data-active-cell="true"]');
    cell?.focus();
  }, [focusToken, active.row, active.col]);

  /** Moves the active cell and asks for focus, scrolling a virtual row in first. */
  const moveTo = useCallback(
    (row: number, col: number) => {
      const nextRow = Math.min(Math.max(row, 0), Math.max(rows.length - 1, 0));
      const nextCol = Math.min(Math.max(col, 0), Math.max(visibleColumns.length - 1, 0));

      if (virtualized) virtualizer.scrollToIndex(nextRow, { align: 'auto' });

      setActive({ row: nextRow, col: nextCol });
      setFocusToken((token) => token + 1);
    },
    [rows.length, visibleColumns.length, virtualized, virtualizer],
  );

  /** Enter / F2 / double-click on a cell. */
  const activateCell = useCallback(
    (rowIndex: number, colIndex: number) => {
      const row = rows[rowIndex];
      const column = visibleColumns[colIndex];
      if (!row || !column || !isTableColumnId(column.id)) return;

      if (column.id === 'key') {
        // The cell holds a link and the roving-focus rule made it
        // unreachable by Tab; Enter follows it.
        const link = gridRef.current?.querySelector<HTMLAnchorElement>(
          '[data-active-cell="true"] a',
        );
        link?.click();
        return;
      }

      if (EDITABLE_COLUMNS.includes(column.id)) {
        beginEdit({ taskId: row.original.id, columnId: column.id });
      }
    },
    [beginEdit, rows, visibleColumns],
  );

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // While an editor is open it owns the keyboard — including the arrows,
    // which move a caret inside a text input.
    if (editing) return;

    const { row, col } = active;
    // ArrowRight means "the next cell my eye reaches", which is a LOWER column
    // index once the grid is mirrored.
    const forward = isRtl ? -1 : 1;

    switch (event.key) {
      case 'ArrowRight':
        moveTo(row, col + forward);
        break;
      case 'ArrowLeft':
        moveTo(row, col - forward);
        break;
      case 'ArrowDown':
        moveTo(row + 1, col);
        break;
      case 'ArrowUp':
        moveTo(row - 1, col);
        break;
      case 'PageDown':
        moveTo(row + 10, col);
        break;
      case 'PageUp':
        moveTo(row - 10, col);
        break;
      case 'Home':
        moveTo(event.ctrlKey ? 0 : row, 0);
        break;
      case 'End':
        moveTo(event.ctrlKey ? rows.length - 1 : row, visibleColumns.length - 1);
        break;
      case 'Enter':
      case 'F2':
        activateCell(row, col);
        break;
      default:
        // Every other key belongs to the browser (Tab, typeahead, shortcuts).
        return;
    }

    // Only reached by a handled key, so a Tab or a shortcut is never swallowed.
    event.preventDefault();
  };

  const renderRow = (rowIndex: number, style?: React.CSSProperties) => {
    const row = rows[rowIndex];
    if (!row) return null;

    return (
      <div
        key={row.id}
        role="row"
        aria-rowindex={rowOffset + rowIndex + 2}
        data-index={rowIndex}
        style={{ ...style, gridTemplateColumns }}
        className="grid items-stretch border-b border-border/60 transition-colors duration-[var(--speed)] hover:bg-accent/30"
      >
        {row.getVisibleCells().map((cell, colIndex) => {
          const columnId = cell.column.id;
          const isActive = active.row === rowIndex && active.col === colIndex;
          const isEditing = editing?.taskId === row.original.id && editing.columnId === columnId;
          const editable =
            canWrite && isTableColumnId(columnId) && EDITABLE_COLUMNS.includes(columnId);

          return (
            <div
              key={cell.id}
              role="gridcell"
              aria-colindex={colIndex + 1}
              tabIndex={isActive ? 0 : -1}
              data-active-cell={isActive || undefined}
              data-editing={isEditing || undefined}
              onFocus={() => {
                if (!isActive) setActive({ row: rowIndex, col: colIndex });
              }}
              onClick={() => {
                setActive({ row: rowIndex, col: colIndex });
                if (editable && !isEditing) beginEdit({ taskId: row.original.id, columnId });
              }}
              className={cn(
                'relative flex min-w-0 items-center overflow-hidden px-2 text-sm outline-none',
                'focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
                isTableColumnId(columnId) && NUMERIC_COLUMNS.includes(columnId) && 'tabular-nums',
                columnId === 'points' && 'justify-end',
                editable && !isEditing && 'cursor-text',
              )}
            >
              <table.FlexRender cell={cell} />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <TableGridProvider value={env}>
      <div
        ref={scrollRef}
        className="relative max-h-[calc(100vh-16rem)] min-h-40 overflow-auto rounded-[var(--card-radius)] border border-border bg-surface"
      >
        <div
          ref={gridRef}
          role="grid"
          aria-label={t('table:grid.label')}
          aria-rowcount={totalRowCount + 1}
          aria-colcount={visibleColumns.length}
          aria-busy={isPending || undefined}
          onKeyDown={onGridKeyDown}
          style={{ minWidth }}
        >
          {/* Sticky header. `top-0` resolves against the scroll container above. */}
          <div role="rowgroup" className="sticky top-0 z-20 bg-surface-raised">
            {headerGroups.map((group) => (
              <div
                key={group.id}
                role="row"
                aria-rowindex={1}
                style={{ gridTemplateColumns }}
                className="grid border-b border-border"
              >
                {group.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const direction = directionOf(sorting, header.column.id);
                  const SortIcon =
                    direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown;

                  const label =
                    typeof header.column.columnDef.header === 'string'
                      ? header.column.columnDef.header
                      : header.column.id;

                  return (
                    <div
                      key={header.id}
                      role="columnheader"
                      // `aria-sort` is set on EVERY sortable header, including the
                      // unsorted ones: an absent attribute is announced as
                      // "not a sort control", which is a different claim.
                      aria-sort={canSort ? ariaSortOf(sorting, header.column.id) : undefined}
                      className="flex h-8 items-center overflow-hidden px-2 text-xs font-medium text-muted-foreground"
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="-mx-1 flex h-6 min-w-0 items-center gap-1 rounded-[var(--btn-radius)] px-1 transition-colors duration-[var(--speed)] hover:bg-accent hover:text-foreground"
                        >
                          <span className="truncate">{label}</span>
                          <SortIcon
                            aria-hidden
                            className={cn(
                              'size-3 shrink-0',
                              direction === false && 'opacity-0 group-hover:opacity-60',
                            )}
                          />
                          {/* The action, not the state: `aria-sort` already
                            announces the state, and a button whose name never
                            changes is unusable ("Title, button" tells you
                            nothing about what pressing it does). */}
                          <span className="sr-only">
                            {t(`table:grid.sortTo.${nextDirectionOf(sorting, header.column.id)}`)}
                          </span>
                        </button>
                      ) : (
                        <span className="truncate">{label}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div
            role="rowgroup"
            style={
              virtualized ? { height: virtualizer.getTotalSize(), position: 'relative' } : undefined
            }
          >
            {isPending && rows.length === 0
              ? Array.from({ length: 6 }, (_, index) => (
                  <div
                    key={`skeleton-${String(index)}`}
                    role="row"
                    aria-rowindex={index + 2}
                    style={{ gridTemplateColumns }}
                    className="grid border-b border-border/60"
                  >
                    {visibleColumns.map((column, colIndex) => (
                      <div
                        key={column.id}
                        role="gridcell"
                        aria-colindex={colIndex + 1}
                        className="flex h-[34px] items-center px-2"
                      >
                        <Skeleton className="h-3 w-full" />
                      </div>
                    ))}
                  </div>
                ))
              : null}

            {!isPending && rows.length === 0 ? emptyState : null}

            {virtualized
              ? virtualizer.getVirtualItems().map((item) =>
                  renderRow(item.index, {
                    position: 'absolute',
                    insetInlineStart: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${String(item.start)}px)`,
                  }),
                )
              : rows.map((_, index) => renderRow(index, { minHeight: ROW_HEIGHT }))}
          </div>
        </div>
      </div>
    </TableGridProvider>
  );
}
