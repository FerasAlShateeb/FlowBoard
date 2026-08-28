import { useCallback } from 'react';
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import {
  moveTaskResponseSchema,
  taskSchema,
  type BoardResponse,
  type CreateTaskInput,
  type Label,
  type MoveTaskResponse,
  type PatchTaskInput,
  type ProjectMember,
  type Task,
  type TaskSummary,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import {
  applyBacklogRank,
  applyBoardMove,
  applyPatchToSummary,
  applyPatchToTask,
  findBoardTask,
  isBoardResponse,
  isTaskDetail,
  isTaskSummaryList,
  planBacklogRank,
  planBoardMove,
  removeFromBucket,
  removeTaskEverywhere,
  taskToSummary,
  upsertBoardTask,
  writeTaskEverywhere,
  type BacklogRankIntent,
  type BacklogRankPlan,
  type BoardMoveIntent,
  type BoardMovePlan,
  type ResolvedTaskPatch,
  type SprintBucket,
} from '@/lib/board-cache';
import { backlogBucketKey, type TaskFilterInput } from '@/hooks/useTasks';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * Task WRITES — and the optimistic Kanban drag, which is the most intricate
 * piece of client state in FlowBoard.
 *
 * ═══ THE OPTIMISTIC MOVE, END TO END ═══════════════════════════════════════
 *
 * 1. **drop** — the board hands {@link useMoveTask}'s `move()` an INTENT: which
 *    card, which column it left, which column it landed in, and at what index.
 *    Nothing about ranks: the board does not do fractional-index arithmetic.
 * 2. **plan** — `planBoardMove` reads the current board cache, lifts the card
 *    out of the target column, and works out the destination NEIGHBOURS plus a
 *    `clientRank` from `@flowboard/shared`'s `rankBetween`. That plan is the
 *    mutation's variables, so `onMutate` and the request see the same numbers.
 * 3. **onMutate** — cancel in-flight board fetches (a refetch landing mid-drag
 *    would overwrite the splice with pre-drag data), snapshot, splice, return
 *    the snapshot as context.
 * 4. **onError** — put the snapshot back, raise a localized toast.
 * 5. **onSuccess** — write the AUTHORITATIVE task the server returned. When it
 *    reports `rebalanced`, the transaction rewrote every rank in that column,
 *    so every other cached rank is now stale and the board is invalidated
 *    instead of spliced.
 *
 * WHY THE PLAN IS COMPUTED BEFORE `mutate()` RATHER THAN INSIDE `onMutate`.
 * TanStack runs `onMutate` first and then `mutationFn`, but `mutationFn` only
 * receives the VARIABLES — never the context `onMutate` returned. Computing the
 * neighbours in `onMutate` would leave the request with no way to see them, and
 * recomputing them inside `mutationFn` would read a cache `onMutate` has
 * already spliced, producing neighbours that describe the post-move board.
 * Resolving once, up front, is what keeps the request and the optimistic
 * painting describing the same move.
 *
 * The cache arithmetic itself lives in `lib/board-cache.ts` as pure functions,
 * which is what makes it testable without React or a transport.
 */

// The cross-cache writers (`writeTaskEverywhere`, `removeTaskEverywhere`) used
// to live here. They now live in `lib/board-cache.ts`, next to the socket
// path's copy of the same job — see the note in that file's header about why
// one answer to "where does a task live in the cache?" is the right number.

// ───────────────────────────────────────────────────────────────────────────
// Create / patch / delete
// ───────────────────────────────────────────────────────────────────────────

/**
 * `POST /projects/:projectId/tasks`.
 *
 * NOT optimistic, on purpose. A new task has no id, no key and no rank until
 * the server allocates them (`PROJ-123` comes from an atomic counter), so an
 * optimistic card would be a placeholder that has to be reconciled by id a
 * moment later — and if the create failed, the user would have watched a card
 * they named appear and then vanish. A brief pending state is the honest
 * rendering of "this does not exist yet".
 */
export function useCreateTask(projectId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      api.post<Task>(`/projects/${projectId}/tasks`, input, { schema: taskSchema }),
    onSuccess: (task) => {
      queryClient.setQueryData(qk.task.detail(task.id), task);
      void queryClient.invalidateQueries({ queryKey: qk.tasks.all(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.sprints.all(projectId) });
    },
    onError,
  });
}

/** The PATCH variables: the target task plus the fields to change. */
export type PatchTaskVariables = PatchTaskInput & { taskId: string };

/** Snapshots of every cache entry the optimistic patch touched. */
interface PatchContext {
  /** `[key, dataBeforeThePatch]` for every task-collection entry. */
  entries: Array<[readonly unknown[], unknown]>;
  detailKey: readonly unknown[];
  detail: Task | undefined;
}

/**
 * Turns a wire PATCH body into the shapes a cache holds.
 *
 * The two foreign keys are the whole job. `assigneeId` has to become the
 * `UserSummary` a card draws an avatar from, and `labelIds` the `Label[]` the
 * task sheet draws chips from — both are read out of the caches the editors
 * that produced the patch were already rendering from (the member picker cannot
 * offer a user the member list has not loaded).
 *
 * WHEN A LOOKUP MISSES, THE FIELD IS SIMPLY OMITTED rather than guessed. The
 * optimistic paint then leaves that one field showing its previous value for the
 * length of the request, and `onSuccess` writes the truth — which is strictly
 * better than painting a blank avatar the user did not ask for.
 */
function resolveTaskPatch(
  queryClient: QueryClient,
  projectId: string,
  patch: PatchTaskInput,
): ResolvedTaskPatch {
  const { assigneeId, labelIds, ...direct } = patch;
  const resolved: ResolvedTaskPatch = { ...direct };

  if (assigneeId !== undefined) {
    if (assigneeId === null) {
      resolved.assignee = null;
    } else {
      const members = queryClient.getQueryData<ProjectMember[]>(qk.project.members(projectId));
      const match = members?.find((member) => member.user.id === assigneeId);
      if (match) resolved.assignee = match.user;
    }
  }

  if (labelIds !== undefined) {
    // The summary shape stores ids, so it can always be painted.
    resolved.labelIds = labelIds;

    const known = queryClient.getQueryData<Label[]>(qk.project.labels(projectId));
    if (known) {
      const expanded = labelIds
        .map((id) => known.find((label) => label.id === id))
        .filter((label): label is Label => label !== undefined);
      // All-or-nothing: a partially expanded list would DELETE chips from the
      // sheet for ids this client has not seen yet.
      if (expanded.length === labelIds.length) resolved.labels = expanded;
    }
  }

  return resolved;
}

/**
 * Paints a resolved patch onto ONE task-collection cache entry, whatever shape
 * it holds.
 *
 * The `qk.tasks.all(projectId)` prefix covers three different shapes — the board
 * record, the flat/backlog arrays, and the by-key detail entry — and the caller
 * cannot know which one a given key holds. Entries that do not already contain
 * the task are returned untouched: inserting it would put a card into a filtered
 * board it was excluded from, and only the server knows whether the patch
 * changed that.
 */
function patchTaskCacheEntry(current: unknown, taskId: string, patch: ResolvedTaskPatch): unknown {
  if (isBoardResponse(current)) {
    const existing = findBoardTask(current, taskId);
    if (!existing) return current;
    // Through `upsertBoardTask` rather than a splice in place: a status change
    // has to move the card to another column, and the upsert is the function
    // that already knows how.
    return upsertBoardTask(current, applyPatchToSummary(existing, patch));
  }

  if (isTaskSummaryList(current)) {
    if (!current.some((entry) => entry.id === taskId)) return current;
    return current.map((entry) =>
      entry.id === taskId ? applyPatchToSummary(entry, patch) : entry,
    );
  }

  // The by-key lookup (`qk.tasks.byKey`) caches a full detail payload under the
  // same project prefix, so the sheet reached from a deep link stays in step.
  if (isTaskDetail(current) && current.id === taskId) {
    return applyPatchToTask(current, patch);
  }

  return current;
}

/**
 * `PATCH /tasks/:taskId` — every field except the ranks — OPTIMISTICALLY.
 *
 * Rank changes go through {@link useMoveTask} / {@link useRankTask}, which
 * compute the authoritative key from neighbour ids inside the same transaction.
 * A client that could PATCH a rank directly would be able to write a key it
 * derived from a stale board.
 *
 * WHY OPTIMISM IS REQUIRED HERE AND NOT ON CREATE. Three views drive this
 * mutation from a DIRECT MANIPULATION: a table cell edited in place, a calendar
 * chip dragged onto another day, a Gantt bar dragged along its axis. In all
 * three the user has already moved the thing with their hand, and a round trip
 * spent showing the OLD value reads as the gesture having missed — the bar snaps
 * back, then jumps forward when the response lands. A create has no such prior
 * gesture (see {@link useCreateTask}), so it stays honest about not existing yet.
 *
 * Exposed as OPTIONS as well as a hook for the same reason
 * {@link moveTaskMutationOptions} is: the four callbacks are the part that can
 * be wrong, and this package's test environment has no DOM to render a provider
 * into.
 */
export function patchTaskMutationOptions({
  queryClient,
  projectId,
  onError,
}: {
  queryClient: QueryClient;
  projectId: string;
  onError: (error: unknown) => void;
}): UseMutationOptions<Task, unknown, PatchTaskVariables, PatchContext> {
  return {
    mutationFn: ({ taskId, ...patch }) =>
      api.patch<Task>(`/tasks/${taskId}`, patch, { schema: taskSchema }),

    onMutate: async ({ taskId, ...patch }) => {
      // A list refetch resolving mid-edit would repaint the pre-patch value —
      // the same "snap back then jump forward" the optimism exists to prevent.
      await queryClient.cancelQueries({ queryKey: qk.tasks.all(projectId) });
      await queryClient.cancelQueries({ queryKey: qk.task.all(taskId) });

      const entries = queryClient.getQueriesData({ queryKey: qk.tasks.all(projectId) });
      const detailKey = qk.task.detail(taskId);
      const detail = queryClient.getQueryData<Task>(detailKey);

      const resolved = resolveTaskPatch(queryClient, projectId, patch);

      queryClient.setQueriesData({ queryKey: qk.tasks.all(projectId) }, (current: unknown) =>
        patchTaskCacheEntry(current, taskId, resolved),
      );

      if (detail) queryClient.setQueryData(detailKey, applyPatchToTask(detail, resolved));

      return { entries, detailKey, detail };
    },

    onError: (error, _variables, context) => {
      // Restore EXACTLY what each key held. Every function above returns fresh
      // objects, so the snapshot still points at the pre-patch values.
      if (context) {
        for (const [key, data] of context.entries) queryClient.setQueryData(key, data);
        queryClient.setQueryData(context.detailKey, context.detail);
      }
      onError(error);
    },

    onSuccess: (task) => {
      writeTaskEverywhere(queryClient, projectId, task);
    },
  };
}

export function usePatchTask(projectId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation(patchTaskMutationOptions({ queryClient, projectId, onError }));
}

/**
 * `DELETE /tasks/:taskId` — soft delete, cascading to subtasks.
 *
 * Optimistic, unlike create: the card is already on screen, the user asked for
 * it to go, and leaving it there while a request flies reads as the click
 * having missed. The rollback re-fetches rather than restoring a snapshot —
 * a delete may have cascaded to subtasks the snapshot cannot describe.
 */
export function useDeleteTask(projectId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (taskId: string) => api.del<void>(`/tasks/${taskId}`),
    onMutate: (taskId) => {
      removeTaskEverywhere(queryClient, projectId, taskId);
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: qk.tasks.all(projectId) });
      onError(error);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.tasks.all(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.sprints.all(projectId) });
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// The board move
// ───────────────────────────────────────────────────────────────────────────

/** What `onMutate` hands `onError` so a failed drag can be undone exactly. */
interface MoveContext {
  snapshot: BoardResponse | undefined;
}

/**
 * The move mutation, as OPTIONS rather than as a hook.
 *
 * WHY THE SPLIT. The interesting part of `useMoveTask` is not the React
 * plumbing, it is the four callbacks and what they do to the cache: splice on
 * mutate, restore on error, write the authoritative row on success, refetch on
 * `rebalanced`. This package's test environment is DOM-free by design
 * (`vitest.config.ts`: `environment: 'node'`, no jsdom installed), so a test
 * that had to render a provider to reach those callbacks could not run at all.
 *
 * As a plain factory they are reachable from a `MutationObserver` with a real
 * `QueryClient` and a mocked `@/lib/api` — which runs the genuine lifecycle,
 * not a re-implementation of it, and lets the test assert cache CONTENTS.
 * `useMoveTask` below is then a thin wrapper: a query client, a toast, and the
 * `move()` convenience that resolves a drag intent into a plan.
 */
export function moveTaskMutationOptions({
  queryClient,
  projectId,
  filters,
  onError,
}: {
  queryClient: QueryClient;
  projectId: string;
  filters?: TaskFilterInput;
  /** Usually the localized toast; a no-op in tests. */
  onError: (error: unknown) => void;
}): UseMutationOptions<MoveTaskResponse, unknown, BoardMovePlan, MoveContext> {
  const boardKey = qk.tasks.board(projectId, filters);

  return {
    mutationFn: (plan) =>
      api.post<MoveTaskResponse>(
        `/tasks/${plan.taskId}/move`,
        {
          statusId: plan.toStatusId,
          beforeTaskId: plan.beforeTaskId,
          afterTaskId: plan.afterTaskId,
          clientRank: plan.clientRank,
        },
        { schema: moveTaskResponseSchema },
      ),

    onMutate: async (plan) => {
      // A board refetch that resolves mid-drag would overwrite the splice with
      // pre-move data — the card would visibly snap back and then jump forward
      // when the response landed. Cancelling first is what prevents that.
      await queryClient.cancelQueries({ queryKey: boardKey });

      const snapshot = queryClient.getQueryData<BoardResponse>(boardKey);
      if (snapshot) queryClient.setQueryData(boardKey, applyBoardMove(snapshot, plan));

      return { snapshot };
    },

    onError: (error, _plan, context) => {
      // Restore EXACTLY what was there. `undefined` is a legitimate snapshot —
      // the board had not loaded — and writing it back is still correct.
      if (context) queryClient.setQueryData(boardKey, context.snapshot);
      onError(error);
    },

    onSuccess: ({ task, rebalanced }) => {
      queryClient.setQueryData(qk.task.detail(task.id), task);

      if (rebalanced) {
        // The move transaction rewrote every rank in the column, so every OTHER
        // cached rank is stale — a splice would order the board by numbers that
        // no longer exist. Only a refetch is correct here.
        void queryClient.invalidateQueries({ queryKey: qk.tasks.all(projectId) });
        return;
      }

      const summary = taskToSummary(task);
      queryClient.setQueryData<BoardResponse>(boardKey, (current) =>
        current ? upsertBoardTask(current, summary) : current,
      );
      // The backlog orders the same rows by a different column, and a board
      // move can change a task's status without touching its backlog rank —
      // so those entries are marked stale rather than rewritten.
      void queryClient.invalidateQueries({
        queryKey: qk.tasks.all(projectId),
        refetchType: 'none',
      });
    },
  };
}

/**
 * The optimistic Kanban drop.
 *
 * WHAT WP3.1 PASSES IN — `filters` MUST be the same object (structurally) that
 * `useBoard()` was given, because the board's cache key is derived from it. Get
 * that wrong and the splice lands on a key nothing is rendering: the card snaps
 * back for a beat and then jumps into place when the response arrives.
 *
 * @example
 *   const filters = useBoardFilters();           // whatever the filter bar holds
 *   const board = useBoard(projectId, filters);
 *   const { move, isPending } = useMoveTask({ projectId, filters });
 *
 *   function onDragEnd(event) {
 *     move({ taskId, fromStatusId, toStatusId, toIndex });
 *   }
 */
export function useMoveTask({
  projectId,
  filters,
}: {
  projectId: string;
  filters?: TaskFilterInput;
}) {
  const queryClient = useQueryClient();
  const onErrorToast = useApiErrorToast();
  const boardKey = qk.tasks.board(projectId, filters);
  /**
   * The board key as a PRIMITIVE, for the dependency list below.
   *
   * `boardKey` is a fresh array every render but its contents are stable for a
   * given projectId + filters. Extracted to a variable rather than joined
   * inline in the dep array so the linter can check it statically — an
   * expression inside `[...]` is opaque to the rule and to the next reader.
   */
  const boardKeySignature = boardKey.join('|');

  const mutation = useMutation(
    moveTaskMutationOptions({ queryClient, projectId, filters, onError: onErrorToast }),
  );

  const { mutate } = mutation;

  /**
   * Resolve a drag intent into a plan and fire it.
   *
   * Returns the plan (or `null` when the board no longer holds the task — a
   * stale drag), so a caller that wants to log or animate has it; ignoring the
   * return value is the normal case.
   */
  const move = useCallback(
    (intent: BoardMoveIntent): BoardMovePlan | null => {
      const board = queryClient.getQueryData<BoardResponse>(boardKey);
      if (!board) return null;

      const plan = planBoardMove(board, intent);
      if (!plan) return null;

      mutate(plan);
      return plan;
    },
    // `boardKey` is an array rebuilt every render; `boardKeySignature` is its value. Depending
    // on the array itself would rebuild `move` on every render and defeat every `memo` on the
    // board.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
    [queryClient, mutate, boardKeySignature],
  );

  return { ...mutation, move };
}

// ───────────────────────────────────────────────────────────────────────────
// The backlog reorder
// ───────────────────────────────────────────────────────────────────────────

/** Snapshots of the two buckets a backlog drag touches. */
interface RankContext {
  fromKey: readonly unknown[];
  toKey: readonly unknown[];
  fromSnapshot: TaskSummary[] | undefined;
  toSnapshot: TaskSummary[] | undefined;
}

/**
 * The backlog reorder as OPTIONS — same reasoning as
 * {@link moveTaskMutationOptions}: the callbacks are the part worth testing,
 * and they have to be reachable without a DOM.
 */
export function rankTaskMutationOptions({
  queryClient,
  projectId,
  filters,
  onError,
}: {
  queryClient: QueryClient;
  projectId: string;
  filters?: TaskFilterInput;
  onError: (error: unknown) => void;
}): UseMutationOptions<MoveTaskResponse, unknown, BacklogRankPlan, RankContext> {
  const keyFor = (sprintId: SprintBucket) => backlogBucketKey(projectId, sprintId, filters);

  return {
    mutationFn: (plan) =>
      api.post<MoveTaskResponse>(
        `/tasks/${plan.taskId}/rank`,
        {
          sprintId: plan.toSprintId,
          beforeTaskId: plan.beforeTaskId,
          afterTaskId: plan.afterTaskId,
        },
        { schema: moveTaskResponseSchema },
      ),

    onMutate: async (plan) => {
      const fromKey = keyFor(plan.fromSprintId);
      const toKey = keyFor(plan.toSprintId);
      const sameBucket = plan.fromSprintId === plan.toSprintId;

      await queryClient.cancelQueries({ queryKey: fromKey });
      if (!sameBucket) await queryClient.cancelQueries({ queryKey: toKey });

      const fromSnapshot = queryClient.getQueryData<TaskSummary[]>(fromKey);
      const toSnapshot = sameBucket ? fromSnapshot : queryClient.getQueryData<TaskSummary[]>(toKey);

      const moved = (fromSnapshot ?? toSnapshot ?? []).find((task) => task.id === plan.taskId);

      if (moved) {
        if (sameBucket) {
          queryClient.setQueryData(toKey, applyBacklogRank(toSnapshot ?? [], moved, plan));
        } else {
          queryClient.setQueryData(fromKey, removeFromBucket(fromSnapshot ?? [], plan.taskId));
          queryClient.setQueryData(toKey, applyBacklogRank(toSnapshot ?? [], moved, plan));
        }
      }

      return { fromKey, toKey, fromSnapshot, toSnapshot };
    },

    onError: (error, _plan, context) => {
      if (context) {
        queryClient.setQueryData(context.fromKey, context.fromSnapshot);
        queryClient.setQueryData(context.toKey, context.toSnapshot);
      }
      onError(error);
    },

    onSuccess: ({ task, rebalanced }, plan) => {
      queryClient.setQueryData(qk.task.detail(task.id), task);

      if (rebalanced) {
        void queryClient.invalidateQueries({ queryKey: qk.tasks.all(projectId) });
      } else {
        const summary = taskToSummary(task);
        queryClient.setQueryData<TaskSummary[]>(keyFor(plan.toSprintId), (current) =>
          current?.map((entry) => (entry.id === task.id ? summary : entry)),
        );
        // The board orders the same rows by `board_rank`; moving a task into a
        // sprint does not change that, but its sprint badge did change.
        void queryClient.invalidateQueries({
          queryKey: qk.tasks.all(projectId),
          refetchType: 'none',
        });
      }

      // Sprint scope changed, so committed/remaining point totals did too.
      void queryClient.invalidateQueries({ queryKey: qk.sprints.all(projectId) });
    },
  };
}

/**
 * The backlog / sprint-planning reorder — `useMoveTask`'s twin on
 * `backlog_rank`.
 *
 * THE SHAPE DIFFERENCE that drives everything else: the board is ONE cache
 * entry holding every column, so a move splices one entry. The backlog is one
 * entry PER BUCKET (see `useBacklogBucket`), so a move between two sprints
 * splices TWO — and both have to be snapshotted, because a failure has to undo
 * both halves or the card exists twice.
 *
 * @example
 *   const { rank } = useRankTask({ projectId, filters });
 *   rank({ taskId, fromSprintId: null, toSprintId: sprint.id, toIndex: 3 });
 */
export function useRankTask({
  projectId,
  filters,
}: {
  projectId: string;
  filters?: TaskFilterInput;
}) {
  const queryClient = useQueryClient();
  const onErrorToast = useApiErrorToast();

  // The object identity churns every render; its CONTENTS are what the key
  // depends on, so the dep list is a stable serialisation of them.
  const filtersSignature = JSON.stringify(filters ?? {});
  const keyFor = useCallback(
    (sprintId: SprintBucket) => backlogBucketKey(projectId, sprintId, filters),
    // `filtersSignature` is the serialized VALUE of `filters`, whose object identity churns
    // every render. Same key, stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
    [projectId, filtersSignature],
  );

  const mutation = useMutation(
    rankTaskMutationOptions({ queryClient, projectId, filters, onError: onErrorToast }),
  );

  const { mutate } = mutation;

  const rank = useCallback(
    (intent: BacklogRankIntent): BacklogRankPlan | null => {
      const target = queryClient.getQueryData<TaskSummary[]>(keyFor(intent.toSprintId)) ?? [];
      const plan = planBacklogRank(target, intent);
      mutate(plan);
      return plan;
    },
    [queryClient, mutate, keyFor],
  );

  return { ...mutation, rank };
}

// ───────────────────────────────────────────────────────────────────────────
// Pre-checks, re-exported
// ───────────────────────────────────────────────────────────────────────────

/**
 * The drop pre-checks, re-exported from `lib/board-cache` so the board can
 * import its drag rules from the same module it imports the drag mutation from.
 *
 * They exist to make a forbidden drop LOOK forbidden while the card is still in
 * the air — the server re-checks every move, so skipping them costs a toast,
 * not correctness.
 */
export {
  checkDrop,
  isTransitionAllowed,
  wipStateOf,
  taskToSummary,
  type DropCheck,
  type DropBlockReason,
  type WipState,
  type BoardMoveIntent,
  type BoardMovePlan,
  type BacklogRankIntent,
  type BacklogRankPlan,
} from '@/lib/board-cache';
