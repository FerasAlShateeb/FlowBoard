import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  burndownReportSchema,
  burnupReportSchema,
  cumulativeFlowReportSchema,
  cycleTimeReportSchema,
  velocityReportSchema,
  workloadReportSchema,
  type BurndownReport,
  type BurnupReport,
  type CumulativeFlowReport,
  type CycleTimeReport,
  type VelocityReport,
  type WorkloadReport,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { rangeKey, type DateRange } from '@/components/reports/report-range';

/**
 * The six project reports — one query per chart on the dashboard.
 *
 * THE ONE ARCHITECTURAL DECISION HERE IS "SIX QUERIES, NOT ONE".
 * A single `/reports` call would be fewer round trips, but it would also make
 * the dashboard an all-or-nothing screen: one slow aggregation over the
 * activity stream, or one report whose payload drifts from its schema, and the
 * user gets a blank page instead of five working charts and one apologetic
 * card. Independent queries are what let each `ReportCard` own its own
 * loading / error / empty state — the per-tile degradation the dashboard is
 * specified around. Nothing in this module throws into the page; every failure
 * lands in a `UseQueryResult.error` and is rendered by the card that asked for
 * it.
 *
 * EVERY RESPONSE IS ZOD-PARSED with the shared contract (`api`'s `schema`
 * option), so a server that starts omitting `idealPoints` fails loudly in the
 * one card that reads it rather than drawing a plausible, wrong line.
 *
 * OPTIONS FACTORIES ARE EXPORTED ALONGSIDE THE HOOKS. The factories are plain
 * data — they can be handed to a `QueryObserver` in a DOM-free test, prefetched
 * on hover, or composed by a future "export all reports" action — while the
 * hooks are the two-line React binding. Same pattern as
 * `useTaskMutations`'s exported mutation options.
 *
 * ENABLED-GATING: a report is only fetched once every parameter it needs is
 * resolved. `projectId` arrives asynchronously (slug → org → key → project), and
 * the two sprint reports additionally need a sprint choice. A disabled query
 * stays `isPending` forever without ever hitting the network, which is exactly
 * the state the card renders as "pick a sprint".
 */

const REPORTS_BASE = (projectId: string): string => `/projects/${projectId}/reports`;

// ───────────────────────────────────────────────────────────────────────────
// Sprint-scoped: burndown, burnup
// ───────────────────────────────────────────────────────────────────────────

/**
 * `GET /projects/:projectId/reports/burndown?sprintId=`.
 *
 * The sprint id is BOTH the query parameter and the key's `range` segment —
 * `qk.reports.burndown(projectId, range)` takes a caller-built range string
 * precisely so a sprint id and a `from..to` window can share one key shape.
 */
export function burndownQueryOptions(
  projectId: string | null | undefined,
  sprintId: string | null | undefined,
) {
  return queryOptions({
    queryKey: qk.reports.burndown(projectId ?? '', sprintId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`${REPORTS_BASE(projectId ?? '')}/burndown`, {
        schema: burndownReportSchema,
        query: { sprintId: sprintId ?? '' },
        signal,
      }),
    enabled: Boolean(projectId) && Boolean(sprintId),
  });
}

export function useBurndown(
  projectId: string | null | undefined,
  sprintId: string | null | undefined,
): UseQueryResult<BurndownReport> {
  return useQuery(burndownQueryOptions(projectId, sprintId));
}

/** `GET /projects/:projectId/reports/burnup?sprintId=`. */
export function burnupQueryOptions(
  projectId: string | null | undefined,
  sprintId: string | null | undefined,
) {
  return queryOptions({
    queryKey: qk.reports.burnup(projectId ?? '', sprintId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`${REPORTS_BASE(projectId ?? '')}/burnup`, {
        schema: burnupReportSchema,
        query: { sprintId: sprintId ?? '' },
        signal,
      }),
    enabled: Boolean(projectId) && Boolean(sprintId),
  });
}

export function useBurnup(
  projectId: string | null | undefined,
  sprintId: string | null | undefined,
): UseQueryResult<BurnupReport> {
  return useQuery(burnupQueryOptions(projectId, sprintId));
}

// ───────────────────────────────────────────────────────────────────────────
// Range-scoped: cumulative flow, cycle time
// ───────────────────────────────────────────────────────────────────────────

/**
 * `GET /projects/:projectId/reports/cumulative-flow?from=&to=`.
 *
 * The heaviest of the six — it reconstructs history from the activity stream —
 * which is the other reason the dashboard does not bundle its reports into one
 * request: a 56-day CFD must not hold the velocity bars hostage.
 */
export function cumulativeFlowQueryOptions(projectId: string | null | undefined, range: DateRange) {
  return queryOptions({
    queryKey: qk.reports.cumulativeFlow(projectId ?? '', rangeKey(range)),
    queryFn: ({ signal }) =>
      api.get(`${REPORTS_BASE(projectId ?? '')}/cumulative-flow`, {
        schema: cumulativeFlowReportSchema,
        query: { from: range.from, to: range.to },
        signal,
      }),
    enabled: Boolean(projectId),
  });
}

export function useCumulativeFlow(
  projectId: string | null | undefined,
  range: DateRange,
): UseQueryResult<CumulativeFlowReport> {
  return useQuery(cumulativeFlowQueryOptions(projectId, range));
}

/** `GET /projects/:projectId/reports/cycle-time?from=&to=`. */
export function cycleTimeQueryOptions(projectId: string | null | undefined, range: DateRange) {
  return queryOptions({
    queryKey: qk.reports.cycleTime(projectId ?? '', rangeKey(range)),
    queryFn: ({ signal }) =>
      api.get(`${REPORTS_BASE(projectId ?? '')}/cycle-time`, {
        schema: cycleTimeReportSchema,
        query: { from: range.from, to: range.to },
        signal,
      }),
    enabled: Boolean(projectId),
  });
}

export function useCycleTime(
  projectId: string | null | undefined,
  range: DateRange,
): UseQueryResult<CycleTimeReport> {
  return useQuery(cycleTimeQueryOptions(projectId, range));
}

// ───────────────────────────────────────────────────────────────────────────
// Project-scoped: velocity, workload
// ───────────────────────────────────────────────────────────────────────────

/**
 * `GET /projects/:projectId/reports/velocity` — completed sprints, oldest
 * first. No range parameter by design: velocity IS the project's whole
 * completed history, and cropping it is what makes a trend look like a cliff.
 */
export function velocityQueryOptions(projectId: string | null | undefined) {
  return queryOptions({
    queryKey: qk.reports.velocity(projectId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`${REPORTS_BASE(projectId ?? '')}/velocity`, {
        schema: velocityReportSchema,
        signal,
      }),
    enabled: Boolean(projectId),
  });
}

export function useVelocity(projectId: string | null | undefined): UseQueryResult<VelocityReport> {
  return useQuery(velocityQueryOptions(projectId));
}

/**
 * `GET /projects/:projectId/reports/workload` — open work per assignee.
 *
 * A snapshot of NOW, not a series: it answers "who is buried today", so it
 * takes neither a sprint nor a range.
 */
export function workloadQueryOptions(projectId: string | null | undefined) {
  return queryOptions({
    queryKey: qk.reports.workload(projectId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`${REPORTS_BASE(projectId ?? '')}/workload`, {
        schema: workloadReportSchema,
        signal,
      }),
    enabled: Boolean(projectId),
  });
}

export function useWorkload(projectId: string | null | undefined): UseQueryResult<WorkloadReport> {
  return useQuery(workloadQueryOptions(projectId));
}
