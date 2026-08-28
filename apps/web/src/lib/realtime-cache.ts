import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type {
  BoardResponse,
  Notification,
  CommentCreatedPayload,
  CommentDeletedPayload,
  CommentUpdatedPayload,
  NotificationNewPayload,
  ServerToClientEvents,
  SprintChangedPayload,
  TaskCreatedPayload,
  TaskDeletedPayload,
  TaskMovedPayload,
  TaskSummary,
  TaskUpdatedPayload,
  WorkflowChangedPayload,
} from '@flowboard/shared';

import {
  findBoardTask,
  isBoardResponse,
  isStaleTaskWrite,
  isTaskSummaryList,
  removeTaskEverywhere,
  upsertBoardTask,
  writeTaskSummaryEverywhere,
} from '@/lib/board-cache';
import { qk } from '@/lib/query-keys';
// TYPE-ONLY, and deliberately pointed AT the hook rather than re-declared here.
// `NotificationPage` is the shape `useNotifications` stores; the splice below
// has to agree with it exactly, and a local copy of the interface would agree
// only until somebody changed one of them.
import type { NotificationPage } from '@/hooks/useNotifications';

/**
 * SOMEONE ELSE'S CHANGE, APPLIED TO THIS TAB'S CACHES.
 *
 * Every function here takes a `QueryClient` and one parsed socket payload and
 * returns nothing — they are the whole realtime side of the app's state, and
 * they are deliberately plain functions rather than hooks so the entire mapping
 * can be tested against a seeded `QueryClient` with no React, no transport and
 * no timers.
 *
 * ═══ THE RULE: PATCH WHAT YOU CAN NAME, INVALIDATE WHAT YOU CANNOT ═════════
 *
 * A `task:moved` names one card, one column and one rank — enough to splice the
 * board cache directly, so the other tab's card slides into place with no
 * request at all. A `sprint:changed` names a lifecycle transition whose effect
 * on every backlog bucket, the sprint list and the velocity chart is not
 * derivable from the payload, so it invalidates and lets those queries refetch
 * the truth.
 *
 * The failure mode this file exists to avoid is the lazy one: invalidating
 * `['project', id]` on every event. On a busy board that is a refetch of the
 * board, the backlog, six reports and the activity feed several times a second,
 * for changes that moved one card. {@link scheduleProjectRefresh} is the
 * deliberate, DEBOUNCED escape hatch for the cases that genuinely need it, and
 * it is the only place a whole-project invalidation is allowed to come from.
 *
 * ═══ WHY NO ECHO CHECK LIVES HERE ══════════════════════════════════════════
 *
 * Nothing below asks "did I cause this?". It cannot arrive: the server already
 * excluded this tab's socket id (`X-Socket-Id` → `originSocketId` →
 * `.except()`). An event reaching these functions is by construction somebody
 * else's, which is exactly why they can write caches unconditionally.
 */

// The shape guards (`isBoardResponse`, `isTaskSummaryList`) and the
// "write this task everywhere" writers live in `lib/board-cache.ts` — the same
// functions the LOCAL mutation path uses, so a remote update and a local one
// leave the cache in exactly the same state. That is not a tidiness point: the
// two used to be separate implementations, and only one of them patched the
// by-key detail entry.

// ───────────────────────────────────────────────────────────────────────────
// The debounced fallback
// ───────────────────────────────────────────────────────────────────────────

/** Milliseconds a project-wide refresh waits for the burst to finish. */
export const PROJECT_REFRESH_DEBOUNCE_MS = 300;

const pendingRefresh = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Invalidate everything under `['project', projectId]`, at most once per
 * {@link PROJECT_REFRESH_DEBOUNCE_MS}.
 *
 * The debounce is the entire point. The events that need this arrive in
 * BURSTS — a sprint completing re-ranks every incomplete task, a bulk edit
 * fires one `task:updated` per row, a reconnect replays whatever was missed —
 * and each one alone would trigger a full project refetch. Collapsing the burst
 * into one invalidation turns fifty refetches into one, at the cost of up to
 * 300ms of staleness on a change this tab did not make.
 *
 * Keyed by project so two open projects cannot cancel each other's refresh.
 */
export function scheduleProjectRefresh(queryClient: QueryClient, projectId: string): void {
  const existing = pendingRefresh.get(projectId);
  if (existing !== undefined) clearTimeout(existing);

  pendingRefresh.set(
    projectId,
    setTimeout(() => {
      pendingRefresh.delete(projectId);
      void queryClient.invalidateQueries({ queryKey: qk.project.all(projectId) });
    }, PROJECT_REFRESH_DEBOUNCE_MS),
  );
}

/** Cancel any pending debounced refresh — unmount, and test teardown. */
export function cancelProjectRefresh(projectId?: string): void {
  if (projectId === undefined) {
    for (const timer of pendingRefresh.values()) clearTimeout(timer);
    pendingRefresh.clear();
    return;
  }
  const existing = pendingRefresh.get(projectId);
  if (existing !== undefined) {
    clearTimeout(existing);
    pendingRefresh.delete(projectId);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Task writes
// ───────────────────────────────────────────────────────────────────────────

/** `task:created` — a new card someone else made. */
export function applyTaskCreated(queryClient: QueryClient, payload: TaskCreatedPayload): void {
  writeTaskSummaryEverywhere(queryClient, payload.projectId, payload.task);
  // A new task can join a sprint bucket the backlog is rendering, and the
  // bucket queries are filtered lists that the write above deliberately did not
  // insert into.
  void queryClient.invalidateQueries({
    queryKey: [...qk.tasks.all(payload.projectId), 'backlog'],
    refetchType: 'none',
  });
}

/**
 * The `changedFields` value that means "the dependency edges moved".
 *
 * Published by `addDependency` / `removeDependency` on the API side; the
 * spelling is the contract between them and the invalidation below.
 */
const DEPENDENCIES_FIELD = 'dependencies';

/**
 * Did this update touch the dependency graph?
 *
 * ABSENT MEANS UNKNOWN, NOT "NO". `changedFields` is optional on the wire, and
 * a publisher that cannot enumerate its change omits it. Treating that as "no
 * dependency change" would silently stop updating the Roadmap's arrows for any
 * future publisher that forgets the field; treating it as "maybe" costs one
 * invalidation of a query that is usually not even mounted. The conservative
 * reading is the correct one.
 */
function touchedDependencies(changedFields: readonly string[] | undefined): boolean {
  return changedFields === undefined || changedFields.includes(DEPENDENCIES_FIELD);
}

/**
 * `task:updated` — replace the card everywhere it is drawn.
 *
 * The detail entry is INVALIDATED rather than written: the payload is a
 * summary, and overwriting a cached `Task` with it would lose the description,
 * the watchers and the dependency lists the sheet renders. Invalidation
 * refetches only if a sheet is actually open on that task.
 *
 * The collection write itself is ORDERED BY `updatedAt` inside
 * `writeTaskSummaryEverywhere` — this broadcast and the mutation response that
 * caused it describe the same edit and can arrive either way round, and the
 * older of the two must not repaint the card. See `lib/board-cache`'s
 * `isStaleTaskWrite`.
 *
 * ── The dependency graph, and why it needs `changedFields` ──────────────────
 * `qk.project.dependencies(projectId)` — the Roadmap's arrow layer — lives
 * OUTSIDE the `qk.tasks` prefix, so nothing the writer above does reaches it.
 * Dependency edges arrive here as an ordinary `task:updated`, because the API
 * collapses four different mutations into that one event, and the new summary
 * cannot show the difference: an edge change alters no field a summary carries.
 *
 * This used to invalidate the whole edge set on EVERY update — correct, and
 * far coarser than necessary, since a remote title edit would mark the Roadmap
 * stale. WP4.7 added `changedFields` to `taskUpdatedPayloadSchema`, so the two
 * dependency caches are now touched only when they actually changed.
 *
 * The project-wide entry keeps `refetchType: 'none'` even so: a Roadmap open in
 * another tab reconciles on its next focus rather than refetching the entire
 * graph the instant somebody else links two tasks. The single task's own edges
 * refetch actively — one small query, and only while that sheet is mounted.
 */
export function applyTaskUpdated(queryClient: QueryClient, payload: TaskUpdatedPayload): void {
  writeTaskSummaryEverywhere(queryClient, payload.projectId, payload.task);
  void queryClient.invalidateQueries({ queryKey: qk.task.detail(payload.task.id) });

  if (!touchedDependencies(payload.changedFields)) return;

  void queryClient.invalidateQueries({ queryKey: qk.task.dependencies(payload.task.id) });
  void queryClient.invalidateQueries({
    queryKey: qk.project.dependencies(payload.projectId),
    refetchType: 'none',
  });
}

/**
 * `task:moved` — the board drop, as the smallest patch that reproduces it.
 *
 * `rebalanced: true` means the move rewrote every rank in that column, so every
 * OTHER cached rank is now stale and a one-card splice would produce a board
 * ordered by a mix of old and new keys. That case invalidates instead — the one
 * place in this file where a real refetch is the correct answer rather than the
 * lazy one.
 *
 * ── ORDERED BY `updatedAt`, LIKE EVERY OTHER TASK WRITE ─────────────────────
 * {@link applyTaskUpdated} and both HTTP writers order their writes by the
 * server's `updatedAt` ({@link isStaleTaskWrite}), so an out-of-order arrival
 * cannot repaint a card with an older version. This event used to be the one
 * exception — `taskMovedPayloadSchema` carried a destination and a rank and no
 * version stamp at all, so two moves of the same card delivered out of order
 * left the board showing the first one until something else refetched it.
 *
 * WP5.6 added `updatedAt` to the payload (stamped inside the move transaction),
 * so the splice below now consults the same guard as everything else and there
 * is no longer an unordered task write in the product.
 *
 * The comparison is PER CACHE ENTRY, not once up front: `setQueriesData` visits
 * every board query for the project and they are fetched independently, so one
 * can hold a newer row than another. Checking inside the updater lets a stale
 * broadcast be dropped by the entry that has already moved past it while still
 * being applied to the entries that have not.
 *
 * The `rebalanced` branch above is deliberately NOT guarded: an invalidation
 * cannot paint a stale value — it discards what is cached and refetches, which
 * is the correct response to a late arrival as much as to a timely one.
 */
export function applyTaskMoved(queryClient: QueryClient, payload: TaskMovedPayload): void {
  if (payload.rebalanced) {
    void queryClient.invalidateQueries({ queryKey: qk.tasks.all(payload.projectId) });
    return;
  }

  queryClient.setQueriesData({ queryKey: qk.tasks.all(payload.projectId) }, (current: unknown) => {
    if (!isBoardResponse(current)) return current;
    const existing = findBoardTask(current, payload.taskId);
    // A board that never held this card has nothing to splice: the card is
    // filtered out of this view, and inserting it would defeat the filter.
    if (!existing) return current;
    // A move that landed before what this entry already holds must not drag the
    // card back to where it used to be. Equal stamps still apply — see
    // `isStaleTaskWrite` for why "strictly older" is the right test.
    if (isStaleTaskWrite(existing, payload)) return current;
    return upsertBoardTask(current, {
      ...existing,
      statusId: payload.statusId,
      boardRank: payload.boardRank,
      updatedAt: payload.updatedAt,
    });
  });

  // The status may have changed, which the open task sheet renders.
  void queryClient.invalidateQueries({ queryKey: qk.task.detail(payload.taskId) });
}

/**
 * `task:deleted` — a soft delete elsewhere.
 *
 * Literally the same function the local delete path calls, which is the point:
 * both routes leave the cache in exactly the same state, and the "refetching a
 * deleted task is a guaranteed 404" reasoning lives in one place.
 */
export function applyTaskDeleted(queryClient: QueryClient, payload: TaskDeletedPayload): void {
  removeTaskEverywhere(queryClient, payload.projectId, payload.taskId);
}

// ───────────────────────────────────────────────────────────────────────────
// Comments
// ───────────────────────────────────────────────────────────────────────────

/**
 * Nudge a task's `commentCount` in every collection cache that holds it.
 *
 * The card's comment badge is the only part of a comment event a board can
 * render, and it is derivable from the event, so it is patched rather than
 * refetched. Clamped at zero: a `comment:deleted` for a card whose count this
 * tab never loaded must not produce `-1`.
 */
function bumpCommentCount(queryClient: QueryClient, projectId: string, taskId: string, by: number) {
  queryClient.setQueriesData({ queryKey: qk.tasks.all(projectId) }, (current: unknown) => {
    const patch = (task: TaskSummary): TaskSummary =>
      task.id === taskId ? { ...task, commentCount: Math.max(0, task.commentCount + by) } : task;

    if (isBoardResponse(current)) {
      const columns: Record<string, TaskSummary[]> = {};
      for (const [statusId, tasks] of Object.entries(current.columns)) {
        columns[statusId] = tasks.map(patch);
      }
      return { columns } satisfies BoardResponse;
    }
    if (isTaskSummaryList(current)) {
      if (!current.some((entry) => entry.id === taskId)) return current;
      return current.map(patch);
    }
    return current;
  });
}

/**
 * The thread ITSELF is invalidated rather than spliced, even though the payload
 * carries the whole comment: the thread is paginated, and inserting a row into
 * page 1 of a cursor the user may have scrolled past produces a thread whose
 * order and totals disagree with the server's. A comment thread is also the one
 * surface where a refetch is cheap and the user is actively looking.
 */
export function applyCommentCreated(
  queryClient: QueryClient,
  payload: CommentCreatedPayload,
): void {
  void queryClient.invalidateQueries({ queryKey: qk.task.comments(payload.taskId) });
  void queryClient.invalidateQueries({ queryKey: qk.task.detail(payload.taskId) });
  bumpCommentCount(queryClient, payload.projectId, payload.taskId, 1);
}

/** An edit changes no count — only the thread. */
export function applyCommentUpdated(
  queryClient: QueryClient,
  payload: CommentUpdatedPayload,
): void {
  void queryClient.invalidateQueries({ queryKey: qk.task.comments(payload.taskId) });
}

export function applyCommentDeleted(
  queryClient: QueryClient,
  payload: CommentDeletedPayload,
): void {
  void queryClient.invalidateQueries({ queryKey: qk.task.comments(payload.taskId) });
  void queryClient.invalidateQueries({ queryKey: qk.task.detail(payload.taskId) });
  bumpCommentCount(queryClient, payload.projectId, payload.taskId, -1);
}

// ───────────────────────────────────────────────────────────────────────────
// Sprints and workflow
// ───────────────────────────────────────────────────────────────────────────

/**
 * `sprint:changed` — one event for the whole lifecycle, because every listener
 * does the same thing regardless of which change it was.
 *
 * Three prefixes, and no attempt to be clever: starting or completing a sprint
 * moves tasks between buckets, stamps points, and rewrites velocity and
 * burndown — effects the payload cannot describe. Reports are only invalidated
 * for the two actions that actually change them, because those six queries are
 * the most expensive reads in the product.
 */
export function applySprintChanged(queryClient: QueryClient, payload: SprintChangedPayload): void {
  void queryClient.invalidateQueries({ queryKey: qk.sprints.all(payload.projectId) });
  void queryClient.invalidateQueries({
    queryKey: [...qk.tasks.all(payload.projectId), 'backlog'],
  });

  if (payload.action === 'started' || payload.action === 'completed') {
    void queryClient.invalidateQueries({ queryKey: qk.reports.all(payload.projectId) });
  }
}

/**
 * `workflow:changed` — the payload carries the ENTIRE new workflow, so the
 * statuses and transitions are WRITTEN rather than refetched: an open board
 * re-renders its columns and its forbidden-drop styling immediately, with no
 * request and no flash of the old column set.
 *
 * `qk.project.detail` still has to be invalidated — the project detail payload
 * embeds its own copy of the workflow, and leaving it stale would let a
 * remount read back the columns the socket just replaced.
 */
export function applyWorkflowChanged(
  queryClient: QueryClient,
  payload: WorkflowChangedPayload,
): void {
  queryClient.setQueryData(qk.project.statuses(payload.projectId), payload.statuses);
  queryClient.setQueryData(qk.project.transitions(payload.projectId), payload.transitions);
  void queryClient.invalidateQueries({ queryKey: qk.project.detail(payload.projectId) });
}

// ───────────────────────────────────────────────────────────────────────────
// Notifications
// ───────────────────────────────────────────────────────────────────────────

/**
 * `notification:new` — the bell.
 *
 * ═══ THE BADGE IS WRITTEN, NOT REFETCHED ══════════════════════════════════
 *
 * The payload ships the authoritative unread total precisely so the badge never
 * needs a follow-up request, and the badge is the thing the user is looking at.
 * A round trip between "someone mentioned you" and the number changing is the
 * one latency in this feature anybody notices.
 *
 * ═══ THE LISTS ARE PREPENDED WHERE THEY EXIST, INVALIDATED WHERE THEY DO NOT ═
 *
 * `useNotifications` is an infinite query keyed per `unreadOnly` and per page
 * size, so several list caches can be live at once — the bell's eight-row
 * dropdown and the notification centre's page, on the same screen. Each is
 * `InfiniteData<NotificationPage>`, newest first, so a new row belongs at the
 * head of page 1 and nowhere else.
 *
 * Only caches that ALREADY EXIST are written. A list that has never been opened
 * has no entry, and seeding one here would hand the next `useInfiniteQuery` a
 * single-row page with fabricated `meta` — a "Load more" button computing its
 * next page from a total that is one. `setQueriesData` skips absent entries by
 * construction, and the invalidation below is what covers them.
 *
 * ═══ AND THE PREFIX IS STILL INVALIDATED ══════════════════════════════════
 *
 * With `refetchType: 'none'`: every entry under `['notifications']` is MARKED
 * stale so it reconciles on its next focus, without firing a request now. That
 * is the safety net for what the splice cannot get right — a row that belongs
 * on a filtered page this tab has not loaded, `meta.total` counters going one
 * stale per push, two tabs racing — while keeping the common case free.
 *
 * De-duplicated by id: a socket reconnect can replay a push the list already
 * holds, and a doubled row in a notification centre is a support ticket.
 */
export function applyNotificationNew(
  queryClient: QueryClient,
  payload: NotificationNewPayload,
): void {
  queryClient.setQueryData(qk.notifications.unreadCount(), payload.unreadCount);

  for (const unreadOnly of [true, false]) {
    queryClient.setQueriesData<InfiniteData<NotificationPage, number>>(
      { queryKey: qk.notifications.list(unreadOnly) },
      (data) => prependNotification(data, payload.notification),
    );
  }

  void queryClient.invalidateQueries({
    queryKey: qk.notifications.all(),
    refetchType: 'none',
  });
}

/**
 * Put a new notification at the head of page 1 of an infinite list.
 *
 * Returns the SAME reference when there is nothing to do — no cached data, or
 * the row is already there — so an untouched cache does not re-render every
 * subscriber. `meta` is carried through untouched: `total` is the server's
 * count and this splice has no standing to increment it, which is exactly why
 * the caller also marks the entry stale.
 */
function prependNotification(
  data: InfiniteData<NotificationPage, number> | undefined,
  notification: Notification,
): InfiniteData<NotificationPage, number> | undefined {
  if (!data) return data;
  if (data.pages.some((page) => page.items.some((item) => item.id === notification.id)))
    return data;

  const [first, ...rest] = data.pages;
  if (!first) return data;

  return {
    ...data,
    pages: [{ ...first, items: [notification, ...first.items] }, ...rest],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The handler table
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every server event, bound to its cache write.
 *
 * Typed as the shared `ServerToClientEvents` map itself, so a listener that is
 * added to the contract and forgotten here is a COMPILE ERROR rather than an
 * event that silently updates nothing.
 */
export type RealtimeHandlers = {
  [TEvent in keyof ServerToClientEvents]: ServerToClientEvents[TEvent];
};

/**
 * Build the handler table for one query client.
 *
 * `presence:state` is deliberately absent from the cache layer — presence is
 * ephemeral UI state and belongs to `usePresenceStore`, not to the server-state
 * cache. `useRealtime` wires that one to the store directly.
 */
export function createRealtimeCacheHandlers(
  queryClient: QueryClient,
): Omit<RealtimeHandlers, 'presence:state'> {
  return {
    'task:created': (payload) => {
      applyTaskCreated(queryClient, payload);
    },
    'task:updated': (payload) => {
      applyTaskUpdated(queryClient, payload);
    },
    'task:moved': (payload) => {
      applyTaskMoved(queryClient, payload);
    },
    'task:deleted': (payload) => {
      applyTaskDeleted(queryClient, payload);
    },
    'comment:created': (payload) => {
      applyCommentCreated(queryClient, payload);
    },
    'comment:updated': (payload) => {
      applyCommentUpdated(queryClient, payload);
    },
    'comment:deleted': (payload) => {
      applyCommentDeleted(queryClient, payload);
    },
    'sprint:changed': (payload) => {
      applySprintChanged(queryClient, payload);
    },
    'workflow:changed': (payload) => {
      applyWorkflowChanged(queryClient, payload);
    },
    'notification:new': (payload) => {
      applyNotificationNew(queryClient, payload);
    },
  };
}
