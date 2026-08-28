import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';
import {
  markAllReadResponseSchema,
  notificationSchema,
  unreadCountSchema,
  type MarkAllReadResponse,
  type Notification,
  type PaginationMeta,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * The notification centre's data layer — one bell badge, two lists, two writes.
 *
 * ═══ THE CACHE SHAPE, AND WHY IT MATTERS TO THE REALTIME LAYER ════════════
 *
 * Everything here lives under the `qk.notifications` prefix:
 *
 *   ['notifications', 'unread-count']                     ← the badge (a number)
 *   ['notifications', 'list', unreadOnly, page, …]        ← the bell + the page
 *
 * WP4.1's socket bridge invalidates `qk.notifications.all()` when a
 * `notification:new` arrives, and prefix matching takes both with it. That is
 * the ENTIRE coordination contract between the two packages: no shared module,
 * no exported handler — just one prefix from `lib/query-keys.ts` that both
 * sides spell through the factory. Anything here that invented its own key
 * would silently stop updating live.
 *
 * ═══ WHY THE BADGE IS ITS OWN QUERY ═══════════════════════════════════════
 *
 * It is asked for on every authed screen and the list is opened rarely, so the
 * count has its own tiny endpoint (backed by a partial index) and its own cache
 * entry with a 30-second refetch. Deriving it from the list instead would mean
 * fetching twenty rows to render one number — and would be WRONG the moment the
 * list is filtered or paginated.
 */

const notificationListSchema = z.array(notificationSchema);

/** One page as the list consumes it: the rows plus the meta they arrived with. */
export interface NotificationPage {
  items: Notification[];
  meta: PaginationMeta;
}

/** Rows per request. Comfortably more than the bell shows, one screen for the page. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** How many rows the bell's dropdown renders. The rest live on `/notifications`. */
export const BELL_ROW_COUNT = 8;

/** How often the badge re-asks the server when nothing pushes it. */
export const UNREAD_POLL_MS = 30_000;

// ───────────────────────────────────────────────────────────────────────────
// Deep links
// ───────────────────────────────────────────────────────────────────────────

/**
 * Where a notification row navigates to.
 *
 * Built ENTIRELY from the row's own denormalized payload — no lookup, no
 * project cache, nothing that can be missing at click time. A notification is a
 * snapshot, and its click target has to work exactly as long as the sentence
 * does.
 *
 * The board is the landing view because it is the one every project has and the
 * task sheet layers over any of the five; a sprint notification carries no task
 * and falls back to the notification centre, where the sentence itself is the
 * whole story.
 *
 * Pure, and therefore unit-tested rather than argued about.
 */
export function notificationHref(notification: Notification): string {
  const { orgSlug, projectKey, taskKey } = notification.payload;
  if (
    orgSlug !== undefined &&
    orgSlug !== '' &&
    projectKey !== undefined &&
    projectKey !== '' &&
    taskKey !== undefined &&
    taskKey !== ''
  ) {
    return `/o/${orgSlug}/p/${projectKey}/board/t/${taskKey}`;
  }
  return '/notifications';
}

// ───────────────────────────────────────────────────────────────────────────
// Reads
// ───────────────────────────────────────────────────────────────────────────

/**
 * `GET /notifications` — paged, newest first, optionally unread-only.
 *
 * `useInfiniteQuery` over an offset-paginated endpoint, with a "Load more"
 * button rather than scroll-triggered loading: the bell's dropdown and the
 * page's day groups are both places where an accidental fetch on scroll would
 * fire while the user was reading.
 */
export function useNotifications(
  unreadOnly = false,
  pageSize: number = NOTIFICATIONS_PAGE_SIZE,
): UseInfiniteQueryResult<InfiniteData<NotificationPage, number>, Error> {
  return useInfiniteQuery({
    queryKey: [...qk.notifications.list(unreadOnly), 'paged', pageSize] as const,

    queryFn: async ({ pageParam, signal }) => {
      const result = await api.paged('/notifications', {
        schema: notificationListSchema,
        query: { page: pageParam, pageSize, unread: unreadOnly ? 'true' : undefined },
        signal,
      });
      return {
        items: result.data,
        // A list endpoint always sends `meta`, but a client that CRASHES
        // without it is a client that turns a server hiccup into a blank page.
        meta: result.meta ?? {
          page: pageParam,
          pageSize,
          total: result.data.length,
          totalPages: 1,
        },
      } satisfies NotificationPage;
    },

    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,
  });
}

/** `GET /notifications/unread-count` — the badge. Polled, and pushed by WP4.1. */
export function useUnreadCount(): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: qk.notifications.unreadCount(),
    queryFn: async ({ signal }) => {
      const result = await api.get('/notifications/unread-count', {
        schema: unreadCountSchema,
        signal,
      });
      return result.count;
    },
    refetchInterval: UNREAD_POLL_MS,
    // The badge is ambient: refetching it while the tab is in the background
    // buys nothing, and the socket push covers the interesting case anyway.
    refetchIntervalInBackground: false,
  });
}

/** Flattens loaded pages into one newest-first list. A concat, never a sort. */
export function flattenNotifications(
  data: InfiniteData<NotificationPage, number> | undefined,
): Notification[] {
  return (data?.pages ?? []).flatMap((page) => page.items);
}

/** How many rows the filtered stream holds, from the first page's meta. */
export function notificationsTotal(
  data: InfiniteData<NotificationPage, number> | undefined,
): number {
  return data?.pages[0]?.meta.total ?? 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Optimistic writes
// ───────────────────────────────────────────────────────────────────────────

/** Everything under the notifications prefix, for an exact rollback. */
type NotificationsSnapshot = [QueryKey, unknown][];

function snapshotNotifications(client: QueryClient): NotificationsSnapshot {
  return client.getQueriesData({ queryKey: qk.notifications.all() });
}

function restoreNotifications(client: QueryClient, snapshot: NotificationsSnapshot): void {
  for (const [key, data] of snapshot) client.setQueryData(key, data);
}

/**
 * Stamp `readAt` on the named rows in every cached page.
 *
 * `ids === null` means "all of them" (mark-all-read).
 *
 * A stamped row is NOT removed from the unread-filtered list, even though it no
 * longer belongs there. Rows vanishing from under the pointer is how a
 * double-click lands on the wrong notification; the next refetch drops it, by
 * which time the user has moved on.
 */
function stampRead(
  data: InfiniteData<NotificationPage, number> | undefined,
  ids: ReadonlySet<string> | null,
  readAt: string,
): InfiniteData<NotificationPage, number> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.readAt === null && (ids === null || ids.has(item.id)) ? { ...item, readAt } : item,
      ),
    })),
  };
}

/** Applies the optimistic stamp to every cached list, unread-only and not. */
function stampEveryList(
  client: QueryClient,
  ids: ReadonlySet<string> | null,
  readAt: string,
): void {
  for (const unreadOnly of [true, false]) {
    client.setQueriesData<InfiniteData<NotificationPage, number>>(
      { queryKey: qk.notifications.list(unreadOnly) },
      (data) => stampRead(data, ids, readAt),
    );
  }
}

/**
 * `POST /notifications/:id/read` — the row click.
 *
 * OPTIMISTIC, because the row is under the pointer and the badge is the thing
 * the user is watching: a bell that stays bold for a round trip after you have
 * read the notification reads as broken. The count is decremented locally and
 * then REPLACED by the server's number in `onSuccess` — the response carries
 * the authoritative row, and `onSettled` invalidates the prefix so the count
 * and both lists reconcile even if two tabs raced.
 */
export function useMarkRead() {
  const queryClient = useQueryClient();
  const onErrorToast = useApiErrorToast();

  return useMutation({
    mutationFn: (notificationId: string) =>
      api.post<Notification>(`/notifications/${notificationId}/read`, undefined, {
        schema: notificationSchema,
      }),

    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey: qk.notifications.all() });
      const snapshot = snapshotNotifications(queryClient);

      queryClient.setQueryData<number>(qk.notifications.unreadCount(), (count) =>
        Math.max(0, (count ?? 0) - 1),
      );
      stampEveryList(queryClient, new Set([notificationId]), new Date().toISOString());

      return { snapshot };
    },

    onError: (error, _notificationId, context) => {
      if (context) restoreNotifications(queryClient, context.snapshot);
      onErrorToast(error);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications.all() });
    },
  });
}

/**
 * `POST /notifications/read-all`. Same optimism, applied to everything at once.
 *
 * The response is PARSED, like every other one in the app: `marked` is what the
 * caller's confirmation toast says ("12 notifications marked read"), and an
 * unparsed `api.post<{ marked: number }>` is a type assertion about a payload
 * nobody checked — the exact shape of lie that turns a renamed server field
 * into `undefined` in a sentence instead of an error at the boundary.
 */
export function useMarkAllRead() {
  const queryClient = useQueryClient();
  const onErrorToast = useApiErrorToast();

  return useMutation({
    mutationFn: () =>
      api.post<MarkAllReadResponse>('/notifications/read-all', undefined, {
        schema: markAllReadResponseSchema,
      }),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: qk.notifications.all() });
      const snapshot = snapshotNotifications(queryClient);

      queryClient.setQueryData<number>(qk.notifications.unreadCount(), 0);
      stampEveryList(queryClient, null, new Date().toISOString());

      return { snapshot };
    },

    onError: (error, _variables, context) => {
      if (context) restoreNotifications(queryClient, context.snapshot);
      onErrorToast(error);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications.all() });
    },
  });
}

/**
 * Refetch the badge and every list.
 *
 * The one function anything OUTSIDE this module should call to say "the server
 * knows something we do not" — the window-focus listener in
 * `NotificationsBridge`, and WP4.1's socket bridge if it prefers a call to a
 * hand-built key.
 */
export function invalidateNotifications(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: qk.notifications.all() });
}
