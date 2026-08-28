import type { QueryClient } from '@tanstack/react-query';
import {
  rankBetween,
  type BoardResponse,
  type Label,
  type Status,
  type Task,
  type TaskPriority,
  type TaskSummary,
  type TaskType,
  type Transition,
  type UserSummary,
} from '@flowboard/shared';

import { qk } from '@/lib/query-keys';

/**
 * The board's cache algebra — every rule the optimistic Kanban drag depends on,
 * as PURE FUNCTIONS over plain data — plus, in the final section, the two
 * CACHE WRITERS built on them.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE HOOK. `useMoveTask` is three
 * TanStack callbacks (`onMutate` / `onError` / `onSuccess`) whose entire job is
 * to hand the right object to `setQueryData`. Deriving that object is the part
 * that can actually be WRONG — the neighbour arithmetic, the rank between two
 * keys, the splice that must not lose the card if the source and target column
 * are the same. Putting it here makes it testable without React, a query
 * client, or a mocked transport, and it is what `board-cache.test.ts` asserts.
 *
 * THE ONE EXCEPTION IS THE LAST SECTION, and it is deliberate. "Write this task
 * into every cache that could be showing it" was implemented TWICE — once for
 * the local mutation path (`useTaskMutations`) and once for the socket path
 * (`lib/realtime-cache`) — and the two copies had already drifted: only one of
 * them patched the `qk.tasks.byKey` detail entry a deep link renders from. Two
 * implementations of "where does a task live in the cache?" is one more than
 * the number of times that question has a right answer, so they are unified
 * below and both callers import them. Those functions take a `QueryClient`;
 * everything above them still does not.
 *
 * TWO ORDERINGS, TWO CACHES. A task carries `boardRank` (its position in a
 * status column) and `backlogRank` (its position in a sprint bucket) and they
 * move independently: dragging a card across the board must not disturb the
 * backlog's order, so the two live under different query keys and get different
 * helpers here ({@link planBoardMove} / {@link planBacklogRank}).
 *
 * IMMUTABILITY IS NOT DECORATION. TanStack Query decides "did this change?" by
 * reference. Mutating a cached array in place produces a correct cache that
 * never re-renders, which is the single most confusing bug this layer can have,
 * so every function here returns fresh objects for the parts it touched and
 * reuses the parts it did not.
 */

// ───────────────────────────────────────────────────────────────────────────
// Column helpers
// ───────────────────────────────────────────────────────────────────────────

/** The tasks of one column, or `[]` — a column may legitimately be absent. */
export function columnOf(board: BoardResponse, statusId: string): readonly TaskSummary[] {
  return board.columns[statusId] ?? [];
}

/** Every card on the board, in no particular order. */
export function allBoardTasks(board: BoardResponse): TaskSummary[] {
  return Object.values(board.columns).flat();
}

/** Finds a card anywhere on the board. `null` when the board does not hold it. */
export function findBoardTask(board: BoardResponse, taskId: string): TaskSummary | null {
  for (const column of Object.values(board.columns)) {
    const found = column.find((task) => task.id === taskId);
    if (found) return found;
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Rank planning
// ───────────────────────────────────────────────────────────────────────────

/**
 * The neighbours of an insertion point, and the rank that sits between them.
 *
 * This is the whole contract the server needs (`moveTaskInputSchema`): the
 * client names its DESTINATION NEIGHBOURS rather than a final position, and the
 * server recomputes the authoritative key from the ids inside the move
 * transaction. `clientRank` is the optimistic key the dragging client already
 * painted; the server may honour it when the neighbours still agree, which is
 * what turns the common case into a no-op re-render instead of a snap.
 */
export interface RankPlan {
  /** Place the moved task immediately BEFORE this one. */
  beforeTaskId?: string;
  /** Place the moved task immediately AFTER this one. */
  afterTaskId?: string;
  /** The optimistic fractional index the client paints with. */
  clientRank: string;
}

/**
 * Computes the {@link RankPlan} for dropping a card at `index` of `list`.
 *
 * `list` MUST already have the dragged task removed — otherwise a same-column
 * move would compute its neighbours against its own old position and produce a
 * rank equal to one of them, which `rankBetween` rejects. Both callers below do
 * that removal first; a third one must too.
 *
 * `index` is clamped, so `Number.MAX_SAFE_INTEGER` means "the end" and a
 * negative index means "the start" without either caller doing the arithmetic.
 *
 * @param rankOf which of the two rank columns this list is ordered by
 */
export function planRank(
  list: readonly TaskSummary[],
  index: number,
  rankOf: (task: TaskSummary) => string,
): RankPlan {
  const clamped = Math.min(Math.max(index, 0), list.length);
  const previous = clamped > 0 ? list[clamped - 1] : undefined;
  const next = clamped < list.length ? list[clamped] : undefined;

  const clientRank = rankBetween(previous ? rankOf(previous) : null, next ? rankOf(next) : null);

  // Exactly ONE neighbour is sent — the schema refuses both — and `next` is
  // preferred because "before X" survives a concurrent append after X, whereas
  // "after X" would place the card behind whatever arrived in the meantime.
  if (next) return { beforeTaskId: next.id, clientRank };
  if (previous) return { afterTaskId: previous.id, clientRank };
  // Neither neighbour: an empty destination. The server reads that as "the end
  // of the column", which for an empty column is also its start.
  return { clientRank };
}

const boardRankOf = (task: TaskSummary): string => task.boardRank;
const backlogRankOf = (task: TaskSummary): string => task.backlogRank;

// ───────────────────────────────────────────────────────────────────────────
// The board move
// ───────────────────────────────────────────────────────────────────────────

/** What a drag hands the hook: a card, where it came from, where it landed. */
export interface BoardMoveIntent {
  taskId: string;
  fromStatusId: string;
  toStatusId: string;
  /**
   * Destination index within the TARGET column, counted after the dragged card
   * has been lifted out of its source. That is exactly the index dnd-kit's
   * sortable strategy reports, so no caller has to compensate.
   */
  toIndex: number;
}

/** A resolved move: the intent plus the neighbours and rank it works out to. */
export type BoardMovePlan = BoardMoveIntent & RankPlan;

/**
 * Turns a drag intent into the plan that is sent to the server AND applied to
 * the cache. Returns `null` when the board does not hold the task — a stale
 * drag against an invalidated board, which must be a no-op rather than a throw
 * inside a drag handler.
 */
export function planBoardMove(board: BoardResponse, intent: BoardMoveIntent): BoardMovePlan | null {
  const task = findBoardTask(board, intent.taskId);
  if (!task) return null;

  // Lift the card out of the target column BEFORE reading neighbours. For a
  // cross-column move this is a no-op; for a same-column reorder it is the
  // difference between a valid rank and `rankBetween(x, x)`, which throws.
  const target = columnOf(board, intent.toStatusId).filter((entry) => entry.id !== intent.taskId);

  return { ...intent, ...planRank(target, intent.toIndex, boardRankOf) };
}

/**
 * Applies a plan to a board snapshot — the optimistic splice.
 *
 * The moved card is removed from EVERY column rather than only from
 * `fromStatusId`: a board that a socket event patched a moment ago may hold it
 * somewhere else entirely, and a stale `fromStatusId` would otherwise leave a
 * duplicate on screen. Removing by id is idempotent and costs one pass.
 */
export function applyBoardMove(board: BoardResponse, plan: BoardMovePlan): BoardResponse {
  const moved = findBoardTask(board, plan.taskId);
  if (!moved) return board;

  const columns: Record<string, TaskSummary[]> = {};
  for (const [statusId, tasks] of Object.entries(board.columns)) {
    columns[statusId] = tasks.filter((task) => task.id !== plan.taskId);
  }

  // The destination column may not exist in the snapshot yet (an empty column
  // the API omitted), so it is created rather than assumed.
  const destination = columns[plan.toStatusId] ?? [];
  const updated: TaskSummary = {
    ...moved,
    statusId: plan.toStatusId,
    boardRank: plan.clientRank,
  };

  columns[plan.toStatusId] = insertByRank(destination, updated, boardRankOf);

  return { columns };
}

/**
 * Inserts `task` into an already-ordered list at the position its rank implies.
 *
 * Ordering by the rank rather than splicing at the index is what keeps the
 * optimistic cache in agreement with what the next fetch will return: the
 * server orders by the rank column, so anything else would re-sort under the
 * user on the following refetch.
 */
function insertByRank(
  list: readonly TaskSummary[],
  task: TaskSummary,
  rankOf: (task: TaskSummary) => string,
): TaskSummary[] {
  const rank = rankOf(task);
  const at = list.findIndex((entry) => rankOf(entry) > rank);
  const next = [...list];
  next.splice(at === -1 ? next.length : at, 0, task);
  return next;
}

/**
 * Writes an authoritative card back into the board after the server answered.
 *
 * Used by `onSuccess` for a move and by the socket layer (WP4.1) for someone
 * else's. It removes any stale copy first, so a card whose status changed lands
 * in exactly one column.
 */
export function upsertBoardTask(board: BoardResponse, task: TaskSummary): BoardResponse {
  const columns: Record<string, TaskSummary[]> = {};
  for (const [statusId, tasks] of Object.entries(board.columns)) {
    columns[statusId] = tasks.filter((entry) => entry.id !== task.id);
  }
  columns[task.statusId] = insertByRank(columns[task.statusId] ?? [], task, boardRankOf);
  return { columns };
}

/** Drops a card from every column — the optimistic half of a delete. */
export function removeBoardTask(board: BoardResponse, taskId: string): BoardResponse {
  const columns: Record<string, TaskSummary[]> = {};
  for (const [statusId, tasks] of Object.entries(board.columns)) {
    columns[statusId] = tasks.filter((task) => task.id !== taskId);
  }
  return { columns };
}

// ───────────────────────────────────────────────────────────────────────────
// The backlog reorder
// ───────────────────────────────────────────────────────────────────────────

/**
 * The backlog's bucket identity: a sprint id, or `null` for the backlog proper.
 * The same value the API takes as `sprintId` on `POST /tasks/:id/rank`.
 */
export type SprintBucket = string | null;

/** What a backlog drag hands the hook. */
export interface BacklogRankIntent {
  taskId: string;
  fromSprintId: SprintBucket;
  toSprintId: SprintBucket;
  /** Destination index within the target bucket, dragged card already lifted. */
  toIndex: number;
}

/** A resolved backlog reorder. */
export type BacklogRankPlan = BacklogRankIntent & RankPlan;

/**
 * Turns a backlog drag into a plan.
 *
 * Unlike the board — one cache entry holding every column — the backlog is one
 * cache entry PER BUCKET, so the caller passes the target bucket's list
 * directly and the source bucket is only needed for the removal.
 */
export function planBacklogRank(
  targetBucket: readonly TaskSummary[],
  intent: BacklogRankIntent,
): BacklogRankPlan {
  const withoutMoved = targetBucket.filter((task) => task.id !== intent.taskId);
  return { ...intent, ...planRank(withoutMoved, intent.toIndex, backlogRankOf) };
}

/** Removes a task from a backlog bucket, preserving order. */
export function removeFromBucket(bucket: readonly TaskSummary[], taskId: string): TaskSummary[] {
  return bucket.filter((task) => task.id !== taskId);
}

/** Inserts the moved task into its destination bucket at its new rank. */
export function applyBacklogRank(
  bucket: readonly TaskSummary[],
  task: TaskSummary,
  plan: BacklogRankPlan,
): TaskSummary[] {
  const updated: TaskSummary = {
    ...task,
    sprintId: plan.toSprintId,
    backlogRank: plan.clientRank,
  };
  return insertByRank(removeFromBucket(bucket, plan.taskId), updated, backlogRankOf);
}

// ───────────────────────────────────────────────────────────────────────────
// Pre-checks: transitions and WIP
// ───────────────────────────────────────────────────────────────────────────

/**
 * Whether this project's workflow allows moving from one status to another.
 *
 * THE RULE (`workflow.schema.ts`, enforced identically server-side): transitions
 * are a per-SOURCE whitelist. Zero rows FROM a status means every move out of it
 * is allowed — which is what makes a fresh project fully open with no rows at
 * all. One or more rows means only those targets are reachable. A status can
 * always transition to itself, because a same-column reorder is not a
 * transition.
 *
 * This runs on the CLIENT purely for instant feedback — forbidden-drop styling
 * while a card is in the air. The server re-checks every move; a client that
 * skipped this check would get a `TRANSITION_NOT_ALLOWED` and a toast, not a
 * corrupt board.
 */
export function isTransitionAllowed(
  transitions: readonly Transition[],
  fromStatusId: string,
  toStatusId: string,
): boolean {
  if (fromStatusId === toStatusId) return true;

  let hasWhitelist = false;
  for (const transition of transitions) {
    if (transition.fromStatusId !== fromStatusId) continue;
    hasWhitelist = true;
    if (transition.toStatusId === toStatusId) return true;
  }

  return !hasWhitelist;
}

/** How full a column is against its WIP limit. */
export interface WipState {
  count: number;
  /** `null` when the column has no limit. */
  limit: number | null;
  /** The column is exactly at its limit — one more card would breach it. */
  atLimit: boolean;
  /** The column already holds more than its limit. */
  over: boolean;
}

/**
 * The WIP reading for one column.
 *
 * `over` can be true without anyone having dropped a card: a limit lowered in
 * the workflow editor, or a bulk import, leaves a column legitimately over. The
 * board renders that as a warning badge rather than refusing to draw.
 */
export function wipStateOf(status: Status, count: number): WipState {
  const limit = status.wipLimit;
  if (limit === null) return { count, limit: null, atLimit: false, over: false };
  return { count, limit, atLimit: count >= limit, over: count > limit };
}

/** Why a drop is refused, or `null` when it is allowed. */
export type DropBlockReason = 'transition' | 'wip';

/** The answer the board's drop styling asks for. */
export interface DropCheck {
  allowed: boolean;
  reason: DropBlockReason | null;
  /** The target column's WIP reading, INCLUDING the card being dragged in. */
  wip: WipState;
}

/**
 * Can this card be dropped here? The one function the board's drag overlay and
 * column highlighting call.
 *
 * Order of judgement matters: a forbidden TRANSITION is reported even when the
 * column is also over its WIP, because the transition is the harder rule (the
 * server will refuse it outright) while a WIP breach is advisory in most teams.
 *
 * A same-column reorder is always allowed — it changes neither the status nor
 * the column's occupancy — which is why the WIP count only adds the incoming
 * card when the status actually changes.
 */
export function checkDrop(args: {
  fromStatusId: string;
  targetStatus: Status;
  targetCount: number;
  transitions: readonly Transition[];
  /** Set false to report a WIP breach without refusing the drop. */
  enforceWip?: boolean;
}): DropCheck {
  const { fromStatusId, targetStatus, targetCount, transitions, enforceWip = true } = args;
  const sameColumn = fromStatusId === targetStatus.id;
  const wip = wipStateOf(targetStatus, sameColumn ? targetCount : targetCount + 1);

  if (sameColumn) return { allowed: true, reason: null, wip };

  if (!isTransitionAllowed(transitions, fromStatusId, targetStatus.id)) {
    return { allowed: false, reason: 'transition', wip };
  }

  if (enforceWip && wip.over) {
    return { allowed: false, reason: 'wip', wip };
  }

  return { allowed: true, reason: null, wip };
}

// ───────────────────────────────────────────────────────────────────────────
// The optimistic field patch
// ───────────────────────────────────────────────────────────────────────────

/**
 * A `PATCH /tasks/:id` body already RESOLVED into the shapes a cache holds.
 *
 * WHY A SECOND TYPE INSTEAD OF `PatchTaskInput`. The wire body names foreign
 * keys (`assigneeId`, `labelIds`) because that is what the server can validate.
 * A cache holds the EXPANDED objects — a `TaskSummary.assignee` is a user, a
 * `Task.labels` is an array of labels — so painting a patch optimistically means
 * turning ids into objects first. Doing that resolution in the hook (where the
 * query client, and therefore the member and label lists, are in reach) and
 * keeping this layer purely structural is what lets every rule below be tested
 * as a function of two plain values.
 *
 * Every field is optional and `undefined` means "not part of this patch" — which
 * is NOT the same as `null`, the legitimate value for "unassign" / "clear the
 * due date". That distinction is the whole reason {@link definedOnly} exists
 * rather than a bare spread.
 *
 * `labelIds` and `labels` are the same edit in the two shapes: a summary stores
 * ids, the detail payload stores objects. `labels` is only present when the
 * project's label list was cached and every id resolved — an unresolvable id
 * leaves the detail entry's labels alone until the response lands.
 */
export interface ResolvedTaskPatch {
  title?: string;
  description?: string | null;
  type?: TaskType;
  statusId?: string;
  priority?: TaskPriority;
  assignee?: UserSummary | null;
  storyPoints?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  sprintId?: string | null;
  epicId?: string | null;
  parentId?: string | null;
  /** For the summary shape. */
  labelIds?: string[];
  /** For the detail shape. Absent when the ids could not be expanded. */
  labels?: Label[];
}

/**
 * Drops the `undefined` members of a patch.
 *
 * Spreading the patch directly would write `undefined` over fields it never
 * mentioned — `{...task, ...{title: undefined}}` erases the title — because a
 * key that is PRESENT with value `undefined` still participates in a spread.
 * Every optimistic write here goes through this.
 */
function definedOnly<T extends object>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Paints a resolved patch onto a cached list/board row.
 *
 * Two fields do not map across: a summary carries `hasDescription` rather than
 * the markdown itself (see `taskToSummary`), and it carries `labelIds` rather
 * than expanded labels.
 */
export function applyPatchToSummary(summary: TaskSummary, patch: ResolvedTaskPatch): TaskSummary {
  const { description, labels: _labels, ...direct } = patch;
  const next: TaskSummary = { ...summary, ...definedOnly(direct) };

  if (description !== undefined) {
    next.hasDescription = (description ?? '').trim().length > 0;
  }

  return next;
}

/**
 * Paints a resolved patch onto the cached DETAIL payload.
 *
 * `epic` is deliberately NOT derived when `epicId` changes: the expanded epic
 * carries a title and a key this layer has no way to look up, and rendering a
 * stale epic chip for the length of one request is a smaller lie than blanking
 * a link the user did not remove. `onSuccess` writes the server's answer.
 */
export function applyPatchToTask(task: Task, patch: ResolvedTaskPatch): Task {
  const { labelIds: _labelIds, ...direct } = patch;
  return { ...task, ...definedOnly(direct) };
}

// ───────────────────────────────────────────────────────────────────────────
// Task → summary
// ───────────────────────────────────────────────────────────────────────────

/**
 * Narrows a full {@link Task} to the {@link TaskSummary} a list cache holds.
 *
 * Needed because the mutation endpoints answer with the DETAIL shape (a move
 * returns `{ task, rebalanced }`) while every collection cache stores the
 * summary. Writing the detail object into a board column would type-check
 * nowhere and, worse, would ship an extra 20 KB of description per card into a
 * structure the board re-renders constantly.
 *
 * The two derived fields are the interesting ones: `hasDescription` collapses
 * the markdown to the "has notes" glyph a card actually draws, and `labelIds`
 * flattens the expanded labels the same way the API's own list shape does.
 */
export function taskToSummary(task: Task): TaskSummary {
  return {
    id: task.id,
    number: task.number,
    title: task.title,
    type: task.type,
    priority: task.priority,
    statusId: task.statusId,
    assignee: task.assignee,
    storyPoints: task.storyPoints,
    startDate: task.startDate,
    dueDate: task.dueDate,
    labelIds: task.labels.map((label) => label.id),
    epicId: task.epicId,
    parentId: task.parentId,
    boardRank: task.boardRank,
    backlogRank: task.backlogRank,
    sprintId: task.sprintId,
    hasDescription: (task.description ?? '').trim().length > 0,
    commentCount: task.commentCount,
    attachmentCount: task.attachmentCount,
    updatedAt: task.updatedAt,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The cross-cache writers
// ───────────────────────────────────────────────────────────────────────────

/**
 * THE THREE SHAPES THAT LIVE UNDER `qk.tasks.all(projectId)`.
 *
 * `setQueriesData` walks every entry beneath a prefix and hands each one over
 * as `unknown`, because the prefix genuinely holds three different types: the
 * board's column map, the flat `TaskSummary[]` the table / backlog / roadmap
 * read, and the full detail payload `qk.tasks.byKey` caches for the
 * deep-linked task sheet. A guard per shape is what keeps the writers below
 * honest without a cast — and they are exported because the socket layer needs
 * the same three questions answered for its own splices.
 */
export function isBoardResponse(value: unknown): value is BoardResponse {
  return typeof value === 'object' && value !== null && 'columns' in value;
}

/** A flat `TaskSummary[]` cache entry — a filtered list, a backlog bucket. */
export function isTaskSummaryList(value: unknown): value is TaskSummary[] {
  return Array.isArray(value);
}

/**
 * A full `Task` (detail) cache entry.
 *
 * `boardRank` rather than something more obvious like `title`, because a
 * `TaskSummary` has a title too — this guard has to separate the DETAIL shape
 * from the summary shape, and it runs after {@link isTaskSummaryList} has
 * already claimed the arrays.
 */
export function isTaskDetail(value: unknown): value is Task {
  return typeof value === 'object' && value !== null && 'id' in value && 'boardRank' in value;
}

/**
 * Would writing `incoming` over `cached` move the cache BACKWARDS in time?
 *
 * ═══ WHY THE WRITERS NEED THIS AT ALL ══════════════════════════════════════
 *
 * Two authoritative copies of the same task can be in flight at once, and they
 * do not have to arrive in the order they were produced. The everyday shape:
 * a PATCH response and the `task:updated` broadcast that the SAME edit
 * produced by somebody else's tab; or two edits a second apart whose responses
 * cross on the wire because one request took a slower path. Whichever lands
 * LAST wins, and without an ordering rule that is decided by network weather.
 * The visible bug is a field snapping back to its previous value and staying
 * there until something else invalidates the entry.
 *
 * `updatedAt` is the server's own version stamp for the row — the same value
 * the API writes inside the mutation transaction — so it is the one ordering
 * both paths already agree on, with no vector clock and no extra field.
 *
 * ═══ STRICTLY OLDER, NOT "OLDER OR EQUAL" ═════════════════════════════════
 *
 * Equal stamps MUST still apply. Two edits inside the same clock tick are
 * ordinary (a table cell edited twice, an inline rename), and `updatedAt` has
 * no sub-tick resolution to separate them; refusing an equal write would drop
 * the second edit and leave the cache showing the first. A tie is resolved the
 * way it was before this guard existed — last writer wins — which is the right
 * answer when there is genuinely no information to order them by.
 *
 * ═══ AN UNPARSEABLE STAMP IS NOT A VETO ═══════════════════════════════════
 *
 * If either side does not parse as a date, the write goes through. A guard
 * that silently swallowed updates because of a format it did not recognise
 * would be far worse than the race it is preventing.
 *
 * ═══ AND IT DELIBERATELY DOES NOT COVER THE OPTIMISTIC PATH ═══════════════
 *
 * `onMutate` paints a value the SERVER HAS NOT SEEN, so it carries the row's
 * previous `updatedAt` and would be refused by its own guard. Those writes go
 * through `patchTaskCacheEntry` / `applyBoardMove` in `useTaskMutations`, which
 * do not call the writers below — that separation is what lets this rule be
 * unconditional here instead of a flag every caller has to remember.
 */
export function isStaleTaskWrite(
  cached: { updatedAt: string } | null | undefined,
  incoming: { updatedAt: string },
): boolean {
  if (!cached) return false;

  const before = Date.parse(cached.updatedAt);
  const after = Date.parse(incoming.updatedAt);
  if (Number.isNaN(before) || Number.isNaN(after)) return false;

  return after < before;
}

/**
 * The shared core of both writers: patch every COLLECTION cache holding a task.
 *
 * BOARDS ARE UPSERTED, LISTS ARE ONLY PATCHED — the single most important rule
 * here. A board holds every card of the project (subject to its filter set), so
 * a card it does not have yet belongs in it. A flat list is a FILTERED page —
 * "assigned to me", "due this week" — and inserting a row the server filtered
 * out would put a task on screen that the filter says does not belong there.
 * Patching a row the list already holds is safe; deciding it now qualifies is
 * the server's call.
 *
 * WRITES THAT WOULD GO BACKWARDS ARE DROPPED. Every branch consults
 * {@link isStaleTaskWrite} first, so a response and a broadcast describing the
 * same edit can arrive in either order without the older one repainting the
 * card. See that function for why "strictly older" and not "older or equal".
 *
 * The closing `invalidateQueries` uses `refetchType: 'none'`: it MARKS those
 * entries stale without firing a request, so the next focus or navigation
 * reconciles membership. A field edit CAN move a task out of a filtered list
 * and only the server knows — but refetching every board on every keystroke of
 * an inline edit, or on every remote update, would be far worse than being
 * briefly optimistic.
 *
 * @param detail when the caller has the authoritative full `Task`, the
 *   `qk.tasks.byKey` entry is overwritten with it too. The socket path passes
 *   `null`: its payload is a summary, and writing that over a cached `Task`
 *   would silently drop the description, watchers and dependency lists the
 *   sheet renders.
 */
function writeCollections(
  queryClient: QueryClient,
  projectId: string,
  summary: TaskSummary,
  detail: Task | null,
): void {
  queryClient.setQueriesData({ queryKey: qk.tasks.all(projectId) }, (current: unknown) => {
    // Every branch below is guarded by {@link isStaleTaskWrite}: an out-of-order
    // arrival must not repaint a card with a version the cache has already
    // moved past. The comparison is per ENTRY, not once for the whole write —
    // a board and a filtered list can legitimately hold different versions of
    // the same row.
    if (isBoardResponse(current)) {
      if (isStaleTaskWrite(findBoardTask(current, summary.id), summary)) return current;
      return upsertBoardTask(current, summary);
    }
    if (isTaskSummaryList(current)) {
      const existing = current.find((entry) => entry.id === summary.id);
      if (!existing) return current;
      if (isStaleTaskWrite(existing, summary)) return current;
      return current.map((entry) => (entry.id === summary.id ? summary : entry));
    }
    if (detail !== null && isTaskDetail(current) && current.id === detail.id) {
      return isStaleTaskWrite(current, detail) ? current : detail;
    }
    return current;
  });

  void queryClient.invalidateQueries({ queryKey: qk.tasks.all(projectId), refetchType: 'none' });
}

/**
 * Write one authoritative {@link Task} into every cache that could be showing
 * it — the LOCAL mutation path (`useTaskMutations`).
 *
 * A task appears in up to four shapes at once: its own detail entry, one or
 * more boards (one per active filter set), the backlog buckets, and the flat
 * lists. A PATCH from the task sheet has to be visible on the board behind it
 * without a refetch, which is what this buys.
 */
export function writeTaskEverywhere(queryClient: QueryClient, projectId: string, task: Task): void {
  queryClient.setQueryData<Task>(qk.task.detail(task.id), (current) =>
    isStaleTaskWrite(current, task) ? current : task,
  );
  writeCollections(queryClient, projectId, taskToSummary(task), task);
}

/**
 * Write one {@link TaskSummary} into every collection — the SOCKET path
 * (`lib/realtime-cache`), where somebody else's change arrives as a summary.
 *
 * The detail entry is deliberately NOT written here; `applyTaskUpdated`
 * invalidates it instead, so an open sheet refetches the full payload rather
 * than being overwritten with a narrower one. That asymmetry is the only real
 * difference between the two writers, and it is why they are two functions over
 * one core rather than one function with a flag.
 */
export function writeTaskSummaryEverywhere(
  queryClient: QueryClient,
  projectId: string,
  summary: TaskSummary,
): void {
  writeCollections(queryClient, projectId, summary, null);
}

/**
 * Drop a task from every collection cache, and forget its own entries.
 *
 * `removeQueries` rather than an invalidation: refetching a deleted task is a
 * guaranteed 404. An open sheet re-requests and surfaces the not-found state,
 * which is the honest rendering of "someone deleted what you were reading".
 * Shared by the optimistic local delete and the `task:deleted` socket event, so
 * both routes leave the cache in exactly the same state.
 */
export function removeTaskEverywhere(
  queryClient: QueryClient,
  projectId: string,
  taskId: string,
): void {
  queryClient.setQueriesData({ queryKey: qk.tasks.all(projectId) }, (current: unknown) => {
    if (isBoardResponse(current)) return removeBoardTask(current, taskId);
    if (isTaskSummaryList(current)) {
      // Guarded so an untouched list keeps its reference and does not re-render.
      if (!current.some((entry) => entry.id === taskId)) return current;
      return current.filter((entry) => entry.id !== taskId);
    }
    return current;
  });

  queryClient.removeQueries({ queryKey: qk.task.all(taskId) });
}
