import { useEffect } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  boardResponseSchema,
  taskSchema,
  taskSummarySchema,
  type BoardResponse,
  type Task,
  type TaskFilters,
  type TaskSummary,
} from '@flowboard/shared';

import { api, type QueryValue } from '@/lib/api';
import { qk, type FilterValue, type PageParams } from '@/lib/query-keys';
import { isStaleTaskWrite, type SprintBucket } from '@/lib/board-cache';

/**
 * Task READS. The writes — including the optimistic Kanban drag — live in
 * `useTaskMutations.ts`, because that file is an order of magnitude more
 * intricate and mixing the two would bury it.
 *
 * ONE ENDPOINT, THREE SHAPES. `GET /projects/:id/tasks` answers a board
 * (`view=board`, columns keyed by status id) or a flat page (`view=flat`,
 * `TaskSummary[]` with envelope meta). The board is not paginated — a board is
 * not a page — which is why the two have separate hooks rather than one with a
 * mode flag.
 *
 * FILTERS ARE THE CACHE KEY. `qk.tasks.board(projectId, filters)` runs the
 * filter object through `filtersKey()`, which sorts keys and array members and
 * drops empties — so a filter bar that rebuilds its object every render still
 * hits one cache entry, and `{label:['a','b']}` and `{label:['b','a']}` do not
 * fetch the same rows twice. The SAME object must be passed to the mutation
 * hooks, or their optimistic write lands on a key nothing is rendering.
 */

const taskListSchema = z.array(taskSummarySchema);

/**
 * The filter object every task query and mutation hook takes.
 *
 * Structurally `TaskFilters` (the shared contract) narrowed to what a query
 * string can carry, so it is usable as BOTH the request params and the cache
 * key without a conversion step in between.
 */
export type TaskFilterInput = Partial<Record<keyof TaskFilters, FilterValue>>;

/** Strips empty entries so an unset filter never reaches the query string. */
function toQueryParams(filters: TaskFilterInput | undefined): Record<string, QueryValue> {
  const params: Record<string, QueryValue> = {};
  if (!filters) return params;
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (value === '') continue;
    params[key] = value;
  }
  return params;
}

/**
 * `GET /projects/:projectId/tasks?view=board` — every column, each already
 * ordered by `boardRank`.
 *
 * `placeholderData: keepPreviousData` is deliberately NOT set: a filter change
 * genuinely changes which cards exist, and showing the previous filter's board
 * while the new one loads reads as the filter having failed. The board's own
 * skeleton is the right answer there.
 */
export function useBoard(
  projectId: string | null | undefined,
  filters?: TaskFilterInput,
): UseQueryResult<BoardResponse> {
  return useQuery({
    queryKey: qk.tasks.board(projectId ?? '', filters),
    queryFn: ({ signal }) =>
      api.get(`/projects/${projectId ?? ''}/tasks`, {
        schema: boardResponseSchema,
        query: { ...toQueryParams(filters), view: 'board' },
        signal,
      }),
    enabled: Boolean(projectId),
  });
}

/**
 * `GET /projects/:projectId/tasks?view=flat` — the table, calendar and roadmap
 * shape.
 *
 * Returns the rows only. A caller that needs the pagination `meta` block
 * (the Table view's footer) should use {@link useTaskPage} instead.
 */
export function useTaskList(
  projectId: string | null | undefined,
  filters?: TaskFilterInput,
): UseQueryResult<TaskSummary[]> {
  return useQuery({
    queryKey: qk.tasks.list(projectId ?? '', filters),
    queryFn: ({ signal }) =>
      api.get(`/projects/${projectId ?? ''}/tasks`, {
        schema: taskListSchema,
        query: { ...toQueryParams(filters), view: 'flat', pageSize: 100 },
        signal,
      }),
    enabled: Boolean(projectId),
  });
}

/**
 * A page of tasks plus the `{page,pageSize,total,totalPages}` meta block.
 *
 * `sort` (`field:asc|desc`, from `taskSortQuerySchema`'s closed field list) is a
 * FIRST-CLASS member of the third argument rather than a member of `filters`,
 * because that is what it is in the contract: `taskListQuerySchema` keeps `sort`
 * beside `view` and the pagination keys, and `taskFiltersSchema` has never had
 * it. WP3.5 smuggled it through the filter object (`TaskListQueryInput =
 * TaskFilterInput & { sort }`), which worked — every own property is forwarded
 * and folded into the key — but it made the filter type lie about its own shape
 * and left the one caller that needed a sort building a bespoke intersection.
 */
export function useTaskPage(
  projectId: string | null | undefined,
  filters?: TaskFilterInput,
  page?: PageParams,
) {
  const sort = page?.sort;

  return useQuery({
    queryKey: qk.tasks.list(projectId ?? '', filters, page),
    queryFn: ({ signal }) =>
      api.paged(`/projects/${projectId ?? ''}/tasks`, {
        schema: taskListSchema,
        query: {
          ...toQueryParams(filters),
          ...(sort === undefined ? {} : { sort }),
          view: 'flat',
          page: page?.page ?? 1,
          pageSize: page?.pageSize ?? 25,
        },
        signal,
      }),
    enabled: Boolean(projectId),
  });
}

/**
 * One backlog bucket — a sprint, or the backlog proper — ordered by
 * `backlogRank`.
 *
 * ONE QUERY PER BUCKET, not one query for the whole backlog page. The backlog
 * is a stack of independently draggable lists, and a drag between two of them
 * has to splice exactly two cache entries; a single entry holding every bucket
 * would make every drag rewrite the whole page's data and re-render every
 * sprint section.
 *
 * `sprintId: null` uses the `'none'` sentinel, which is how the API's
 * multi-value filters spell "the NULL bucket" — omitting the param entirely
 * would mean "do not filter", a different question.
 */
export function useBacklogBucket(
  projectId: string | null | undefined,
  sprintId: SprintBucket,
  filters?: TaskFilterInput,
): UseQueryResult<TaskSummary[]> {
  const bucketFilters: TaskFilterInput = { ...filters, sprintId: sprintId ?? 'none' };

  return useQuery({
    queryKey: qk.tasks.backlog(projectId ?? '', bucketFilters),
    queryFn: ({ signal }) =>
      api.get(`/projects/${projectId ?? ''}/tasks`, {
        schema: taskListSchema,
        query: { ...toQueryParams(bucketFilters), view: 'flat', pageSize: 100 },
        signal,
      }),
    enabled: Boolean(projectId),
  });
}

/**
 * The cache key of one backlog bucket.
 *
 * Exported because `useRankTask` has to write to exactly the entry
 * {@link useBacklogBucket} reads, and re-deriving the `sprintId: 'none'`
 * convention at the mutation site is precisely the kind of drift that produces
 * an optimistic update nothing renders.
 */
export function backlogBucketKey(
  projectId: string,
  sprintId: SprintBucket,
  filters?: TaskFilterInput,
) {
  return qk.tasks.backlog(projectId, { ...filters, sprintId: sprintId ?? 'none' });
}

/** `GET /tasks/:taskId` — the full detail payload behind the task sheet. */
export function useTask(taskId: string | null | undefined): UseQueryResult<Task> {
  return useQuery({
    queryKey: qk.task.detail(taskId ?? ''),
    queryFn: ({ signal }) => api.get(`/tasks/${taskId ?? ''}`, { schema: taskSchema, signal }),
    enabled: Boolean(taskId),
  });
}

/**
 * `GET /projects/:projectId/tasks/by-key/:taskKey` — the deep-link lookup.
 *
 * The task sheet is addressed by the key a human reads (`/t/FLOW-142`), so the
 * sheet has to resolve one before it can fetch anything else. Nested under the
 * project because a bare key is only unique once the project is known.
 *
 * ═══ THE RESULT IS MIRRORED INTO `qk.task.detail(id)` ══════════════════════
 *
 * The two keys address the same row by two different names — one by human key,
 * one by uuid — and every mutation that touches a single task writes the uuid
 * one, because that is the id it has. Without the mirror the sheet reached from
 * a deep link renders from an entry nothing else in the app ever updates: the
 * watch toggle, the comment count, a remote edit's invalidation all land on
 * `qk.task.detail` and are simply not seen. (The docstring here CLAIMED this
 * mirror for three waves before WP5.6 actually wrote it, which is how the
 * watch-toggle bug survived review.)
 *
 * Mirrored in an effect rather than inside `queryFn`, so it also runs for a
 * cached read, and ordered by `updatedAt` so a mirror cannot walk the detail
 * entry backwards over a newer write that landed while this query was in
 * flight.
 */
export function useTaskByKey(
  projectId: string | null | undefined,
  taskKey: string | null | undefined,
): UseQueryResult<Task> {
  const queryClient = useQueryClient();
  const normalized = taskKey?.toUpperCase() ?? '';

  const query = useQuery({
    queryKey: qk.tasks.byKey(projectId ?? '', normalized),
    queryFn: ({ signal }) =>
      api.get(`/projects/${projectId ?? ''}/tasks/by-key/${normalized}`, {
        schema: taskSchema,
        signal,
      }),
    enabled: Boolean(projectId) && normalized.length > 0,
  });

  // The query cache hands back the same object until it refetches, so this runs
  // once per genuine change rather than once per render.
  const task = query.data;
  useEffect(() => {
    if (!task) return;
    queryClient.setQueryData<Task>(qk.task.detail(task.id), (current) =>
      isStaleTaskWrite(current, task) ? current : task,
    );
  }, [task, queryClient]);

  return query;
}
