import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import { activitySchema, type Activity, type PaginationMeta } from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

/**
 * One task's audit history — `GET /tasks/:taskId/activity`.
 *
 * ── Why this hook exists at all ─────────────────────────────────────────────
 *
 * The PROJECT feed (`/projects/:projectId/activity`, WP2.2) answers a different
 * question: it is the whole project's stream, including the project-scoped rows
 * whose `task_id` is null. The task sheet needs one task's rows, guarded from
 * `:taskId` so a deleted task 404s rather than showing the history of something
 * that no longer exists. Hence a second endpoint, and this hook.
 *
 * ── Paged, with a "Load more" — not infinite scroll ─────────────────────────
 *
 * The endpoint is offset-paginated (`?page&pageSize`) like every other list in
 * the API, and reports the standard `meta { page, pageSize, total, totalPages }`.
 * `useInfiniteQuery` is the mechanism, but the AFFORDANCE is a button: an
 * activity tab inside a scrollable sheet is a poor place for scroll-triggered
 * loading, because the container that scrolls is the panel, not the page, and a
 * user reading a comment thread above would keep triggering fetches below.
 *
 * `getNextPageParam` reads `totalPages`, so the button disappears exactly when
 * the stream is exhausted rather than after one empty request.
 *
 * ── A note on offsets over an append-only stream ────────────────────────────
 *
 * Activity is append-only, so rows inserted WHILE the feed is open shift every
 * offset by one and page 2 can repeat a row page 1 already showed. The endpoint
 * also accepts `?beforeId`, a keyset cursor that cannot do that, and switching
 * to it is a one-line change here. Offsets are kept for now because they are the
 * project-wide convention, the drift only appears when someone edits the task
 * you are reading, and the cost is one duplicated row rather than a wrong one.
 */

const activityListSchema = z.array(activitySchema);

/** One page as the feed consumes it: the rows plus the meta they came with. */
export interface ActivityPage {
  items: Activity[];
  meta: PaginationMeta;
}

/**
 * 20, not the API's default 25: the activity tab is a column ~600px wide inside
 * a sheet, and twenty one-line sentences already overflow it — a larger page
 * would only mean more rows nobody scrolled to.
 */
export const ACTIVITY_PAGE_SIZE = 20;

export function useActivity(
  taskId: string | null | undefined,
  pageSize: number = ACTIVITY_PAGE_SIZE,
): UseInfiniteQueryResult<{ pages: ActivityPage[]; pageParams: number[] }, unknown> {
  return useInfiniteQuery({
    // `pageSize` is part of the key: two callers asking for different page sizes
    // are asking for different pages, and sharing one entry would interleave
    // them.
    queryKey: [...qk.task.activity(taskId ?? ''), 'paged', pageSize] as const,

    queryFn: async ({ pageParam, signal }) => {
      const result = await api.paged(`/tasks/${taskId ?? ''}/activity`, {
        schema: activityListSchema,
        query: { page: pageParam, pageSize },
        signal,
      });

      return {
        items: result.data,
        // The envelope always carries `meta` for a list endpoint, but the client
        // must not CRASH if it ever does not — a synthesised single page is the
        // honest degradation.
        meta: result.meta ?? {
          page: pageParam,
          pageSize,
          total: result.data.length,
          totalPages: 1,
        },
      } satisfies ActivityPage;
    },

    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,

    enabled: Boolean(taskId),
  });
}

/**
 * Flattens the loaded pages into one newest-first list.
 *
 * The server already orders each page newest-first and the pages arrive in
 * order, so this is a concat — NOT a sort. Re-sorting here would be a second
 * ordering authority, and the one thing worse than a stale feed is two
 * components disagreeing about what "newest" means.
 */
export function flattenActivity(pages: readonly ActivityPage[] | undefined): Activity[] {
  return (pages ?? []).flatMap((page) => page.items);
}

/** How many rows the stream holds in total, from the first page's meta. */
export function activityTotal(pages: readonly ActivityPage[] | undefined): number {
  return pages?.[0]?.meta.total ?? 0;
}
