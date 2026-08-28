import { useCallback, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useProjectScope } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { projectPath } from '@/hooks/useRouteScope';
import PageHeader from '@/components/common/PageHeader';
import PageSpinner from '@/components/common/PageSpinner';
import ErrorState from '@/components/common/ErrorState';
import { BurndownCard } from '@/components/reports/BurndownChart';
import { BurnupCard } from '@/components/reports/BurnupChart';
import { CumulativeFlowCard } from '@/components/reports/CumulativeFlowChart';
import { CycleTimeCard } from '@/components/reports/CycleTimeScatter';
import { VelocityCard } from '@/components/reports/VelocityChart';
import { WorkloadCard } from '@/components/reports/WorkloadBars';
import ReportRangePicker from '@/components/reports/ReportRangePicker';
import SprintPicker from '@/components/reports/SprintPicker';
import { defaultRange, type DateRange } from '@/components/reports/report-range';
import { pickDefaultSprintId } from '@/components/reports/sprint-default';

/**
 * The project dashboard: six reports — burndown, burnup, cumulative flow,
 * velocity, cycle time and workload.
 *
 * ── WHAT THIS FILE OWNS, AND WHAT IT DOES NOT ─────────────────────────────
 * It owns the two pieces of state the reports SHARE — the selected sprint and
 * the selected date window — and nothing else. Each card owns its own query,
 * its own loading skeleton, its own error state with a retry, and its own empty
 * message. That is the point: six independent queries mean a cumulative-flow
 * aggregation that times out costs the user one tile, not the page. There is no
 * top-level "is anything loading" gate here on purpose.
 *
 * The only thing that DOES block the page is the project scope itself — without
 * a `projectId` there is nothing to report on, and six identical "no project"
 * cards would be six times the noise for one piece of information.
 *
 * ── THE TWO CONTROLS ──────────────────────────────────────────────────────
 * `SprintPicker` drives the burndown and burnup (both are `?sprintId=`
 * reports); the range picker drives the cumulative flow and cycle time (both
 * `?from=&to=`). Velocity and workload take neither — velocity is the whole
 * completed history and workload is a snapshot of now.
 *
 * THE SPRINT DEFAULT IS DERIVED, NOT SYNCHRONISED. `selectedSprintId` starts
 * `null` and the render falls back to `pickDefaultSprintId(sprints)` — active
 * sprint, else most recently completed. Writing that default into state from an
 * effect would mean one render with no selection, a second with it, and a stale
 * pin if the user later completes the sprint; the fallback expression has none
 * of those problems and no effect to keep in step.
 *
 * ── RTL ───────────────────────────────────────────────────────────────────
 * Everything on this page flips with the language EXCEPT the plot interiors,
 * which are `dir="ltr"` islands — Recharts computes pixel positions from a
 * left-origin model and cannot mirror. See `components/reports/ChartFrame.tsx`
 * for the full argument; it is the same policy the Gantt time axis uses.
 *
 * ── THE `<Outlet/>` ───────────────────────────────────────────────────────
 * Not optional. `t/:taskKey` is a CHILD route of this one, so the outlet is
 * where the deep-linkable task sheet renders over the dashboard — which is also
 * what makes clicking a cycle-time dot work.
 */
export default function DashboardPage() {
  const { t } = useTranslation(['reports', 'common']);
  const navigate = useNavigate();
  const { orgSlug, projectKey, projectId, isPending, error } = useProjectScope();

  const sprintsQuery = useSprints(projectId);

  // See the header: the default is a fallback in the render, never a `useState`
  // initialiser (the list has not arrived yet) and never an effect.
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const sprintId = selectedSprintId ?? pickDefaultSprintId(sprintsQuery.data);

  // `defaultRange()` reads today's date, so it goes through the lazy initialiser
  // — as a plain default it would be recomputed on every render and mint a new
  // object identity, which is a new query key for two of the six cards.
  const [range, setRange] = useState<DateRange>(() => defaultRange());

  /**
   * A cycle-time dot opens its task in the sheet layered over this page.
   *
   * Built as an ABSOLUTE path rather than a relative `t/FB-1` navigate: the
   * click originates inside a Recharts SVG, several components below the route
   * element, and relative resolution there depends on which route matched
   * closest — a fragile thing to hang a deep link on.
   */
  const openTask = useCallback(
    (taskKey: string) => {
      if (!orgSlug || !projectKey) return;
      void navigate(`${projectPath(orgSlug, projectKey, 'dashboard')}/t/${taskKey}`);
    },
    [navigate, orgSlug, projectKey],
  );

  const toolbar = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('reports:toolbar.sprintLabel')}</span>
          <SprintPicker
            sprints={sprintsQuery.data}
            value={sprintId}
            onChange={setSelectedSprintId}
            isPending={sprintsQuery.isPending}
          />
        </div>
        <ReportRangePicker range={range} onChange={setRange} />
      </div>
    ),
    [range, sprintId, sprintsQuery.data, sprintsQuery.isPending, t],
  );

  if (isPending) return <PageSpinner />;
  if (error || !projectId) return <ErrorState error={error} />;

  return (
    <>
      <PageHeader title={t('reports:title')} description={t('reports:description')}>
        {toolbar}
      </PageHeader>

      {/*
        Two columns from `xl` up, one below. Not a denser grid: a burndown
        squeezed into a third of a laptop screen has ~6px per sprint day, and
        the whole point of these cards is that the shape is readable.
      */}
      <div className="grid grid-cols-1 gap-[var(--gap)] xl:grid-cols-2">
        <BurndownCard projectId={projectId} sprintId={sprintId} />
        <BurnupCard projectId={projectId} sprintId={sprintId} />
        <CumulativeFlowCard projectId={projectId} range={range} />
        <VelocityCard projectId={projectId} />
        <CycleTimeCard projectId={projectId} range={range} onSelectTask={openTask} />
        <WorkloadCard projectId={projectId} />
      </div>

      <Outlet />
    </>
  );
}
