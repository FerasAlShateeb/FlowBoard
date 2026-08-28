import { useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SquareKanban } from 'lucide-react';

import { canWriteProject, useProjectScope } from '@/hooks/useProjects';
import { useTransitions, useStatuses } from '@/hooks/useWorkflow';
import { useBoard } from '@/hooks/useTasks';
import { useBoardFilterState, useBoardFilters, isUnfiltered } from '@/stores/useBoardFilterStore';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import PageHeader from '@/components/common/PageHeader';
import { BoardCanvas } from '@/components/board/BoardCanvas';
import { BoardFilterBar } from '@/components/board/BoardFilterBar';
import { BoardSkeleton } from '@/components/board/BoardSkeleton';

/**
 * The Kanban board — dnd-kit columns driven by the project's custom workflow,
 * with optimistic fractional-rank drags.
 *
 * THE PAGE IS THIN, on purpose. It resolves the route scope, decides which of
 * the four states to show (loading / error / empty / board), and hands the data
 * to `BoardCanvas`. Everything that can be interesting — the drag, the lanes,
 * the filters — lives under `components/board/`.
 *
 * THE FILTER OBJECT IS RESOLVED ONCE, HERE, and passed down. `useBoard` and
 * `useMoveTask` derive the board's cache key from it, so the two must be given
 * the same value; resolving it in each consumer is exactly the drift that
 * produces an optimistic drag landing on a key nothing is rendering.
 *
 * THE `<Outlet/>` IS NOT OPTIONAL — it is where the route-layered task sheet
 * (`t/:taskKey`, a child of this route) renders. Removing it silently breaks
 * every deep link to a task from this view.
 */
export default function BoardPage() {
  const { t } = useTranslation(['board', 'common']);

  const { orgId, projectId, projectKey, project, role, isPending, error } = useProjectScope();

  // ONE filter object, shared by the query and the mutation. See the note above.
  const filters = useBoardFilters(projectId);
  const filterState = useBoardFilterState(projectId);

  const board = useBoard(projectId, filters);
  const { statuses } = useStatuses(projectId);
  const { data: transitions } = useTransitions(projectId);

  const canWrite = canWriteProject(role);

  const cardCount = useMemo(
    () =>
      Object.values(board.data?.columns ?? {}).reduce((total, column) => total + column.length, 0),
    [board.data],
  );

  const header = (
    <PageHeader title={project?.name ?? projectKey} description={t('board:description')}>
      {projectId ? <BoardFilterBar projectId={projectId} orgId={orgId} /> : null}
    </PageHeader>
  );

  // ── loading ───────────────────────────────────────────────────────────────
  if (isPending || (projectId !== null && board.isPending)) {
    return (
      <>
        <PageHeader title={project?.name ?? projectKey} description={t('board:description')} />
        <BoardSkeleton columns={statuses.length > 0 ? statuses.length : 4} />
        <Outlet />
      </>
    );
  }

  // ── error ─────────────────────────────────────────────────────────────────
  if (error || board.error) {
    return (
      <>
        {header}
        <ErrorState
          error={error ?? board.error}
          onRetry={() => {
            void board.refetch();
          }}
        />
        <Outlet />
      </>
    );
  }

  // ── a project with no workflow cannot draw a board ────────────────────────
  if (!projectId || statuses.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<SquareKanban className="size-4" />}
          title={t('board:states.noColumnsTitle')}
          message={t('board:states.noColumnsBody')}
        />
        <Outlet />
      </>
    );
  }

  // ── empty: no cards at all, or none that match the filters ────────────────
  if (cardCount === 0) {
    const unfiltered = isUnfiltered(filterState);
    return (
      <>
        {header}
        <EmptyState
          icon={<SquareKanban className="size-4" />}
          title={unfiltered ? t('board:states.emptyTitle') : t('board:states.noMatchesTitle')}
          message={unfiltered ? t('board:states.emptyBody') : t('board:states.noMatchesBody')}
        />
        <Outlet />
      </>
    );
  }

  return (
    <>
      {header}
      <BoardCanvas
        projectId={projectId}
        projectKey={project?.key ?? projectKey}
        statuses={statuses}
        labels={project?.labels ?? []}
        transitions={transitions ?? []}
        board={board.data ?? { columns: {} }}
        filters={filters}
        mode={filterState.swimlane}
        collapsedLanes={filterState.collapsedLanes}
        canWrite={canWrite}
      />
      <Outlet />
    </>
  );
}
