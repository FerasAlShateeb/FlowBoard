import {
  useMutation,
  useQueryClient,
  type Query,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { watcherResponseSchema, type Task, type WatcherResponse } from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useAuthStore } from '@/stores/useAuthStore';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * Watching a task — the "notify me about this" toggle.
 *
 * THERE IS NO WATCHER LIST QUERY, and that is not an omission. `taskSchema`
 * already carries `watcherIds`, and the only two questions the UI ever asks are
 * "am I watching?" (a lookup in that array) and "how many people are?" (its
 * length). A separate endpoint would be a second round trip for data the sheet
 * already has.
 *
 * Both writes are OPTIMISTIC against the task detail: this is a toggle, and a
 * toggle that waits for a round trip before flipping feels broken.
 *
 * ═══ ONE TASK, TWO CACHE ENTRIES ═══════════════════════════════════════════
 *
 * A task's detail payload lives under `qk.task.detail(id)` when the sheet was
 * opened from a board card, and ALSO under `qk.tasks.byKey(projectId, 'FB-142')`
 * when it was opened from a deep link — the same row addressed by uuid and by
 * human key. Until WP5.6 these mutations only wrote the uuid entry, so on the
 * deep-linked route (which is every `/t/FB-142` URL, i.e. the one people share)
 * the button did nothing visible at all: the write went to an entry that page
 * was not rendering.
 *
 * The durable half of the fix is in `useTaskByKey`, which now mirrors its
 * result into `qk.task.detail(id)` so the two agree. The half here is the
 * matching read: every write below addresses the entries BY SHAPE — "whatever
 * is holding this task's detail payload" — rather than by one hard-coded key,
 * so neither address can be forgotten again and a third one would be covered
 * for free.
 *
 * BOTH ANSWER WITH {@link watcherResponseSchema} — `{taskId, userId, watching,
 * isMuted}` — and both parse it, even though neither caller reads the result.
 * Parsing is not decoration: it is the project's "zod at every boundary, both
 * ends" rule, and it is what turns a server that starts answering something
 * else into a failed mutation with a toast rather than a toggle that silently
 * stops matching the database.
 */

/**
 * Is this cached value the full detail payload of `taskId`?
 *
 * Keyed on `watcherIds` rather than on the looser `isTaskDetail` guard in
 * `lib/board-cache`: this predicate runs against EVERY cache entry in the
 * client, including ones holding a bare `TaskSummary`, and a summary carries
 * both `id` and `boardRank` too. `watcherIds` exists only on the detail shape,
 * which is also the only shape these mutations can patch.
 */
function isTaskDetailOf(value: unknown, taskId: string): value is Task {
  return (
    typeof value === 'object' &&
    value !== null &&
    'watcherIds' in value &&
    (value as Task).id === taskId
  );
}

/** Query filters selecting every cache entry that holds this task's detail. */
function detailEntriesOf(taskId: string) {
  return { predicate: (query: Query) => isTaskDetailOf(query.state.data, taskId) };
}

/** What `onMutate` hands `onError` so a failed toggle can be undone exactly. */
type WatcherSnapshot = [QueryKey, Task | undefined][];

/** Rewrites `watcherIds` on every cached copy of the task, and snapshots them. */
function patchWatchers(
  queryClient: QueryClient,
  taskId: string,
  update: (ids: string[]) => string[],
): WatcherSnapshot {
  const filters = detailEntriesOf(taskId);
  const snapshot = queryClient.getQueriesData<Task>(filters);

  queryClient.setQueriesData<Task>(filters, (current) =>
    current ? { ...current, watcherIds: update(current.watcherIds) } : current,
  );

  return snapshot;
}

/** Puts every snapshotted entry back, byte for byte. */
function restoreWatchers(queryClient: QueryClient, snapshot: WatcherSnapshot | undefined): void {
  for (const [key, data] of snapshot ?? []) queryClient.setQueryData(key, data);
}

/**
 * Re-read the task from the server on every entry that holds it.
 *
 * `isMuted` and the authoritative watcher list are the server's to decide (a
 * second device may have muted the same task), so the optimistic flip is
 * reconciled rather than trusted. The uuid key is named explicitly ALONGSIDE
 * the shape predicate because it may not be populated yet — a sheet whose
 * detail fetch is still in flight has no data for the predicate to match, and
 * that is exactly the entry a stale response would land in.
 */
function invalidateWatchers(queryClient: QueryClient, taskId: string): void {
  void queryClient.invalidateQueries({ queryKey: qk.task.detail(taskId) });
  void queryClient.invalidateQueries(detailEntriesOf(taskId));
}

/**
 * `PUT /tasks/:taskId/watchers/me` — start watching (optionally muted).
 *
 * `isMuted` is the "I want it in my watch list but not in my bell" state, which
 * is why it is a flag on the membership rather than a second endpoint.
 */
export function useWatchTask(taskId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();
  const myId = useAuthStore((state) => state.user?.id ?? null);

  return useMutation({
    mutationFn: ({ isMuted = false }: { isMuted?: boolean } = {}) =>
      api.put<WatcherResponse>(
        `/tasks/${taskId}/watchers/me`,
        { isMuted },
        {
          schema: watcherResponseSchema,
        },
      ),

    onMutate: async () => {
      if (!myId) return { snapshot: undefined };
      await queryClient.cancelQueries({ queryKey: qk.task.detail(taskId) });
      await queryClient.cancelQueries(detailEntriesOf(taskId));
      const snapshot = patchWatchers(queryClient, taskId, (ids) =>
        ids.includes(myId) ? ids : [...ids, myId],
      );
      return { snapshot };
    },

    onError: (error, _variables, context) => {
      restoreWatchers(queryClient, context?.snapshot);
      onError(error);
    },

    onSuccess: () => {
      invalidateWatchers(queryClient, taskId);
    },
  });
}

/** `DELETE /tasks/:taskId/watchers/me` — stop watching. */
export function useUnwatchTask(taskId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();
  const myId = useAuthStore((state) => state.user?.id ?? null);

  return useMutation({
    mutationFn: () =>
      api.del<WatcherResponse>(`/tasks/${taskId}/watchers/me`, {
        schema: watcherResponseSchema,
      }),

    onMutate: async () => {
      if (!myId) return { snapshot: undefined };
      await queryClient.cancelQueries({ queryKey: qk.task.detail(taskId) });
      await queryClient.cancelQueries(detailEntriesOf(taskId));
      const snapshot = patchWatchers(queryClient, taskId, (ids) => ids.filter((id) => id !== myId));
      return { snapshot };
    },

    onError: (error, _variables, context) => {
      restoreWatchers(queryClient, context?.snapshot);
      onError(error);
    },

    onSuccess: () => {
      invalidateWatchers(queryClient, taskId);
    },
  });
}

/** Am I watching this task? Reads `watcherIds` — no request. */
export function useIsWatching(watcherIds: readonly string[] | undefined): boolean {
  const myId = useAuthStore((state) => state.user?.id ?? null);
  if (!myId || !watcherIds) return false;
  return watcherIds.includes(myId);
}
