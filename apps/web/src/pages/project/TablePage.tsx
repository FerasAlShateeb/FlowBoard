import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Table2 } from 'lucide-react';
import type { OnChangeFn, SortingState } from '@tanstack/react-table';
import type { TaskSummary } from '@flowboard/shared';

import { canWriteProject, useLabels, useProjectScope } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { useTaskPage } from '@/hooks/useTasks';
import { useWorkflow } from '@/hooks/useWorkflow';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import PageHeader from '@/components/common/PageHeader';
import PageSpinner from '@/components/common/PageSpinner';
import { TaskDataTable } from '@/components/datatable/TaskDataTable';
import TablePagination, { type PageSize } from '@/components/datatable/TablePagination';
import TableToolbar from '@/components/datatable/TableToolbar';
import {
  emptyTableFilters,
  isEmptyFilterState,
  toTaskFilterInput,
  type TableFilterState,
} from '@/components/datatable/table-filters';
import {
  clearColumnPrefs,
  defaultColumnPrefs,
  loadColumnPrefs,
  loadTableFilters,
  saveColumnPrefs,
  saveTableFilters,
  toVisibilityState,
  type TableColumnPrefs,
} from '@/components/datatable/table-prefs';
import { toSortQuery } from '@/components/datatable/table-sort';
import { useCsvExport } from '@/components/datatable/useCsvExport';

/**
 * The Table view — a spreadsheet over the project's tasks.
 *
 * ═══ WHAT THIS PAGE OWNS ═══════════════════════════════════════════════════
 *
 * All of the view state, and none of the rendering: the filters, the sort, the
 * page, the page size and the column layout live here because every one of them
 * changes the SERVER QUERY, and a query assembled in three components is a
 * query that eventually disagrees with itself. `TableToolbar`, `TaskDataTable`
 * and `TablePagination` are handed values and callbacks.
 *
 * ═══ EVERYTHING IS SERVER-SIDE ═════════════════════════════════════════════
 *
 * Filtering, sorting and pagination all happen in Postgres. That is not a
 * performance preference — it is the only correct answer: a client-side sort
 * would order the 25 rows of the current page among themselves and leave the
 * other 900 untouched, which reads as "sorting is broken" rather than "sorting
 * is local". So `useTaskPage` carries the filters, the `?sort=field:dir` spec
 * and the page window, and the grid renders exactly what comes back.
 *
 * ═══ WHY THE FILTERS ARE NOT THE BOARD'S ═══════════════════════════════════
 *
 * `fb-table-filters-v1`, not `fb-board-filters-v1`. The board's lens is the
 * board's; opening the table and finding it silently narrowed by a filter set
 * on another screen is the kind of thing that gets reported as missing data.
 * Two views, two independent lenses — see `table-filters.ts`.
 *
 * ═══ THE `<Outlet/>` IS LOAD-BEARING ═══════════════════════════════════════
 *
 * `t/:taskKey` is a CHILD route of this one, so the task sheet renders through
 * this outlet with the table still mounted underneath. Remove it and every
 * `FB-142` link in the key column opens a blank screen.
 */

/**
 * The fallback rows array, at module scope.
 *
 * TanStack v9 treats `data` as a model input and re-derives every dependent
 * model when its identity changes; `tasks ?? []` inline would mint a new array
 * on every render and invalidate the row model continuously.
 */
const NO_TASKS: TaskSummary[] = [];

const DEFAULT_PAGE_SIZE: PageSize = 25;

export default function TablePage() {
  const { t } = useTranslation(['table', 'common']);
  const { orgId, projectId, projectKey, project, role, isPending, error } = useProjectScope();

  const canWrite = canWriteProject(role);

  // ── View state ────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<TableFilterState>(emptyTableFilters);
  const [columnPrefs, setColumnPrefs] = useState<TableColumnPrefs>(defaultColumnPrefs);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

  /**
   * Hydrate the persisted state ONCE the project id is known.
   *
   * It is not known on the first render — `useProjectScope` walks slug → org →
   * key → project — so the initial `useState` cannot read storage. The ref
   * gates on the id rather than on a boolean so navigating between two projects
   * re-hydrates instead of carrying the previous project's lens across.
   */
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || hydratedFor.current === projectId) return;
    hydratedFor.current = projectId;
    setFilters(loadTableFilters(projectId));
    setColumnPrefs(loadColumnPrefs(projectId));
    setSorting([]);
    setPage(1);
  }, [projectId]);

  // ── Reference data the cells and filters read ─────────────────────────────
  const { workflow } = useWorkflow(projectId);
  const { data: labels } = useLabels(projectId);
  const { data: sprints } = useSprints(projectId);

  const projectLabels = labels ?? project?.labels ?? [];
  const projectSprints = sprints ?? [];

  // ── The query ─────────────────────────────────────────────────────────────
  // Filters and ordering travel SEPARATELY, the way the contract spells them:
  // `taskFiltersSchema` has no `sort`, and `useTaskPage` takes it beside `page`.
  const taskFilters = useMemo(() => toTaskFilterInput(filters), [filters]);
  const sort = useMemo(() => toSortQuery(sorting), [sorting]);

  const taskPage = useTaskPage(projectId, taskFilters, { page, pageSize, sort });
  const rows = taskPage.data?.data ?? NO_TASKS;
  const meta = taskPage.data?.meta;

  // ── State updates that also reset the page window ─────────────────────────
  const updateFilters = useCallback(
    (next: TableFilterState) => {
      setFilters(next);
      // A narrower filter can make page 7 stop existing; landing on an empty
      // page that says "0 of 12" is the classic pagination bug.
      setPage(1);
      if (projectId) saveTableFilters(projectId, next);
    },
    [projectId],
  );

  const onSortingChange = useCallback<OnChangeFn<SortingState>>((updater) => {
    setSorting((current) => (typeof updater === 'function' ? updater(current) : updater));
    setPage(1);
  }, []);

  const updateColumnPrefs = useCallback(
    (next: TableColumnPrefs) => {
      setColumnPrefs(next);
      if (projectId) saveColumnPrefs(projectId, next);
    },
    [projectId],
  );

  const resetColumnPrefs = useCallback(() => {
    setColumnPrefs(defaultColumnPrefs());
    if (projectId) clearColumnPrefs(projectId);
  }, [projectId]);

  // ── Derived column layout ─────────────────────────────────────────────────
  const columnVisibility = useMemo(
    () => toVisibilityState(columnPrefs.hidden),
    [columnPrefs.hidden],
  );

  /** Visible columns in the user's order — what the CSV mirrors. */
  const visibleColumnIds = useMemo(() => {
    const hidden = new Set(columnPrefs.hidden);
    return columnPrefs.order.filter((id) => !hidden.has(id));
  }, [columnPrefs]);

  const { exportCsv, isExporting } = useCsvExport({
    projectId: projectId ?? '',
    projectKey,
    filters: taskFilters,
    sort,
    columnIds: visibleColumnIds,
    statuses: workflow.statuses,
    sprints: projectSprints,
    labels: projectLabels,
  });

  // ── Render ────────────────────────────────────────────────────────────────
  if (isPending) return <PageSpinner />;
  if (error || !projectId) return <ErrorState error={error} />;

  const filtered = !isEmptyFilterState(filters);

  return (
    <>
      <PageHeader
        title={t('table:title')}
        description={
          canWrite
            ? t('table:subtitle', { project: project?.name ?? projectKey })
            : t('table:grid.readOnly')
        }
      >
        <TableToolbar
          orgId={orgId}
          filters={filters}
          onFiltersChange={updateFilters}
          statuses={workflow.statuses}
          labels={projectLabels}
          sprints={projectSprints}
          columnPrefs={columnPrefs}
          onColumnPrefsChange={updateColumnPrefs}
          onColumnPrefsReset={resetColumnPrefs}
          onExport={() => {
            void exportCsv();
          }}
          isExporting={isExporting}
        />
      </PageHeader>

      {taskPage.error ? (
        <ErrorState
          error={taskPage.error}
          onRetry={() => {
            void taskPage.refetch();
          }}
        />
      ) : (
        <>
          <TaskDataTable
            projectId={projectId}
            orgId={orgId}
            projectKey={projectKey}
            tasks={rows}
            isPending={taskPage.isPending}
            statuses={workflow.statuses}
            transitions={workflow.transitions}
            labels={projectLabels}
            sprints={projectSprints}
            canWrite={canWrite}
            columnOrder={columnPrefs.order}
            columnVisibility={columnVisibility}
            sorting={sorting}
            onSortingChange={onSortingChange}
            rowOffset={(page - 1) * pageSize}
            totalRowCount={meta?.total ?? rows.length}
            emptyState={
              <EmptyState
                icon={<Table2 className="size-4" />}
                title={filtered ? t('table:grid.noMatches') : t('table:grid.empty')}
                message={filtered ? t('table:grid.noMatchesBody') : t('table:grid.emptyBody')}
              />
            }
          />

          <TablePagination
            meta={meta}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              // The row the user was looking at is not on "page 3 of 50 rows",
              // so anchoring anywhere but the start would be a guess.
              setPage(1);
            }}
          />
        </>
      )}

      {/* The route-layered task sheet (`t/:taskKey`) renders here. */}
      <Outlet />
    </>
  );
}
