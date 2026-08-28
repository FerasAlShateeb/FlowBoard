import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import { taskSummarySchema, type TaskSummary } from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

/**
 * EVERY task in the project, in one cache entry — the roadmap's data source.
 *
 * ═══ WHY NOT `useTaskList` ═════════════════════════════════════════════════
 *
 * `useTaskList` asks for `pageSize: 100` and returns page ONE. That is the
 * right answer for the table (which has a footer and a pager) and the wrong one
 * for a Gantt: a roadmap that silently stopped at the hundredth task would draw
 * an epic whose roll-up bar ends in June because task 101 — the one running to
 * September — was never fetched. A roll-up computed over a partial set is not a
 * shorter roll-up, it is a WRONG one, and nothing on screen would say so.
 *
 * So this pages the endpoint out to completion and hands back the whole set
 * under `qk.tasks.roadmap(projectId)`.
 *
 * ═══ THE SHAPE IS `TaskSummary[]`, NOT `{tasks, meta}` ═════════════════════
 *
 * A bare array, deliberately, even though the pagination meta would be useful
 * here. `useTaskMutations`' `writeTaskEverywhere` walks every cache entry under
 * `qk.tasks.all(projectId)` and updates the ones that are a board or an ARRAY;
 * an entry shaped `{tasks, total}` would match neither branch, so a bar dragged
 * to a new date would be written to the server, acknowledged, and then keep
 * rendering its old position until something else invalidated the roadmap.
 * Matching the shape the shared writer already understands is what makes a
 * drag land — and what keeps a PATCH from the task sheet visible here too.
 *
 * Truncation is therefore inferred from the length rather than carried
 * alongside it — see {@link roadmapTruncated}.
 */

const taskListSchema = z.array(taskSummarySchema);

/** The API's documented ceiling on `?pageSize` (plan §REST: default 25, max 100). */
const PAGE_SIZE = 100;

/**
 * The hard stop on paging.
 *
 * Six pages = 600 tasks, which is comfortably past the "virtualized 500+ rows"
 * the plan asks the Gantt to handle and still bounded — an unbounded loop
 * against a project someone imported 40 000 issues into would hang the view
 * with no way out. Past the cap the toolbar says so rather than pretending the
 * chart is complete.
 */
export const ROADMAP_MAX_PAGES = 6;
export const ROADMAP_MAX_TASKS = PAGE_SIZE * ROADMAP_MAX_PAGES;

/**
 * True when the fetch hit {@link ROADMAP_MAX_TASKS} and the chart may be
 * missing tasks.
 *
 * Inferred from the length because the array shape leaves nowhere to put a
 * flag. It over-reports for the one project that has exactly 600 tasks; a
 * spurious "narrow this down" hint is a far cheaper error than a roadmap that
 * quietly omits work.
 */
export function roadmapTruncated(tasks: readonly TaskSummary[] | undefined): boolean {
  return (tasks?.length ?? 0) >= ROADMAP_MAX_TASKS;
}

/** One page of the flat task list, with its envelope meta. */
async function fetchPage(
  projectId: string,
  page: number,
  signal: AbortSignal | undefined,
): Promise<{ rows: TaskSummary[]; totalPages: number }> {
  const result = await api.paged(`/projects/${projectId}/tasks`, {
    schema: taskListSchema,
    query: { view: 'flat', page, pageSize: PAGE_SIZE },
    signal,
  });
  return { rows: result.data, totalPages: result.meta?.totalPages ?? 1 };
}

/**
 * Every task in the project, paged out and concatenated.
 *
 * PAGE ONE FIRST, THEN THE REST IN PARALLEL. The first request is what reveals
 * `totalPages`, so it cannot be avoided; the remaining pages have no dependency
 * on each other, and firing them together turns a six-round-trip wait into two.
 *
 * NO FILTERS PARAMETER. The roadmap deliberately shows the whole project: an
 * epic's roll-up is only correct over its complete child set, and a filter that
 * hid two children would silently shorten the epic bar. Filtering the roadmap
 * would have to filter ROWS after the roll-up, which is a different feature.
 */
export function useRoadmapTasks(
  projectId: string | null | undefined,
): UseQueryResult<TaskSummary[]> {
  return useQuery({
    queryKey: qk.tasks.roadmap(projectId ?? ''),
    queryFn: async ({ signal }) => {
      const id = projectId ?? '';
      const first = await fetchPage(id, 1, signal);

      const remaining = Math.min(first.totalPages, ROADMAP_MAX_PAGES) - 1;
      if (remaining <= 0) return first.rows;

      const rest = await Promise.all(
        Array.from({ length: remaining }, (_unused, index) => fetchPage(id, index + 2, signal)),
      );

      return rest.reduce<TaskSummary[]>((all, page) => all.concat(page.rows), [...first.rows]);
    },
    enabled: Boolean(projectId),
    // The roadmap is a planning view, not a live board: re-fetching every task
    // in the project on every window focus is a lot of traffic for a chart
    // whose data changes on the scale of days.
    staleTime: 60_000,
  });
}
