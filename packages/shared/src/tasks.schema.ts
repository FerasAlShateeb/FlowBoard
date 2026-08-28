// Task contracts — the centre of the product, and the widest contract surface in
// the package.
//
// TWO SHAPES, ON PURPOSE:
//   - `taskSchema`        the full detail payload (`GET /tasks/:taskId`), with
//                         labels, watchers, dependencies and the epic expanded.
//   - `taskSummarySchema` the LIST/board-card shape returned by every collection
//                         endpoint. A board renders hundreds of these at once, so
//                         it carries ids (`labelIds`, `epicId`) and counts rather
//                         than nested objects.
// Keeping them separate is what stops a board fetch from dragging every
// comment count's worth of joins across the wire, and it is why the socket
// events for board sync carry the summary.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import {
  booleanQuery,
  commaSeparatedList,
  isoDate,
  isoDateTime,
  paginationQuerySchema,
  sortQueryFor,
  uuid,
  uuidOrNone,
} from './common';
import { labelSchema, projectKeySchema } from './projects.schema';
import { nameSchema, userSummarySchema } from './users.schema';
import {
  VM_DEPENDENCY_DIRECTION,
  VM_DESCRIPTION_MAX,
  VM_RANK_NEIGHBOURS,
  VM_SEARCH_MAX,
  VM_SEARCH_MIN,
  VM_STORY_POINTS_RANGE,
  VM_TASK_KEY_FORMAT,
  VM_TITLE_MAX,
  VM_TITLE_REQUIRED,
  VM_UPDATE_AT_LEAST_ONE_FIELD,
} from './validation-messages';

/**
 * The Jira-style issue hierarchy. `epic` groups work across sprints, `subtask`
 * hangs off a `parentId`, and the middle three are peers that differ only in how
 * they are triaged and iconed.
 */
export const taskTypeSchema = z.enum(['epic', 'story', 'task', 'bug', 'subtask']);
export type TaskType = z.infer<typeof taskTypeSchema>;

/** Five-step priority scale, ordered lowest -> highest. */
export const taskPrioritySchema = z.enum(['lowest', 'low', 'medium', 'high', 'highest']);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

/** A task key as humans write it: `FLOW-123`. Used by the by-key lookup route. */
export const taskKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z][A-Z0-9]{1,9}-\d+$/, VM_TASK_KEY_FORMAT));
export type TaskKey = z.infer<typeof taskKeySchema>;

/** A task title — one line, always present. */
export const taskTitleSchema = z.string().trim().min(1, VM_TITLE_REQUIRED).max(200, VM_TITLE_MAX);

/** Markdown description with `@[name](userId)` mentions, or `null` if empty. */
export const taskDescriptionSchema = z.string().max(20000, VM_DESCRIPTION_MAX).nullable();

/** A story-point estimate, or `null` for unestimated. Halves are allowed (0.5). */
export const storyPointsSchema = z
  .number()
  .min(0, VM_STORY_POINTS_RANGE)
  .max(1000, VM_STORY_POINTS_RANGE)
  .nullable();

/**
 * A `fractional-indexing` key. Compared as a plain string by Postgres, so board
 * and backlog order are an `ORDER BY` rather than a renumbering pass — see
 * `rank.ts` for the generators and the rebalance threshold.
 */
export const rankSchema = z.string().min(1);

/**
 * A minimal task reference: what a dependency row, an epic link or a search hit
 * renders. Carries the display `key` AND the raw `number` because the key is what
 * a human reads and the number is what a sort orders by.
 */
export const taskRefSchema = z.object({
  id: uuid,
  number: z.number().int().positive(),
  key: taskKeySchema,
  title: taskTitleSchema,
  type: taskTypeSchema,
  statusId: uuid,
});
export type TaskRef = z.infer<typeof taskRefSchema>;

/**
 * The two directions of a `blocks` relationship, from the viewpoint of the task
 * being read: `blockers` block THIS task; `blocked` are blocked BY it. The
 * server rejects cycles when either side is written.
 */
export const taskDependenciesSchema = z.object({
  blockers: z.array(taskRefSchema),
  blocked: z.array(taskRefSchema),
});
export type TaskDependencies = z.infer<typeof taskDependenciesSchema>;

/** The full task detail payload — `GET /tasks/:taskId` and the task sheet. */
export const taskSchema = z.object({
  id: uuid,
  projectId: uuid,
  projectKey: projectKeySchema,
  /** Per-project sequence allocated by an atomic `UPDATE … RETURNING`. */
  number: z.number().int().positive(),
  /** `projectKey`-`number`, composed server-side so nobody re-derives it. */
  key: taskKeySchema,
  title: taskTitleSchema,
  description: taskDescriptionSchema,
  type: taskTypeSchema,
  statusId: uuid,
  priority: taskPrioritySchema,
  assignee: userSummarySchema.nullable(),
  reporter: userSummarySchema.nullable(),
  storyPoints: storyPointsSchema,
  startDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  /** `null` means the task sits in the backlog. */
  sprintId: uuid.nullable(),
  epicId: uuid.nullable(),
  /** The epic itself, expanded, so the sheet renders its title without a fetch. */
  epic: taskRefSchema.nullable(),
  parentId: uuid.nullable(),
  boardRank: rankSchema,
  backlogRank: rankSchema,
  /** Stamped when the task first enters a `done`-category status; cleared if reopened. */
  resolvedAt: isoDateTime.nullable(),
  labels: z.array(labelSchema),
  watcherIds: z.array(uuid),
  dependencies: taskDependenciesSchema,
  /** Ids only — the subtask list fetches summaries with `?parentId=`. */
  subtaskIds: z.array(uuid),
  commentCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Task = z.infer<typeof taskSchema>;

/**
 * The board-card / list-row shape returned by every task COLLECTION endpoint and
 * by the realtime task events.
 *
 * `hasDescription` rather than the description itself: a card only shows a
 * "has notes" glyph, and shipping 20 KB of markdown per card would dominate a
 * board payload.
 */
export const taskSummarySchema = z.object({
  id: uuid,
  number: z.number().int().positive(),
  title: taskTitleSchema,
  type: taskTypeSchema,
  priority: taskPrioritySchema,
  statusId: uuid,
  assignee: userSummarySchema.nullable(),
  storyPoints: storyPointsSchema,
  /** Needed by the Gantt and Calendar views, which read this same list shape. */
  startDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  labelIds: z.array(uuid),
  epicId: uuid.nullable(),
  parentId: uuid.nullable(),
  boardRank: rankSchema,
  backlogRank: rankSchema,
  sprintId: uuid.nullable(),
  hasDescription: z.boolean(),
  commentCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
  /** Backs the Table view's sort and the `updatedSince` filter. */
  updatedAt: isoDateTime,
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

/**
 * `GET /projects/:projectId/tasks` filters.
 *
 * Multi-value params are comma-separated (`?statusId=a,b`); the nullable-id
 * params additionally accept the `'none'` sentinel, which selects the NULL
 * bucket — `sprintId=none` is the backlog, `assigneeId=none` is unassigned,
 * `parentId=none` is "top-level only", `epicId=none` is "not in an epic".
 * Omitting a param means "do not filter", which is a different question from
 * "filter to NULL"; that is exactly why the sentinel exists.
 */
export const taskFiltersSchema = z.object({
  statusId: commaSeparatedList(uuid).optional(),
  assigneeId: commaSeparatedList(uuidOrNone).optional(),
  type: commaSeparatedList(taskTypeSchema).optional(),
  priority: commaSeparatedList(taskPrioritySchema).optional(),
  labelId: commaSeparatedList(uuid).optional(),
  sprintId: commaSeparatedList(uuidOrNone).optional(),
  epicId: commaSeparatedList(uuidOrNone).optional(),
  parentId: commaSeparatedList(uuidOrNone).optional(),
  /** Free-text search over title (trigram) and key prefix. */
  q: z.string().trim().min(1).max(120, VM_SEARCH_MAX).optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  /**
   * The `start_date` twin of `dueFrom`/`dueTo`.
   *
   * The Calendar and the Roadmap both draw a task as a SPAN, not as a point, so
   * "which tasks touch this month" is two ranges OR-ed, not one. With only the
   * due-date pair a client had to over-fetch a padded window and re-filter in
   * the browser — which is a correctness problem as well as a bandwidth one,
   * because a task that starts inside the window and is due outside it is
   * invisible to a due-date-only query no matter how wide the padding.
   *
   * The two pairs combine as (dueFrom ≤ due ≤ dueTo) OR (startFrom ≤ start ≤
   * startTo): each pair narrows its own column, and a task matching EITHER is
   * returned. Sending only one pair asks only that question.
   */
  startFrom: isoDate.optional(),
  startTo: isoDate.optional(),
  /**
   * `true` selects tasks with NEITHER a start nor a due date.
   *
   * The Calendar's unscheduled tray, and the Roadmap's "no dates" group. It is
   * its own parameter rather than `dueFrom=none` because it spans two columns:
   * a task with a start but no due date IS scheduled, and belongs on the grid.
   *
   * Mutually exclusive with the date ranges by construction — a row with no
   * dates cannot satisfy a range — so sending both returns nothing, which is
   * the honest answer rather than an error.
   */
  undated: booleanQuery.optional(),
  /** Incremental sync / "what changed" — an ISO instant, not a calendar day. */
  updatedSince: isoDateTime.optional(),
});
export type TaskFilters = z.infer<typeof taskFiltersSchema>;

/** How a task list is shaped: grouped into board columns, or a flat page. */
export const taskViewSchema = z.enum(['board', 'flat']);
export type TaskView = z.infer<typeof taskViewSchema>;

/**
 * The columns `view=flat` may be sorted on.
 *
 * A CLOSED list rather than a free field name, and it lives in the contract
 * rather than in the API: the parsed value is a literal union, so the service's
 * `switch` maps it exhaustively to a Drizzle column, an unknown field is a 422
 * at the boundary instead of a query-builder crash, and the Table view's column
 * headers can only offer sorts the server can actually serve.
 */
export const taskSortQuerySchema = sortQueryFor([
  'createdAt',
  'updatedAt',
  'dueDate',
  'startDate',
  'priority',
  'number',
  'title',
  'storyPoints',
]);
export type TaskSortQuery = z.infer<typeof taskSortQuerySchema>;

/**
 * The full `GET /projects/:projectId/tasks` query: filters + view + sort +
 * pagination. `view=board` returns {@link boardResponseSchema} and ignores
 * pagination and sort (a board is ordered by `boardRank`, and it is not a
 * page); `view=flat` returns `TaskSummary[]` with envelope meta.
 */
export const taskListQuerySchema = taskFiltersSchema.extend({
  view: taskViewSchema.default('flat'),
  sort: taskSortQuerySchema.optional(),
  ...paginationQuerySchema.shape,
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

/**
 * `view=board` response: every column of the project keyed by status id, each
 * already ordered by `boardRank`.
 *
 * A record rather than an array of columns because the board's optimistic
 * splice, its socket patches and its WIP badge all address ONE column by id, and
 * a record makes that a lookup instead of a scan. Empty columns are present with
 * an empty array — the board still draws them.
 */
export const boardResponseSchema = z.object({
  columns: z.record(z.string(), z.array(taskSummarySchema)),
});
export type BoardResponse = z.infer<typeof boardResponseSchema>;

/**
 * `POST /projects/:projectId/tasks`.
 *
 * `statusId` is optional: omitted, the server drops the task in the project's
 * first `todo` column, which is what quick-add on the backlog wants.
 */
export const createTaskInputSchema = z.object({
  title: taskTitleSchema,
  description: taskDescriptionSchema.default(null),
  type: taskTypeSchema.default('task'),
  statusId: uuid.optional(),
  priority: taskPrioritySchema.default('medium'),
  assigneeId: uuid.nullable().default(null),
  storyPoints: storyPointsSchema.default(null),
  startDate: isoDate.nullable().default(null),
  dueDate: isoDate.nullable().default(null),
  sprintId: uuid.nullable().default(null),
  epicId: uuid.nullable().default(null),
  parentId: uuid.nullable().default(null),
  labelIds: z.array(uuid).default([]),
  watcherIds: z.array(uuid).default([]),
});
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

/**
 * `PATCH /tasks/:taskId` — every field optional, at least one required.
 *
 * Rank fields are absent by design: order changes go through
 * {@link moveTaskInputSchema} / {@link rankTaskInputSchema}, which compute the
 * authoritative key from neighbour ids inside the same transaction. A client
 * that could PATCH a rank directly would be able to write a key it derived from
 * a stale board.
 */
export const patchTaskInputSchema = z
  .object({
    title: taskTitleSchema,
    description: taskDescriptionSchema,
    type: taskTypeSchema,
    statusId: uuid,
    priority: taskPrioritySchema,
    assigneeId: uuid.nullable(),
    storyPoints: storyPointsSchema,
    startDate: isoDate.nullable(),
    dueDate: isoDate.nullable(),
    sprintId: uuid.nullable(),
    epicId: uuid.nullable(),
    parentId: uuid.nullable(),
    labelIds: z.array(uuid),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: VM_UPDATE_AT_LEAST_ONE_FIELD });
export type PatchTaskInput = z.infer<typeof patchTaskInputSchema>;

/**
 * `POST /tasks/:taskId/move` — the Kanban drop.
 *
 * The client sends the DESTINATION NEIGHBOURS, never a final position: the
 * server recomputes the rank from the neighbours it reads inside the move
 * transaction, so two people dropping into the same gap cannot produce the same
 * key. `clientRank` is the optimistic key the dragging client already painted —
 * the server may honour it when the neighbours still agree, which makes the
 * common case a no-op re-render instead of a snap.
 *
 * Both neighbours absent means "drop at the end of the column".
 */
export const moveTaskInputSchema = z
  .object({
    statusId: uuid,
    beforeTaskId: uuid.optional(),
    afterTaskId: uuid.optional(),
    clientRank: rankSchema.optional(),
  })
  .refine((value) => value.beforeTaskId === undefined || value.afterTaskId === undefined, {
    message: VM_RANK_NEIGHBOURS,
    path: ['afterTaskId'],
  });
export type MoveTaskInput = z.infer<typeof moveTaskInputSchema>;

/**
 * `POST /tasks/:taskId/move` response. `rebalanced: true` means the transaction
 * rewrote the whole column's ranks (a key grew past
 * `NEEDS_REBALANCE_LENGTH`), so every OTHER cached rank in that column is now
 * stale and the client must invalidate the board rather than splice.
 */
export const moveTaskResponseSchema = z.object({
  task: taskSchema,
  rebalanced: z.boolean(),
});
export type MoveTaskResponse = z.infer<typeof moveTaskResponseSchema>;

/**
 * `POST /tasks/:taskId/rank` — the backlog/sprint reorder, the `backlog_rank`
 * twin of {@link moveTaskInputSchema}. `sprintId: null` moves the task to the
 * backlog; a uuid moves it into that sprint. Same neighbour semantics, same
 * `rebalanced` response.
 */
export const rankTaskInputSchema = z
  .object({
    sprintId: uuid.nullable(),
    beforeTaskId: uuid.optional(),
    afterTaskId: uuid.optional(),
  })
  .refine((value) => value.beforeTaskId === undefined || value.afterTaskId === undefined, {
    message: VM_RANK_NEIGHBOURS,
    path: ['afterTaskId'],
  });
export type RankTaskInput = z.infer<typeof rankTaskInputSchema>;

/** `PUT /tasks/:taskId/watchers/me` — the watcher toggle's mute flag. */
export const watchTaskInputSchema = z.object({
  isMuted: z.boolean().default(false),
});
export type WatchTaskInput = z.infer<typeof watchTaskInputSchema>;

/**
 * `PUT` / `DELETE /tasks/:taskId/watchers/me` response — the resulting state of
 * MY subscription, echoed back.
 *
 * Both verbs are idempotent, so the answer is the state rather than "what
 * changed": `PUT` on a task I already watch and `DELETE` on one I never watched
 * both succeed, and a client that assumed a toggle would be out of sync after
 * either. `taskId`/`userId` are included so the payload is self-describing when
 * it arrives out of band.
 */
export const watcherResponseSchema = z.object({
  taskId: uuid,
  userId: uuid,
  watching: z.boolean(),
  isMuted: z.boolean(),
});
export type WatcherResponse = z.infer<typeof watcherResponseSchema>;

/**
 * `POST /tasks/:taskId/dependencies` — declare a `blocks` edge, in EITHER
 * direction, with exactly one of the two keys.
 *
 * "A blocks B" and "B is blocked by A" are one row read from two ends, so there
 * is one endpoint and one row. But the detail sheet offers both directions, and
 * making the client re-target its POST at the OTHER task to express the second
 * one is a trap — a caller that gets it backwards writes a real, wrong edge.
 * So the direction is named in the body: `blockerTaskId` means "that task
 * blocks this one", `blockedTaskId` means "this one blocks that task".
 *
 * Exactly one is required. Both present has no correct reading; neither leaves
 * no edge to write.
 */
export const createDependencyInputSchema = z
  .object({
    /** The task that must finish first — it blocks `:taskId`. */
    blockerTaskId: uuid.optional(),
    /** The task held up — `:taskId` blocks it. */
    blockedTaskId: uuid.optional(),
  })
  .refine((value) => (value.blockerTaskId === undefined) !== (value.blockedTaskId === undefined), {
    message: VM_DEPENDENCY_DIRECTION,
    path: ['blockerTaskId'],
  });
export type CreateDependencyInput = z.infer<typeof createDependencyInputSchema>;

/**
 * One `blocks` edge, as a PAIR OF IDS.
 *
 * The narrowest possible shape, and deliberately not a {@link taskRefSchema}
 * pair: the only consumer is the Roadmap's SVG arrow layer, which already holds
 * every row it can draw an arrow between and needs nothing from an edge but
 * which two of them to join. Expanding both ends would multiply a project's
 * edge payload by the size of a task ref for data the caller would discard.
 */
export const taskDependencyEdgeSchema = z.object({
  /** The task that must finish first. */
  blockerTaskId: uuid,
  /** The task it holds up. */
  blockedTaskId: uuid,
});
export type TaskDependencyEdge = z.infer<typeof taskDependencyEdgeSchema>;

/**
 * `GET /projects/:projectId/dependencies` — EVERY edge in the project, in one
 * request.
 *
 * WHY A PROJECT-WIDE ENDPOINT EXISTS AT ALL. A dependency is the one piece of
 * task data that is inherently about a PAIR, and the collection shape
 * (`taskSummarySchema`) carries none of it — a board renders hundreds of cards
 * and none of them draw an arrow, so widening the summary would tax every view
 * for one. Before this route the Roadmap had to read edges out of individual
 * task DETAIL payloads, which is N requests for N visible rows and silently
 * loses any arrow whose other end is off screen.
 *
 * Unpaginated, on purpose: an edge is 72 bytes and a project with a thousand
 * tasks has tens of edges, not thousands. Paginating would buy nothing and cost
 * the caller a loop.
 *
 * Edges touching a soft-deleted task on either end are omitted — an arrow to a
 * row that is not there has nothing to point at.
 */
export const projectDependenciesResponseSchema = z.object({
  edges: z.array(taskDependencyEdgeSchema),
});
export type ProjectDependenciesResponse = z.infer<typeof projectDependenciesResponseSchema>;

/**
 * One hit from `GET /orgs/:orgId/search` (the command palette). Cross-project by
 * definition, so it carries the project identity every row needs to deep-link
 * into `/o/:orgSlug/p/:projectKey`.
 */
export const searchResultSchema = z.object({
  taskId: uuid,
  key: taskKeySchema,
  title: taskTitleSchema,
  type: taskTypeSchema,
  statusId: uuid,
  projectId: uuid,
  projectKey: projectKeySchema,
  projectName: nameSchema,
});
export type SearchResult = z.infer<typeof searchResultSchema>;

/**
 * The hard ceiling on `GET /orgs/:orgId/search?limit=`.
 *
 * 25, not 50: this backs the command palette, which shows a scrollable list a
 * keyboard user arrows through — past ~25 rows nobody is reading, they are
 * refining the query. The number is in the CONTRACT rather than only in the
 * service so the two ends cannot disagree about what `limit=50` means (the
 * server used to silently clamp it, which reads to a client as the server
 * having fewer matches than it does).
 */
export const MAX_SEARCH_RESULTS = 25;

/** `GET /orgs/:orgId/search?q=` — 2-char floor keeps the trigram scan honest. */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, VM_SEARCH_MIN).max(120, VM_SEARCH_MAX),
  limit: z.coerce.number().int().min(1).max(MAX_SEARCH_RESULTS).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** `GET /orgs/:orgId/search` response — key-prefix hits first, then trigram. */
export const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
