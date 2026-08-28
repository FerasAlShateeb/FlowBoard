import { useQuery } from '@tanstack/react-query';
import {
  projectDependenciesResponseSchema,
  type ProjectDependenciesResponse,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { dedupeEdges, type DependencyEdge } from '@/components/gantt/gantt-arrows';

/**
 * Dependency EDGES for the Roadmap's arrow layer — the whole project, in one
 * request.
 *
 * ═══ WHAT THIS REPLACED, AND WHY ══════════════════════════════════════════
 *
 * `taskSummarySchema` — the shape every collection endpoint returns — carries
 * no dependency data, so this hook used to read edges out of individual task
 * DETAIL payloads: one `GET /tasks/:id` per visible row, capped at sixty, behind
 * a long `staleTime`. That was affordable but not correct. An edge is only
 * visible from the ends that were fetched, so an arrow whose OTHER end sat
 * outside the virtualizer's window simply did not exist — scrolling made arrows
 * appear rather than revealing them, and past the cap they stopped appearing at
 * all.
 *
 * WP3.8 added `GET /projects/:projectId/dependencies`, which answers the actual
 * question in one round trip. An edge is two uuids; a project with a thousand
 * tasks has tens of them. The window filtering that used to gate the FETCH now
 * happens where it belongs — in `GanttDependencyLayer`, which draws an arrow
 * only when both of its rows are rendered and both have a bar.
 *
 * ═══ WHY IT IS STILL BEHIND THE TOOLBAR TOGGLE ════════════════════════════
 *
 * Not for cost any more — for legibility. A dense roadmap with every arrow drawn
 * is a hairball, and the toggle is how a reader asks for the constraint graph
 * when they want it. `enabled: false` therefore fetches nothing AND returns no
 * edges, rather than keeping the last set on screen.
 */

/** Edges are not live data; a project's constraint graph changes rarely. */
const DEPENDENCY_STALE_TIME = 5 * 60_000;

export interface GanttDependencies {
  edges: DependencyEdge[];
  /** True while the set is in flight — the layer fades in rather than popping. */
  isFetching: boolean;
}

/**
 * Translates the wire shape into the arrow layer's.
 *
 * The two spellings are deliberate rather than an oversight: the contract names
 * the TASKS at each end (`blockerTaskId`), because that is what the row holds;
 * the geometry layer names the ENDS of an arrow (`blockerId`), because by then
 * everything in scope is a task. One mapping function is cheaper than making
 * either layer read in the other's vocabulary.
 */
export function toEdges(response: ProjectDependenciesResponse): DependencyEdge[] {
  // `dedupeEdges` also drops self-edges. The server refuses to write one, so
  // this is belt-and-braces against a payload that would otherwise draw a loop
  // over a single bar.
  return dedupeEdges(
    response.edges.map((edge) => ({
      blockerId: edge.blockerTaskId,
      blockedId: edge.blockedTaskId,
    })),
  );
}

/**
 * The query, as OPTIONS.
 *
 * Same reasoning as `moveTaskMutationOptions` in `hooks/useTaskMutations.ts`:
 * this package's test environment is DOM-free by default, and a `QueryObserver`
 * over these options runs the genuine fetch → parse → `select` chain without a
 * provider to render into.
 */
export function ganttDependenciesQueryOptions(
  projectId: string | null | undefined,
  enabled: boolean,
) {
  return {
    queryKey: qk.project.dependencies(projectId ?? ''),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get(`/projects/${projectId ?? ''}/dependencies`, {
        schema: projectDependenciesResponseSchema,
        signal,
      }),
    enabled: Boolean(projectId) && enabled,
    staleTime: DEPENDENCY_STALE_TIME,
    select: toEdges,
  };
}

/**
 * @param projectId the project whose edges to load. Falsy disables the query.
 * @param enabled the toolbar toggle.
 */
export function useGanttDependencies(
  projectId: string | null | undefined,
  enabled: boolean,
): GanttDependencies {
  const query = useQuery(ganttDependenciesQueryOptions(projectId, enabled));

  return {
    // `enabled: false` keeps the last successful data in the cache, which is
    // right for a re-toggle but wrong for the render in between — the toggle
    // says "no arrows", so no arrows.
    edges: enabled ? (query.data ?? []) : [],
    isFetching: query.isFetching,
  };
}
