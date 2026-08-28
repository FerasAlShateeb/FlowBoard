import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChartGantt } from 'lucide-react';

import { canWriteProject, useProjectScope } from '@/hooks/useProjects';
import { roadmapTruncated, useRoadmapTasks } from '@/components/gantt/useRoadmapTasks';
import GanttChart from '@/components/gantt/GanttChart';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import { Skeleton } from '@/components/ui/skeleton';
import { AXIS_HEIGHT, ROW_HEIGHT, SIDEBAR_WIDTH } from '@/components/gantt/useGanttGeometry';

/**
 * The custom-built Roadmap / Gantt — plan §Frontend architecture, WP3.4.
 *
 * A THIN page, like every page in FlowBoard: it resolves the route scope,
 * fetches, and picks one of four states (loading / error / empty / chart). All
 * of the chart lives in `components/gantt/**`, with every date↔pixel conversion
 * behind the single `useGanttGeometry` (plan §Risks 1).
 *
 * ═══ HEIGHT ═══════════════════════════════════════════════════════════════
 *
 * `AppShell` gives `<main>` the page's scroll, and a Gantt cannot live inside a
 * document that scrolls: its axis has to stick, its canvas has to own both
 * scroll axes, and its virtualizer needs a scroll box with a real height. So
 * this page claims an explicit viewport-derived height and hands the chart a
 * `min-h-0 flex-1` box inside it — the standard way to stop a flex child from
 * refusing to shrink below its content.
 *
 * ═══ THE OUTLET ══════════════════════════════════════════════════════════
 *
 * `t/:taskKey` is a CHILD route of this one, so the task sheet renders through
 * this `<Outlet/>` over the chart, with the roadmap still mounted behind it
 * (no refetch, no scroll loss). Removing it would silently break every deep
 * link from this view.
 */
export default function RoadmapPage() {
  const { t } = useTranslation(['roadmap']);
  const { orgSlug, projectId, projectKey, project, role, isPending, error } = useProjectScope();
  const tasksQuery = useRoadmapTasks(projectId);

  const tasks = tasksQuery.data;
  const loading = isPending || tasksQuery.isPending;

  return (
    <div className="flex h-[calc(100dvh-var(--topbar-h)-2*var(--page-pad))] min-h-[480px] flex-col">
      <PageHeader title={t('roadmap:title')} description={t('roadmap:description')} />

      {error || tasksQuery.error ? (
        <ErrorState
          error={error ?? tasksQuery.error}
          title={t('roadmap:error.title')}
          onRetry={() => {
            void tasksQuery.refetch();
          }}
        />
      ) : loading ? (
        <RoadmapSkeleton />
      ) : !tasks || tasks.length === 0 ? (
        <EmptyState
          icon={<ChartGantt className="size-4" />}
          title={t('roadmap:empty.noTasksTitle')}
          message={t('roadmap:empty.noTasksBody')}
        />
      ) : (
        <GanttChart
          projectId={projectId ?? ''}
          projectKeyParam={projectKey}
          projectKey={project?.key ?? projectKey.toUpperCase()}
          orgSlug={orgSlug}
          tasks={tasks}
          statuses={project?.statuses ?? []}
          canWrite={canWriteProject(role)}
          truncated={roadmapTruncated(tasks)}
        />
      )}

      <Outlet />
    </div>
  );
}

/**
 * The loading state, shaped like the thing it is standing in for: a sidebar
 * column, an axis strip, and rows. A generic centred spinner here would
 * collapse the layout and then expand it again, which is the jump this avoids.
 */
function RoadmapSkeleton() {
  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden rounded-[var(--card-radius)] border border-border bg-surface"
      aria-busy
    >
      <div className="shrink-0 border-e border-border" style={{ width: SIDEBAR_WIDTH }}>
        <div className="border-b border-border bg-surface-raised" style={{ height: AXIS_HEIGHT }} />
        {Array.from({ length: 12 }, (_unused, index) => (
          <div key={index} className="flex items-center px-2" style={{ height: ROW_HEIGHT }}>
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="border-b border-border bg-surface-raised" style={{ height: AXIS_HEIGHT }} />
        {Array.from({ length: 12 }, (_unused, index) => (
          <div key={index} className="flex items-center px-4" style={{ height: ROW_HEIGHT }}>
            <Skeleton
              className="h-4"
              // Staggered widths and offsets so the placeholder reads as a
              // chart rather than as a table of identical grey pills.
              style={{
                width: `${String(18 + ((index * 37) % 45))}%`,
                marginInlineStart: `${String((index * 23) % 40)}%`,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
