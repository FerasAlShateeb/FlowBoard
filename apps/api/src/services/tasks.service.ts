/**
 * The task domain service — FlowBoard's centre of gravity.
 *
 * Everything here obeys the same four-part contract for a mutation, which is
 * the project's standard (plan → Wave 2, checklist section D):
 *
 *   1. **one transaction** (`withTx`) around every multi-row write, because
 *      every mutation also appends to the activity stream and history that can
 *      disagree with state is worse than no history;
 *   2. **activity**, one row per changed field, through `recordActivities`;
 *   3. **telemetry**, fire-and-forget, never able to fail the mutation;
 *   4. **a domain event**, carrying `originSocketId` so the actor's own tab is
 *      not echoed its own optimistic update.
 *
 * Two payload shapes leave this file, and the split is deliberate (see
 * `tasks.schema.ts`): `TaskSummary` for collections — a board renders hundreds
 * at once — and the fully-expanded `Task` for the detail sheet.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';
import {
  NONE_SENTINEL,
  type BoardResponse,
  type CreateTaskInput,
  type Label,
  type MoveTaskInput,
  type MoveTaskResponse,
  type PatchTaskInput,
  type ProjectDependenciesResponse,
  type RankTaskInput,
  type Task,
  type TaskFilters,
  type TaskRef,
  type TaskSummary,
  type UserSummary,
} from '@flowboard/shared';

import {
  comments,
  attachments,
  db,
  labels,
  projects,
  projectMembers,
  orgMembers,
  sprints,
  taskDependencies,
  taskLabels,
  taskWatchers,
  tasks,
  users,
  withTx,
  type Db,
  type Tx,
} from '../db';
import { ApiError } from '../utils/api-error';
import { publishDomainEvent, type AudienceSnapshot } from '../utils/domain-events';
import {
  appendRank,
  computeRank,
  lockBuckets,
  rebalanceBucket,
  tailRank,
  type RankBucket,
} from '../utils/rank-rebalance';
import { recordActivities, recordActivity, type ActivityEntry } from './activity.service';
// `23505` is what the `task_dependencies` unique index emits when two clients
// link the same pair at once. The shared predicate walks the Drizzle `cause`
// chain — see `pg-errors.ts` for why that matters.
import { isUniqueViolation } from './pg-errors';
import { record } from './telemetry.service';
import {
  defaultStatus,
  loadStatuses,
  requireStatus,
  resolutionFor,
  validateStatusChange,
  type StatusInfo,
} from './task-move.service';

type Executor = Db | Tx;

/** Who is acting, and from which browser tab (for echo suppression). */
export interface TaskActor {
  userId: string;
  socketId: string | null;
}

/** The project a request has already been authorised against. */
export interface ProjectScope {
  projectId: string;
  orgId: string;
}

/** A sort field the flat list accepts. Closed, so it maps exhaustively. */
export type TaskSortField =
  | 'createdAt'
  | 'updatedAt'
  | 'dueDate'
  | 'startDate'
  | 'priority'
  | 'number'
  | 'title'
  | 'storyPoints';

export interface TaskListOptions {
  filters: TaskFilters;
  page: number;
  pageSize: number;
  sort?: { field: TaskSortField; direction: 'asc' | 'desc' } | undefined;
}

/** A page of the flat list, plus the total the envelope's `meta` reports. */
export interface TaskPage {
  items: TaskSummary[];
  total: number;
}

// ---------------------------------------------------------------------------
// Wire formatting
// ---------------------------------------------------------------------------

/** `Date` -> the `isoDateTime` the contracts carry. */
export function toIsoDateTime(value: Date): string {
  return value.toISOString();
}

function toIsoDateTimeOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** `FLOW` + `123` -> `FLOW-123`, composed server-side so nobody re-derives it. */
export function composeTaskKey(projectKey: string, number: number): string {
  return `${projectKey}-${String(number)}`;
}

/** The three-field user reference every payload embeds. */
function toUserSummary(row: {
  id: string | null;
  name: string | null;
  avatarUrl: string | null;
}): UserSummary | null {
  if (row.id === null || row.name === null) return null;
  return { id: row.id, name: row.name, avatarUrl: row.avatarUrl };
}

// ---------------------------------------------------------------------------
// Correlated count / aggregate expressions
// ---------------------------------------------------------------------------

/**
 * Per-task aggregates as correlated sub-selects.
 *
 * Each one is served by the child table's `(task_id, …)` index, so a board page
 * costs one index probe per card rather than a second round trip per card — and
 * unlike a join it cannot multiply the task rows.
 */
const commentCountExpr = sql<number>`(
  SELECT count(*)::int FROM ${comments}
  WHERE ${comments.taskId} = ${tasks.id} AND ${comments.deletedAt} IS NULL
)`;

const attachmentCountExpr = sql<number>`(
  SELECT count(*)::int FROM ${attachments}
  WHERE ${attachments.taskId} = ${tasks.id}
    AND ${attachments.deletedAt} IS NULL
    AND ${attachments.confirmedAt} IS NOT NULL
)`;

const labelIdsExpr = sql<string[]>`(
  SELECT coalesce(array_agg(${taskLabels.labelId}::text ORDER BY ${taskLabels.labelId}), ARRAY[]::text[])
  FROM ${taskLabels} WHERE ${taskLabels.taskId} = ${tasks.id}
)`;

const assigneeUser = alias(users, 'assignee_user');
const reporterUser = alias(users, 'reporter_user');

const summarySelection = {
  id: tasks.id,
  number: tasks.number,
  title: tasks.title,
  type: tasks.type,
  priority: tasks.priority,
  statusId: tasks.statusId,
  storyPoints: tasks.storyPoints,
  startDate: tasks.startDate,
  dueDate: tasks.dueDate,
  epicId: tasks.epicId,
  parentId: tasks.parentId,
  boardRank: tasks.boardRank,
  backlogRank: tasks.backlogRank,
  sprintId: tasks.sprintId,
  description: tasks.description,
  updatedAt: tasks.updatedAt,
  assigneeId: assigneeUser.id,
  assigneeName: assigneeUser.name,
  assigneeAvatarUrl: assigneeUser.avatarUrl,
  labelIds: labelIdsExpr,
  commentCount: commentCountExpr,
  attachmentCount: attachmentCountExpr,
};

function toTaskSummary(row: {
  id: string;
  number: number;
  title: string;
  type: TaskSummary['type'];
  priority: TaskSummary['priority'];
  statusId: string;
  storyPoints: number | null;
  startDate: string | null;
  dueDate: string | null;
  epicId: string | null;
  parentId: string | null;
  boardRank: string;
  backlogRank: string;
  sprintId: string | null;
  description: string | null;
  updatedAt: Date;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeAvatarUrl: string | null;
  labelIds: string[];
  commentCount: number;
  attachmentCount: number;
}): TaskSummary {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    type: row.type,
    priority: row.priority,
    statusId: row.statusId,
    assignee: toUserSummary({
      id: row.assigneeId,
      name: row.assigneeName,
      avatarUrl: row.assigneeAvatarUrl,
    }),
    storyPoints: row.storyPoints,
    startDate: row.startDate,
    dueDate: row.dueDate,
    labelIds: row.labelIds,
    epicId: row.epicId,
    parentId: row.parentId,
    boardRank: row.boardRank,
    backlogRank: row.backlogRank,
    sprintId: row.sprintId,
    hasDescription: row.description !== null && row.description.trim().length > 0,
    commentCount: row.commentCount,
    attachmentCount: row.attachmentCount,
    updatedAt: toIsoDateTime(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * A filter over a NULLABLE id column that understands the `'none'` sentinel.
 *
 * `?sprintId=none` is the backlog, `?assigneeId=none` is unassigned. Omitting
 * the param entirely means "do not filter", which is a different question — see
 * the note on {@link NONE_SENTINEL} in the shared package.
 */
function nullableIdFilter(column: PgColumn, values: readonly string[]): SQL | undefined {
  const includeNull = values.includes(NONE_SENTINEL);
  const ids = values.filter((value) => value !== NONE_SENTINEL);
  if (includeNull && ids.length > 0) return or(isNull(column), inArray(column, ids));
  if (includeNull) return isNull(column);
  if (ids.length > 0) return inArray(column, ids);
  return undefined;
}

function buildTaskFilters(projectId: string, filters: TaskFilters): SQL[] {
  const conditions: SQL[] = [eq(tasks.projectId, projectId) as SQL, isNull(tasks.deletedAt) as SQL];
  const push = (condition: SQL | undefined): void => {
    if (condition !== undefined) conditions.push(condition);
  };

  if (filters.statusId && filters.statusId.length > 0) {
    push(inArray(tasks.statusId, filters.statusId));
  }
  if (filters.type && filters.type.length > 0) push(inArray(tasks.type, filters.type));
  if (filters.priority && filters.priority.length > 0) {
    push(inArray(tasks.priority, filters.priority));
  }
  if (filters.assigneeId) push(nullableIdFilter(tasks.assigneeId, filters.assigneeId));
  if (filters.sprintId) push(nullableIdFilter(tasks.sprintId, filters.sprintId));
  if (filters.epicId) push(nullableIdFilter(tasks.epicId, filters.epicId));
  if (filters.parentId) push(nullableIdFilter(tasks.parentId, filters.parentId));

  if (filters.labelId && filters.labelId.length > 0) {
    const labelIds = filters.labelId;
    push(
      exists(
        db
          .select({ one: sql`1` })
          .from(taskLabels)
          .where(and(eq(taskLabels.taskId, tasks.id), inArray(taskLabels.labelId, labelIds))),
      ),
    );
  }

  if (filters.q !== undefined) {
    const term = filters.q;
    const titleMatch = ilike(tasks.title, `%${term}%`);
    const numeric = /^\d+$/u.test(term) ? sql`${tasks.number}::text LIKE ${`${term}%`}` : undefined;
    push(numeric === undefined ? titleMatch : or(titleMatch, numeric));
  }

  pushDateWindow(filters, push);

  if (filters.updatedSince !== undefined) {
    push(gte(tasks.updatedAt, new Date(filters.updatedSince)));
  }

  return conditions;
}

/**
 * The date half of the filter set: two ranges and an "unscheduled" flag.
 *
 * THE OR IS THE POINT. The Calendar and the Roadmap draw a task as a SPAN, so
 * "which tasks touch this window" is `due ∈ window OR start ∈ window` — a task
 * that starts in March and is due in May belongs on April's grid and satisfies
 * neither range on its own. AND-ing the two pairs (the shape a naive
 * `push(...)` per parameter produces) would return only tasks that both start
 * and end inside the window, which is a strictly smaller and wrong set.
 *
 * Each pair is still an AND internally: `dueFrom` and `dueTo` bound the same
 * column and describe one interval.
 *
 * `undated` is a THIRD, disjoint question — neither column set — so it is not
 * folded into the OR: a client that sends it with a range is asking for rows
 * that are simultaneously inside a window and have no dates, and the empty
 * answer is the correct one.
 */
function pushDateWindow(filters: TaskFilters, push: (condition: SQL | undefined) => void): void {
  if (filters.undated === true) {
    push(and(isNull(tasks.startDate), isNull(tasks.dueDate)));
  }

  const dueBounds: SQL[] = [];
  if (filters.dueFrom !== undefined) dueBounds.push(gte(tasks.dueDate, filters.dueFrom) as SQL);
  if (filters.dueTo !== undefined) dueBounds.push(lte(tasks.dueDate, filters.dueTo) as SQL);

  const startBounds: SQL[] = [];
  if (filters.startFrom !== undefined) {
    startBounds.push(gte(tasks.startDate, filters.startFrom) as SQL);
  }
  if (filters.startTo !== undefined) startBounds.push(lte(tasks.startDate, filters.startTo) as SQL);

  const dueWindow = dueBounds.length > 0 ? and(...dueBounds) : undefined;
  const startWindow = startBounds.length > 0 ? and(...startBounds) : undefined;

  if (dueWindow !== undefined && startWindow !== undefined) {
    push(or(dueWindow, startWindow));
    return;
  }
  push(dueWindow ?? startWindow);
}

function sortColumn(field: TaskSortField) {
  switch (field) {
    case 'createdAt':
      return tasks.createdAt;
    case 'updatedAt':
      return tasks.updatedAt;
    case 'dueDate':
      return tasks.dueDate;
    case 'startDate':
      return tasks.startDate;
    case 'priority':
      return tasks.priority;
    case 'number':
      return tasks.number;
    case 'title':
      return tasks.title;
    case 'storyPoints':
      return tasks.storyPoints;
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function selectSummaries(
  executor: Executor,
  conditions: SQL[],
  order: SQL[],
  limit?: number,
  offset?: number,
): Promise<TaskSummary[]> {
  const base = executor
    .select(summarySelection)
    .from(tasks)
    .leftJoin(assigneeUser, eq(tasks.assigneeId, assigneeUser.id))
    .where(and(...conditions))
    .orderBy(...order);

  const rows = limit === undefined ? await base : await base.limit(limit).offset(offset ?? 0);
  return (rows as unknown as Parameters<typeof toTaskSummary>[0][]).map(toTaskSummary);
}

/**
 * `view=board` — every column of the project, each already ordered by
 * `board_rank`.
 *
 * ALL statuses are present, empty ones with an empty array: the board still
 * draws an empty column, and a client that had to infer the column set from the
 * rows would lose one the moment it emptied.
 */
export async function listBoard(
  scope: ProjectScope,
  filters: TaskFilters,
  executor: Executor = db,
): Promise<BoardResponse> {
  const [statusRows, summaries] = await Promise.all([
    loadStatuses(executor, scope.projectId),
    selectSummaries(executor, buildTaskFilters(scope.projectId, filters), [
      asc(tasks.boardRank),
      asc(tasks.id),
    ]),
  ]);

  const columns: Record<string, TaskSummary[]> = {};
  for (const status of statusRows) columns[status.id] = [];
  for (const summary of summaries) {
    const column = columns[summary.statusId];
    // A task whose status was deleted out from under it would otherwise vanish
    // silently; give it a column so the board can still show it.
    if (column === undefined) columns[summary.statusId] = [summary];
    else column.push(summary);
  }
  return { columns };
}

/** `view=flat` — a sorted, paginated page of summaries. */
export async function listTasks(
  scope: ProjectScope,
  options: TaskListOptions,
  executor: Executor = db,
): Promise<TaskPage> {
  const conditions = buildTaskFilters(scope.projectId, options.filters);
  const direction = options.sort?.direction ?? 'desc';
  const column = sortColumn(options.sort?.field ?? 'updatedAt');
  const order: SQL[] = [
    (direction === 'asc' ? asc(column) : desc(column)) as SQL,
    // A stable tiebreak, so page 2 cannot repeat a row from page 1.
    asc(tasks.id) as SQL,
  ];

  const [items, totalRows] = await Promise.all([
    selectSummaries(
      executor,
      conditions,
      order,
      options.pageSize,
      (options.page - 1) * options.pageSize,
    ),
    executor
      .select({ value: count() })
      .from(tasks)
      .where(and(...conditions)),
  ]);

  return { items, total: totalRows[0]?.value ?? 0 };
}

interface TaskRow {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string | null;
  type: Task['type'];
  statusId: string;
  priority: Task['priority'];
  assigneeId: string | null;
  reporterId: string | null;
  storyPoints: number | null;
  startDate: string | null;
  dueDate: string | null;
  sprintId: string | null;
  epicId: string | null;
  parentId: string | null;
  boardRank: string;
  backlogRank: string;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Load one live task row, or 404. The single "does this task exist" gate. */
export async function requireTaskRow(executor: Executor, taskId: string): Promise<TaskRow> {
  const [row] = await executor
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      number: tasks.number,
      title: tasks.title,
      description: tasks.description,
      type: tasks.type,
      statusId: tasks.statusId,
      priority: tasks.priority,
      assigneeId: tasks.assigneeId,
      reporterId: tasks.reporterId,
      storyPoints: tasks.storyPoints,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      sprintId: tasks.sprintId,
      epicId: tasks.epicId,
      parentId: tasks.parentId,
      boardRank: tasks.boardRank,
      backlogRank: tasks.backlogRank,
      resolvedAt: tasks.resolvedAt,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!row) throw ApiError.notFound('Task not found');
  return row;
}

/**
 * The full detail payload: labels, watchers, both dependency directions, the
 * epic expanded and the subtask ids.
 *
 * Six small indexed reads rather than one wide join — a join across four
 * many-to-many tables multiplies rows by the product of their cardinalities and
 * then has to be de-duplicated in JS, which is both slower and easy to get
 * subtly wrong.
 */
export async function loadTaskDetail(executor: Executor, taskId: string): Promise<Task> {
  const [row] = await executor
    .select({
      task: {
        id: tasks.id,
        projectId: tasks.projectId,
        number: tasks.number,
        title: tasks.title,
        description: tasks.description,
        type: tasks.type,
        statusId: tasks.statusId,
        priority: tasks.priority,
        storyPoints: tasks.storyPoints,
        startDate: tasks.startDate,
        dueDate: tasks.dueDate,
        sprintId: tasks.sprintId,
        epicId: tasks.epicId,
        parentId: tasks.parentId,
        boardRank: tasks.boardRank,
        backlogRank: tasks.backlogRank,
        resolvedAt: tasks.resolvedAt,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
      },
      projectKey: projects.key,
      assigneeId: assigneeUser.id,
      assigneeName: assigneeUser.name,
      assigneeAvatarUrl: assigneeUser.avatarUrl,
      reporterId: reporterUser.id,
      reporterName: reporterUser.name,
      reporterAvatarUrl: reporterUser.avatarUrl,
      commentCount: commentCountExpr,
      attachmentCount: attachmentCountExpr,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(assigneeUser, eq(tasks.assigneeId, assigneeUser.id))
    .leftJoin(reporterUser, eq(tasks.reporterId, reporterUser.id))
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);

  if (!row) throw ApiError.notFound('Task not found');
  const projectKey = row.projectKey;

  const refSelection = {
    id: tasks.id,
    number: tasks.number,
    title: tasks.title,
    type: tasks.type,
    statusId: tasks.statusId,
  };
  const toRef = (ref: {
    id: string;
    number: number;
    title: string;
    type: TaskRef['type'];
    statusId: string;
  }): TaskRef => ({
    id: ref.id,
    number: ref.number,
    key: composeTaskKey(projectKey, ref.number),
    title: ref.title,
    type: ref.type,
    statusId: ref.statusId,
  });

  const [labelRows, watcherRows, blockerRows, blockedRows, subtaskRows, epicRows] =
    await Promise.all([
      executor
        .select({
          id: labels.id,
          projectId: labels.projectId,
          name: labels.name,
          color: labels.color,
        })
        .from(taskLabels)
        .innerJoin(labels, eq(taskLabels.labelId, labels.id))
        .where(eq(taskLabels.taskId, taskId))
        .orderBy(asc(labels.name)),
      executor
        .select({ userId: taskWatchers.userId })
        .from(taskWatchers)
        .where(eq(taskWatchers.taskId, taskId)),
      executor
        .select(refSelection)
        .from(taskDependencies)
        .innerJoin(tasks, eq(taskDependencies.blockerTaskId, tasks.id))
        .where(and(eq(taskDependencies.blockedTaskId, taskId), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.number)),
      executor
        .select(refSelection)
        .from(taskDependencies)
        .innerJoin(tasks, eq(taskDependencies.blockedTaskId, tasks.id))
        .where(and(eq(taskDependencies.blockerTaskId, taskId), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.number)),
      executor
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.parentId, taskId), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.backlogRank), asc(tasks.id)),
      row.task.epicId === null
        ? Promise.resolve([])
        : executor
            .select(refSelection)
            .from(tasks)
            .where(and(eq(tasks.id, row.task.epicId), isNull(tasks.deletedAt)))
            .limit(1),
    ]);

  const epicRef = epicRows[0];

  return {
    id: row.task.id,
    projectId: row.task.projectId,
    projectKey,
    number: row.task.number,
    key: composeTaskKey(projectKey, row.task.number),
    title: row.task.title,
    description: row.task.description,
    type: row.task.type,
    statusId: row.task.statusId,
    priority: row.task.priority,
    assignee: toUserSummary({
      id: row.assigneeId,
      name: row.assigneeName,
      avatarUrl: row.assigneeAvatarUrl,
    }),
    reporter: toUserSummary({
      id: row.reporterId,
      name: row.reporterName,
      avatarUrl: row.reporterAvatarUrl,
    }),
    storyPoints: row.task.storyPoints,
    startDate: row.task.startDate,
    dueDate: row.task.dueDate,
    sprintId: row.task.sprintId,
    epicId: row.task.epicId,
    epic: epicRef === undefined ? null : toRef(epicRef),
    parentId: row.task.parentId,
    boardRank: row.task.boardRank,
    backlogRank: row.task.backlogRank,
    resolvedAt: toIsoDateTimeOrNull(row.task.resolvedAt),
    labels: labelRows satisfies Label[],
    watcherIds: watcherRows.map((watcher) => watcher.userId),
    dependencies: {
      blockers: blockerRows.map(toRef),
      blocked: blockedRows.map(toRef),
    },
    subtaskIds: subtaskRows.map((subtask) => subtask.id),
    commentCount: row.commentCount,
    attachmentCount: row.attachmentCount,
    createdAt: toIsoDateTime(row.task.createdAt),
    updatedAt: toIsoDateTime(row.task.updatedAt),
  };
}

/** `GET /tasks/:taskId`. */
export function getTask(taskId: string): Promise<Task> {
  return loadTaskDetail(db, taskId);
}

/** The `123` half of `FLOW-123`. The key's format is already zod-checked. */
export function taskNumberFromKey(taskKey: string): number {
  const separator = taskKey.lastIndexOf('-');
  return Number.parseInt(taskKey.slice(separator + 1), 10);
}

/** The `FLOW` half of `FLOW-123`. */
export function projectKeyFromTaskKey(taskKey: string): string {
  const separator = taskKey.lastIndexOf('-');
  return taskKey.slice(0, separator);
}

/**
 * `GET /projects/:projectId/tasks/by-key/:taskKey` — the `FLOW-123` deep link.
 *
 * THE PREFIX IS VERIFIED, not stripped and forgotten. `:projectId` and the key's
 * `FLOW` prefix are two independent statements about which project this is, and
 * a request where they disagree (`FLOW-12` under CORE's id) is a stale link or a
 * hand-edited URL — never a request for CORE-12. Answering it with CORE-12 would
 * hand the caller a task they did not ask for, under a key that is not its own.
 */
export async function getTaskByProjectKey(projectId: string, taskKey: string): Promise<Task> {
  const [project] = await db
    .select({ key: projects.key })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!project) throw ApiError.notFound('Task not found');
  if (project.key !== projectKeyFromTaskKey(taskKey)) throw ApiError.notFound('Task not found');

  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.number, taskNumberFromKey(taskKey)),
        isNull(tasks.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw ApiError.notFound('Task not found');
  return loadTaskDetail(db, row.id);
}

// ---------------------------------------------------------------------------
// Relationship validation
// ---------------------------------------------------------------------------

/**
 * Reject any user id the project cannot see.
 *
 * One query for the whole set, resolving the same inheritance chain the guards
 * do: global admin ⊃ org admin ⊃ explicit project membership. Used for
 * assignees, watchers and comment mentions — a hand-crafted request must not be
 * able to assign work to, or notify, somebody outside the project.
 */
export async function assertProjectVisibleUsers(
  executor: Executor,
  scope: ProjectScope,
  userIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;

  const rows = await executor
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, unique),
        eq(users.isActive, true),
        or(
          eq(users.isGlobalAdmin, true),
          exists(
            db
              .select({ one: sql`1` })
              .from(projectMembers)
              .where(
                and(
                  eq(projectMembers.projectId, scope.projectId),
                  eq(projectMembers.userId, users.id),
                ),
              ),
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(orgMembers)
              .where(
                and(
                  eq(orgMembers.orgId, scope.orgId),
                  eq(orgMembers.userId, users.id),
                  eq(orgMembers.role, 'admin'),
                ),
              ),
          ),
        ),
      ),
    );

  const found = new Set(rows.map((row) => row.id));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw ApiError.badRequest('One or more users are not members of this project', { missing });
  }
}

async function assertLabelsInProject(
  executor: Executor,
  projectId: string,
  labelIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(labelIds)];
  if (unique.length === 0) return;
  const rows = await executor
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.projectId, projectId), inArray(labels.id, unique)));
  if (rows.length !== unique.length) {
    throw ApiError.badRequest('One or more labels do not belong to this project');
  }
}

async function assertSprintInProject(
  executor: Executor,
  projectId: string,
  sprintId: string,
): Promise<void> {
  const [row] = await executor
    .select({ id: sprints.id, state: sprints.state })
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.projectId, projectId)))
    .limit(1);
  if (!row) throw ApiError.badRequest('Sprint does not belong to this project');
  if (row.state === 'completed') {
    throw ApiError.badRequest('Cannot put a task into a completed sprint');
  }
}

async function assertEpic(
  executor: Executor,
  projectId: string,
  epicId: string,
  selfId: string | null,
): Promise<void> {
  if (epicId === selfId) throw ApiError.badRequest('A task cannot be its own epic');
  const [row] = await executor
    .select({ id: tasks.id, type: tasks.type })
    .from(tasks)
    .where(and(eq(tasks.id, epicId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!row) throw ApiError.badRequest('Epic does not belong to this project');
  if (row.type !== 'epic') throw ApiError.badRequest('epicId must reference a task of type epic');
}

/**
 * A parent must live in the same project and must not itself be a subtask.
 *
 * One level of nesting is the whole rule — it is also what makes a parent cycle
 * impossible without walking a graph, since a subtask can never be a parent.
 */
async function assertParent(
  executor: Executor,
  projectId: string,
  parentId: string,
  selfId: string | null,
): Promise<void> {
  if (parentId === selfId) throw ApiError.badRequest('A task cannot be its own parent');
  const [row] = await executor
    .select({ id: tasks.id, parentId: tasks.parentId, type: tasks.type })
    .from(tasks)
    .where(and(eq(tasks.id, parentId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!row) throw ApiError.badRequest('Parent task does not belong to this project');
  if (row.parentId !== null) throw ApiError.badRequest('A subtask cannot be a parent');
  if (row.type === 'subtask') throw ApiError.badRequest('A subtask cannot be a parent');
}

/**
 * `type: 'subtask'` and `parentId` are two spellings of the same fact, so they
 * are validated as an equivalence rather than independently.
 */
function assertSubtaskShape(type: Task['type'], parentId: string | null): void {
  if (type === 'subtask' && parentId === null) {
    throw ApiError.badRequest('A subtask needs a parentId');
  }
  if (type !== 'subtask' && parentId !== null) {
    throw ApiError.badRequest('Only a task of type subtask may have a parentId');
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** `POST /projects/:projectId/tasks`. */
export async function createTask(
  scope: ProjectScope,
  actor: TaskActor,
  input: CreateTaskInput,
): Promise<Task> {
  const taskId = await withTx(async (tx) => {
    // The atomic allocation. `UPDATE … RETURNING` under the row lock is what
    // makes ten concurrent creators take ten distinct numbers; a read-then-write
    // hands two of them the same one and trips `tasks_project_number_unique`.
    const [project] = await tx
      .update(projects)
      .set({ taskCounter: sql`${projects.taskCounter} + 1` })
      .where(and(eq(projects.id, scope.projectId), isNull(projects.deletedAt)))
      .returning({ number: projects.taskCounter });
    if (!project) throw ApiError.notFound('Project not found');

    const available = await loadStatuses(tx, scope.projectId);
    const status =
      input.statusId === undefined
        ? defaultStatus(available)
        : requireStatus(available, input.statusId);

    assertSubtaskShape(input.type, input.parentId);
    if (input.epicId !== null) await assertEpic(tx, scope.projectId, input.epicId, null);
    if (input.parentId !== null) await assertParent(tx, scope.projectId, input.parentId, null);
    if (input.sprintId !== null) await assertSprintInProject(tx, scope.projectId, input.sprintId);
    await assertLabelsInProject(tx, scope.projectId, input.labelIds);
    await assertProjectVisibleUsers(tx, scope, [
      ...(input.assigneeId === null ? [] : [input.assigneeId]),
      ...input.watcherIds,
    ]);

    const boardBucket: RankBucket = {
      kind: 'board',
      projectId: scope.projectId,
      statusId: status.id,
    };
    const backlogBucket: RankBucket = {
      kind: 'backlog',
      projectId: scope.projectId,
      sprintId: input.sprintId,
    };
    // Both destinations, in one sorted acquisition — a create appends to a board
    // column AND to a backlog bucket, and two of these racing must not hand out
    // the same tail key twice. See `rank-rebalance.lockBuckets`.
    await lockBuckets(tx, boardBucket, backlogBucket);
    // Sequential, not `Promise.all`: the two reads now run under a lock we hold,
    // and a transaction is one connection anyway — the parallelism was never real.
    const boardRank = await appendRank(tx, boardBucket);
    const backlogRank = await appendRank(tx, backlogBucket);

    const resolvedAt = status.category === 'done' ? new Date() : null;

    const [created] = await tx
      .insert(tasks)
      .values({
        projectId: scope.projectId,
        number: project.number,
        title: input.title,
        description: input.description,
        type: input.type,
        statusId: status.id,
        priority: input.priority,
        assigneeId: input.assigneeId,
        reporterId: actor.userId,
        // Stored as given: `story_points` is `numeric(5,1)` and the shared
        // contract allows halves, so the rounding that used to sit here (an
        // `integer` column's cost) would now silently change a 0.5 estimate the
        // user deliberately typed.
        storyPoints: input.storyPoints,
        startDate: input.startDate,
        dueDate: input.dueDate,
        sprintId: input.sprintId,
        epicId: input.epicId,
        parentId: input.parentId,
        boardRank,
        backlogRank,
        resolvedAt,
      })
      .returning({ id: tasks.id });
    if (!created) throw ApiError.internal('Task insert returned no row');

    if (input.labelIds.length > 0) {
      await tx
        .insert(taskLabels)
        .values([...new Set(input.labelIds)].map((labelId) => ({ taskId: created.id, labelId })));
    }

    // The reporter always watches what they filed; explicit watchers join them.
    const watcherIds = [...new Set([actor.userId, ...input.watcherIds])];
    await tx
      .insert(taskWatchers)
      .values(watcherIds.map((userId) => ({ taskId: created.id, userId })))
      .onConflictDoNothing();

    await recordActivity(
      {
        projectId: scope.projectId,
        taskId: created.id,
        actorId: actor.userId,
        action: 'task.created',
        // The CFD report replays this stream; without the status it cannot know
        // which column a task was born in.
        newValue: { statusId: status.id, type: input.type },
      },
      tx,
    );

    return created.id;
  });

  const task = await loadTaskDetail(db, taskId);

  record(
    'task_created',
    { taskId: task.id, type: task.type },
    {
      userId: actor.userId,
      orgId: scope.orgId,
      projectId: scope.projectId,
    },
  );
  publishDomainEvent('task.created', {
    projectId: scope.projectId,
    actorId: actor.userId,
    originSocketId: actor.socketId,
    taskId: task.id,
    statusId: task.statusId,
    // The audience snapshot comes from the INPUT and the actor, not from the row
    // that was just re-read: both are what the transaction wrote, and a
    // reassignment committing in between must not redirect this event. See
    // `AudienceSnapshot` in `utils/domain-events.ts`.
    assigneeIdAtCommit: input.assigneeId,
    reporterIdAtCommit: actor.userId,
  });

  return task;
}

// ---------------------------------------------------------------------------
// Patch
// ---------------------------------------------------------------------------

interface PatchOutcome extends AudienceSnapshot {
  changedFields: string[];
  completed: boolean;
}

/** `PATCH /tasks/:taskId` — one activity row per field that actually moved. */
export async function patchTask(
  scope: ProjectScope,
  actor: TaskActor,
  taskId: string,
  input: PatchTaskInput,
): Promise<Task> {
  const outcome = await withTx<PatchOutcome>(async (tx) => {
    const current = await requireTaskRow(tx, taskId);
    const updates: Record<string, unknown> = {};
    const entries: ActivityEntry[] = [];
    const changedFields: string[] = [];
    let completed = false;

    const base = {
      projectId: scope.projectId,
      taskId,
      actorId: actor.userId,
    } as const;

    /** A plain field diff: `task.field_changed` with the column name. */
    const diff = <TValue>(field: string, next: TValue, previous: TValue): boolean => {
      if (next === previous) return false;
      updates[field] = next;
      changedFields.push(field);
      entries.push({
        ...base,
        action: 'task.field_changed',
        field,
        oldValue: previous,
        newValue: next,
      });
      return true;
    };

    if (input.title !== undefined) diff('title', input.title, current.title);
    if (input.description !== undefined) {
      diff('description', input.description, current.description);
    }
    if (input.priority !== undefined) diff('priority', input.priority, current.priority);
    // No rounding — `numeric(5,1)` stores the halves the contract allows.
    if (input.storyPoints !== undefined) {
      diff('storyPoints', input.storyPoints, current.storyPoints);
    }
    if (input.startDate !== undefined) diff('startDate', input.startDate, current.startDate);
    if (input.dueDate !== undefined) diff('dueDate', input.dueDate, current.dueDate);

    // ── Type / parent: validated together, because they are one fact ────────
    const nextType = input.type ?? current.type;
    const nextParentId = input.parentId === undefined ? current.parentId : input.parentId;
    if (input.type !== undefined || input.parentId !== undefined) {
      assertSubtaskShape(nextType, nextParentId);
      if (input.parentId !== undefined && input.parentId !== null) {
        await assertParent(tx, scope.projectId, input.parentId, taskId);
      }
    }
    if (input.type !== undefined) diff('type', input.type, current.type);
    if (input.parentId !== undefined) diff('parentId', input.parentId, current.parentId);

    if (input.epicId !== undefined) {
      if (input.epicId !== null) await assertEpic(tx, scope.projectId, input.epicId, taskId);
      diff('epicId', input.epicId, current.epicId);
    }

    if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
      if (input.assigneeId !== null) {
        await assertProjectVisibleUsers(tx, scope, [input.assigneeId]);
      }
      updates['assigneeId'] = input.assigneeId;
      changedFields.push('assigneeId');
      entries.push({
        ...base,
        action: 'task.assigned',
        field: 'assigneeId',
        oldValue: current.assigneeId,
        newValue: input.assigneeId,
      });
    }

    // ── Status / sprint: VALIDATED first, RE-RANKED second ──────────────────
    // The two halves are split because both of them append into a rank bucket,
    // and the bucket locks have to be taken together, in one sorted acquisition,
    // before either append reads a tail (`rank-rebalance.lockBuckets` explains
    // why the order matters). Validation therefore runs up front — which also
    // keeps the ORDER OF REFUSALS unchanged: a bad status still beats a bad
    // sprint.
    let statusChange: { from: StatusInfo; target: StatusInfo } | null = null;
    if (input.statusId !== undefined && input.statusId !== current.statusId) {
      const available = await loadStatuses(tx, scope.projectId);
      const from = requireStatus(available, current.statusId);
      const target = await validateStatusChange(tx, {
        projectId: scope.projectId,
        taskId,
        fromStatusId: current.statusId,
        toStatusId: input.statusId,
        available,
      });
      statusChange = { from, target };
    }

    // `undefined` is "not moving"; `null` is a real destination — the backlog.
    const nextSprintId =
      input.sprintId !== undefined && input.sprintId !== current.sprintId
        ? input.sprintId
        : undefined;
    if (nextSprintId !== undefined && nextSprintId !== null) {
      await assertSprintInProject(tx, scope.projectId, nextSprintId);
    }

    const rankBuckets: RankBucket[] = [];
    if (statusChange !== null) {
      rankBuckets.push({
        kind: 'board',
        projectId: scope.projectId,
        statusId: statusChange.target.id,
      });
    }
    if (nextSprintId !== undefined) {
      rankBuckets.push({ kind: 'backlog', projectId: scope.projectId, sprintId: nextSprintId });
    }
    if (rankBuckets.length > 0) await lockBuckets(tx, ...rankBuckets);

    if (statusChange !== null) {
      const { from, target } = statusChange;
      updates['statusId'] = target.id;
      // A status edit still has to land somewhere on the board; the end of the
      // target column is the only position a field editor can mean.
      updates['boardRank'] = await appendRank(
        tx,
        { kind: 'board', projectId: scope.projectId, statusId: target.id },
        taskId,
      );
      changedFields.push('statusId', 'boardRank');
      entries.push({
        ...base,
        action: 'task.status_changed',
        field: 'statusId',
        oldValue: current.statusId,
        newValue: target.id,
      });

      const resolution = resolutionFor(from.category, target.category, current.resolvedAt);
      if (resolution.changed) {
        updates['resolvedAt'] = resolution.resolvedAt;
        changedFields.push('resolvedAt');
      }
      completed = resolution.completed;
    }

    // ── Sprint: re-ranks into the tail of the destination bucket ────────────
    if (nextSprintId !== undefined) {
      updates['sprintId'] = nextSprintId;
      updates['backlogRank'] = await appendRank(
        tx,
        { kind: 'backlog', projectId: scope.projectId, sprintId: nextSprintId },
        taskId,
      );
      changedFields.push('sprintId', 'backlogRank');
      entries.push({
        ...base,
        action: 'task.moved_sprint',
        field: 'sprintId',
        oldValue: current.sprintId,
        newValue: nextSprintId,
      });
    }

    // ── Labels: a set diff, one activity row per label added or removed ─────
    if (input.labelIds !== undefined) {
      await assertLabelsInProject(tx, scope.projectId, input.labelIds);
      const existing = await tx
        .select({ labelId: taskLabels.labelId })
        .from(taskLabels)
        .where(eq(taskLabels.taskId, taskId));
      const before = new Set(existing.map((entry) => entry.labelId));
      const after = new Set(input.labelIds);
      const added = [...after].filter((id) => !before.has(id));
      const removed = [...before].filter((id) => !after.has(id));

      if (added.length > 0) {
        await tx
          .insert(taskLabels)
          .values(added.map((labelId) => ({ taskId, labelId })))
          .onConflictDoNothing();
      }
      if (removed.length > 0) {
        await tx
          .delete(taskLabels)
          .where(and(eq(taskLabels.taskId, taskId), inArray(taskLabels.labelId, removed)));
      }
      for (const labelId of added) {
        entries.push({ ...base, action: 'label.added', field: 'labelIds', newValue: labelId });
      }
      for (const labelId of removed) {
        entries.push({ ...base, action: 'label.removed', field: 'labelIds', oldValue: labelId });
      }
      if (added.length > 0 || removed.length > 0) changedFields.push('labelIds');
    }

    if (Object.keys(updates).length > 0) {
      await tx.update(tasks).set(updates).where(eq(tasks.id, taskId));
    } else if (changedFields.length > 0) {
      // Label-only edits still bump `updated_at` so `?updatedSince` sync sees it.
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, taskId));
    }
    await recordActivities(entries, tx);

    return {
      changedFields,
      completed,
      // The assignee AFTER this patch — `updates.assigneeId` when the patch set
      // one, otherwise the value the transaction read. Either way it is a value
      // from inside the transaction, which is the whole point.
      assigneeIdAtCommit: input.assigneeId === undefined ? current.assigneeId : input.assigneeId,
      reporterIdAtCommit: current.reporterId,
    };
  });

  const task = await loadTaskDetail(db, taskId);

  if (outcome.completed) {
    record(
      'task_completed',
      { taskId },
      {
        userId: actor.userId,
        orgId: scope.orgId,
        projectId: scope.projectId,
      },
    );
  }
  publishDomainEvent('task.updated', {
    projectId: scope.projectId,
    actorId: actor.userId,
    originSocketId: actor.socketId,
    taskId,
    changedFields: outcome.changedFields,
    assigneeIdAtCommit: outcome.assigneeIdAtCommit,
    reporterIdAtCommit: outcome.reporterIdAtCommit,
  });

  return task;
}

// ---------------------------------------------------------------------------
// Move / rank
// ---------------------------------------------------------------------------

/** `POST /tasks/:taskId/move` — the Kanban drop. */
export async function moveTask(
  scope: ProjectScope,
  actor: TaskActor,
  taskId: string,
  input: MoveTaskInput,
): Promise<MoveTaskResponse> {
  const result = await withTx(async (tx) => {
    const current = await requireTaskRow(tx, taskId);
    const available = await loadStatuses(tx, scope.projectId);
    const from = requireStatus(available, current.statusId);
    const target = await validateStatusChange(tx, {
      projectId: scope.projectId,
      taskId,
      fromStatusId: current.statusId,
      toStatusId: input.statusId,
      available,
    });

    const bucket: RankBucket = {
      kind: 'board',
      projectId: scope.projectId,
      statusId: target.id,
    };
    // THE SERIALIZATION POINT for a Kanban drop. Taken before the neighbour
    // reads and before the first write, so a second drop into the same gap
    // waits here and then reads a board that already contains the first one.
    await lockBuckets(tx, bucket);
    const computed = await computeRank(tx, bucket, taskId, {
      beforeTaskId: input.beforeTaskId,
      afterTaskId: input.afterTaskId,
    });

    // `clientRank` is a hint, never authority: it is honoured ONLY for an
    // append with no neighbours, and only when it still sorts past the current
    // tail. That turns the common "drop at the end" case into a no-op
    // re-render for the dragging client instead of a visible snap.
    let rank = computed.rank;
    if (
      input.clientRank !== undefined &&
      input.beforeTaskId === undefined &&
      input.afterTaskId === undefined
    ) {
      const tail = await tailRank(tx, bucket, taskId);
      if (tail === null || input.clientRank > tail) rank = input.clientRank;
    }

    const resolution = resolutionFor(from.category, target.category, current.resolvedAt);
    const updates: Record<string, unknown> = { statusId: target.id, boardRank: rank };
    if (resolution.changed) updates['resolvedAt'] = resolution.resolvedAt;
    // `.returning()` rather than a re-read: `updated_at` is maintained by
    // Drizzle's `$onUpdate` hook, so this statement is the only place the new
    // stamp exists before the row is committed — and it is the stamp the drop
    // broadcast is ordered by. A rebalance below does NOT bump it again: that
    // rewrite is raw SQL (`tx.execute`), which never runs `$onUpdate`, so the
    // value returned here stays authoritative for the whole transaction.
    const [written] = await tx
      .update(tasks)
      .set(updates)
      .where(eq(tasks.id, taskId))
      .returning({ updatedAt: tasks.updatedAt });
    if (!written) throw ApiError.internal('Move updated no task row');

    let rebalanced = false;
    if (computed.needsRebalance) {
      // The over-long key still sorts into the right slot, so the bucket is
      // already in its final order — the rewrite only renumbers it.
      const fresh = await rebalanceBucket(tx, bucket, taskId);
      if (fresh !== null) rank = fresh;
      rebalanced = true;
    }

    const statusChanged = target.id !== current.statusId;
    await recordActivity(
      {
        projectId: scope.projectId,
        taskId,
        actorId: actor.userId,
        ...(statusChanged
          ? {
              action: 'task.status_changed' as const,
              field: 'statusId',
              oldValue: current.statusId,
              newValue: target.id,
            }
          : {
              action: 'task.ranked' as const,
              field: 'boardRank',
              oldValue: current.boardRank,
              newValue: rank,
            }),
      },
      tx,
    );

    // `statusChanged` leaves the transaction because the domain event carries
    // it: it is the one fact about a drop that only this scope can establish
    // (`current.statusId` is gone by the time the event is published), and the
    // notification fan-out used to re-derive it by reading the activity row
    // written just above.
    return {
      rank,
      rebalanced,
      completed: resolution.completed,
      statusId: target.id,
      statusChanged,
      // The version stamp this transaction wrote — see the `.returning()` above
      // and `taskMovedPayloadSchema`. Serialized here, where the `Date` is still
      // in scope, so the bus carries the same ISO string the wire schema wants.
      updatedAt: written.updatedAt.toISOString(),
      // A drop changes neither of these, so the row `requireTaskRow` read at the
      // top of the transaction IS the committed audience.
      assigneeIdAtCommit: current.assigneeId,
      reporterIdAtCommit: current.reporterId,
    };
  });

  const task = await loadTaskDetail(db, taskId);

  record(
    'task_moved',
    { taskId, statusId: result.statusId },
    {
      userId: actor.userId,
      orgId: scope.orgId,
      projectId: scope.projectId,
    },
  );
  if (result.completed) {
    record(
      'task_completed',
      { taskId },
      {
        userId: actor.userId,
        orgId: scope.orgId,
        projectId: scope.projectId,
      },
    );
  }
  publishDomainEvent('task.moved', {
    projectId: scope.projectId,
    actorId: actor.userId,
    originSocketId: actor.socketId,
    taskId,
    statusId: result.statusId,
    boardRank: result.rank,
    rebalanced: result.rebalanced,
    updatedAt: result.updatedAt,
    statusChanged: result.statusChanged,
    assigneeIdAtCommit: result.assigneeIdAtCommit,
    reporterIdAtCommit: result.reporterIdAtCommit,
  });

  return { task, rebalanced: result.rebalanced };
}

/** `POST /tasks/:taskId/rank` — the backlog / sprint reorder. */
export async function rankTask(
  scope: ProjectScope,
  actor: TaskActor,
  taskId: string,
  input: RankTaskInput,
): Promise<MoveTaskResponse> {
  const result = await withTx(async (tx) => {
    const current = await requireTaskRow(tx, taskId);
    if (input.sprintId !== null && input.sprintId !== current.sprintId) {
      await assertSprintInProject(tx, scope.projectId, input.sprintId);
    }

    const bucket: RankBucket = {
      kind: 'backlog',
      projectId: scope.projectId,
      sprintId: input.sprintId,
    };
    // Same serialization point as the board drop, one bucket over.
    await lockBuckets(tx, bucket);
    const computed = await computeRank(tx, bucket, taskId, {
      beforeTaskId: input.beforeTaskId,
      afterTaskId: input.afterTaskId,
    });

    const sprintChanged = input.sprintId !== current.sprintId;
    await tx
      .update(tasks)
      .set({ sprintId: input.sprintId, backlogRank: computed.rank })
      .where(eq(tasks.id, taskId));

    let rank = computed.rank;
    let rebalanced = false;
    if (computed.needsRebalance) {
      const fresh = await rebalanceBucket(tx, bucket, taskId);
      if (fresh !== null) rank = fresh;
      rebalanced = true;
    }

    const entries: ActivityEntry[] = [
      {
        projectId: scope.projectId,
        taskId,
        actorId: actor.userId,
        action: 'task.ranked',
        field: 'backlogRank',
        oldValue: current.backlogRank,
        newValue: rank,
      },
    ];
    if (sprintChanged) {
      entries.unshift({
        projectId: scope.projectId,
        taskId,
        actorId: actor.userId,
        action: 'task.moved_sprint',
        field: 'sprintId',
        oldValue: current.sprintId,
        newValue: input.sprintId,
      });
    }
    await recordActivities(entries, tx);

    return {
      rebalanced,
      sprintChanged,
      assigneeIdAtCommit: current.assigneeId,
      reporterIdAtCommit: current.reporterId,
    };
  });

  const task = await loadTaskDetail(db, taskId);

  publishDomainEvent('task.updated', {
    projectId: scope.projectId,
    actorId: actor.userId,
    originSocketId: actor.socketId,
    taskId,
    changedFields: result.sprintChanged ? ['sprintId', 'backlogRank'] : ['backlogRank'],
    assigneeIdAtCommit: result.assigneeIdAtCommit,
    reporterIdAtCommit: result.reporterIdAtCommit,
  });

  return { task, rebalanced: result.rebalanced };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * `DELETE /tasks/:taskId` — soft, and it takes the subtasks with it.
 *
 * The `parent_id` FK is `ON DELETE CASCADE` for the hard-delete case, but a
 * soft delete is an UPDATE the database cannot cascade, so the subtask sweep is
 * explicit and shares the transaction.
 */
export async function deleteTask(
  scope: ProjectScope,
  actor: TaskActor,
  taskId: string,
): Promise<void> {
  const deletedIds = await withTx(async (tx) => {
    await requireTaskRow(tx, taskId);
    const now = new Date();

    const subtasks = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.parentId, taskId), isNull(tasks.deletedAt)));

    const ids = [taskId, ...subtasks.map((subtask) => subtask.id)];
    await tx.update(tasks).set({ deletedAt: now }).where(inArray(tasks.id, ids));

    await recordActivities(
      ids.map((id) => ({
        projectId: scope.projectId,
        taskId: id,
        actorId: actor.userId,
        action: 'task.deleted' as const,
      })),
      tx,
    );

    return ids;
  });

  for (const id of deletedIds) {
    publishDomainEvent('task.deleted', {
      projectId: scope.projectId,
      actorId: actor.userId,
      originSocketId: actor.socketId,
      taskId: id,
    });
  }
}

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------

/** What the watcher endpoints answer with — there is no shared contract yet. */
export interface WatchState {
  taskId: string;
  userId: string;
  watching: boolean;
  isMuted: boolean;
}

/** `PUT /tasks/:taskId/watchers/me` — idempotent self-subscribe. */
export async function watchTask(
  scope: ProjectScope,
  actor: TaskActor,
  taskId: string,
  isMuted: boolean,
): Promise<WatchState> {
  return withTx(async (tx) => {
    await requireTaskRow(tx, taskId);
    const [existing] = await tx
      .select({ isMuted: taskWatchers.isMuted })
      .from(taskWatchers)
      .where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.userId, actor.userId)))
      .limit(1);

    await tx
      .insert(taskWatchers)
      .values({ taskId, userId: actor.userId, isMuted })
      .onConflictDoUpdate({
        target: [taskWatchers.taskId, taskWatchers.userId],
        set: { isMuted },
      });

    // Only a NEW subscription is history; toggling mute is a preference.
    if (!existing) {
      await recordActivity(
        {
          projectId: scope.projectId,
          taskId,
          actorId: actor.userId,
          action: 'watcher.added',
          newValue: actor.userId,
        },
        tx,
      );
    }

    return { taskId, userId: actor.userId, watching: true, isMuted };
  });
}

/** `DELETE /tasks/:taskId/watchers/me`. */
export async function unwatchTask(
  scope: ProjectScope,
  actor: TaskActor,
  taskId: string,
): Promise<WatchState> {
  return withTx(async (tx) => {
    await requireTaskRow(tx, taskId);
    const removed = await tx
      .delete(taskWatchers)
      .where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.userId, actor.userId)))
      .returning({ userId: taskWatchers.userId });

    if (removed.length > 0) {
      await recordActivity(
        {
          projectId: scope.projectId,
          taskId,
          actorId: actor.userId,
          action: 'watcher.removed',
          oldValue: actor.userId,
        },
        tx,
      );
    }

    return { taskId, userId: actor.userId, watching: false, isMuted: false };
  });
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

/**
 * `GET /projects/:projectId/dependencies` — every `blocks` edge in the project.
 *
 * WHY THE JOIN IS DOUBLE. A dependency row has two foreign keys and either end
 * may have been soft-deleted since the edge was written, so BOTH must be joined
 * and both checked for `deleted_at IS NULL`. Joining only the blocker (as the
 * cycle walk above does — it only needs reachability within one project) would
 * hand the Roadmap arrows pointing at rows it is not drawing.
 *
 * The project is established from the blocker's row. An edge cannot span two
 * projects — `addDependency` refuses that — so one side is enough to scope by,
 * and the second join is a filter rather than a second scope check.
 *
 * Unpaginated by contract; see {@link projectDependenciesResponseSchema}.
 */
export async function listProjectDependencies(
  scope: ProjectScope,
  executor: Executor = db,
): Promise<ProjectDependenciesResponse> {
  const blockedTask = alias(tasks, 'blocked_task');

  const rows = await executor
    .select({
      blockerTaskId: taskDependencies.blockerTaskId,
      blockedTaskId: taskDependencies.blockedTaskId,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.blockerTaskId, tasks.id))
    .innerJoin(blockedTask, eq(taskDependencies.blockedTaskId, blockedTask.id))
    .where(
      and(
        eq(tasks.projectId, scope.projectId),
        isNull(tasks.deletedAt),
        isNull(blockedTask.deletedAt),
      ),
    );

  return { edges: rows };
}

/** How deep the cycle walk goes before it gives up and refuses the edge. */
const MAX_DEPENDENCY_DEPTH = 100;

/**
 * Refuse an edge that would close a `blocks` cycle.
 *
 * Postgres cannot express this constraint, so it is a breadth-first walk of the
 * project's edge set: if `blockedTaskId` can already reach `blockerTaskId` by
 * following blocker→blocked, adding this edge closes a loop and nothing in it
 * could ever start.
 */
async function assertNoDependencyCycle(
  executor: Executor,
  projectId: string,
  blockerTaskId: string,
  blockedTaskId: string,
): Promise<void> {
  const edges = await executor
    .select({
      blockerTaskId: taskDependencies.blockerTaskId,
      blockedTaskId: taskDependencies.blockedTaskId,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(taskDependencies.blockerTaskId, tasks.id))
    .where(eq(tasks.projectId, projectId));

  const successors = new Map<string, string[]>();
  for (const edge of edges) {
    const list = successors.get(edge.blockerTaskId);
    if (list === undefined) successors.set(edge.blockerTaskId, [edge.blockedTaskId]);
    else list.push(edge.blockedTaskId);
  }

  const seen = new Set<string>([blockedTaskId]);
  let frontier = [blockedTaskId];
  for (let depth = 0; depth < MAX_DEPENDENCY_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const child of successors.get(node) ?? []) {
        if (child === blockerTaskId) {
          throw new ApiError(
            409,
            'dependency_cycle',
            'That dependency would create a cycle of blocked tasks',
          );
        }
        if (!seen.has(child)) {
          seen.add(child);
          next.push(child);
        }
      }
    }
    frontier = next;
  }
}

/** The shape both directions of `POST /tasks/:taskId/dependencies` resolve to. */
export interface DependencyInput {
  blockerTaskId?: string | undefined;
  blockedTaskId?: string | undefined;
}

/** `POST /tasks/:taskId/dependencies`. */
export async function addDependency(
  scope: ProjectScope,
  actor: TaskActor,
  taskId: string,
  input: DependencyInput,
): Promise<Task> {
  const otherId = input.blockerTaskId ?? input.blockedTaskId;
  if (otherId === undefined) {
    throw ApiError.badRequest('Provide exactly one of blockerTaskId / blockedTaskId');
  }
  if (input.blockerTaskId !== undefined && input.blockedTaskId !== undefined) {
    throw ApiError.badRequest('Provide exactly one of blockerTaskId / blockedTaskId');
  }
  if (otherId === taskId) throw ApiError.badRequest('A task cannot block itself');

  const blockerTaskId = input.blockerTaskId ?? taskId;
  const blockedTaskId = input.blockedTaskId ?? taskId;

  await withTx(async (tx) => {
    await requireTaskRow(tx, taskId);
    const other = await requireTaskRow(tx, otherId);
    if (other.projectId !== scope.projectId) {
      throw ApiError.badRequest('Both tasks must belong to the same project');
    }

    const [duplicate] = await tx
      .select({ id: taskDependencies.id })
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.blockerTaskId, blockerTaskId),
          eq(taskDependencies.blockedTaskId, blockedTaskId),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new ApiError(409, 'dependency_exists', 'That dependency already exists');
    }

    await assertNoDependencyCycle(tx, scope.projectId, blockerTaskId, blockedTaskId);

    try {
      await tx.insert(taskDependencies).values({
        blockerTaskId,
        blockedTaskId,
        createdById: actor.userId,
      });
    } catch (error) {
      // The SELECT above is the fast path for a good message; the
      // `(blocker, blocked)` unique index is the arbiter. Two clients linking
      // the same pair at once both read "free", and the loser must get the SAME
      // 409 the pre-check produces — not a raw `23505` rendered as a 500.
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'dependency_exists', 'That dependency already exists');
      }
      throw error;
    }

    await recordActivities(
      [
        {
          projectId: scope.projectId,
          taskId: blockedTaskId,
          actorId: actor.userId,
          action: 'dependency.added',
          field: 'blockers',
          newValue: blockerTaskId,
        },
        {
          projectId: scope.projectId,
          taskId: blockerTaskId,
          actorId: actor.userId,
          action: 'dependency.added',
          field: 'blocked',
          newValue: blockedTaskId,
        },
      ],
      tx,
    );
  });

  publishTaskUpdated(scope, actor, blockerTaskId, ['dependencies']);
  publishTaskUpdated(scope, actor, blockedTaskId, ['dependencies']);

  return loadTaskDetail(db, taskId);
}

/**
 * `DELETE /tasks/:taskId/dependencies/:otherTaskId`.
 *
 * ADDRESSED BY THE PAIR OF TASKS, not by the dependency row's id, because the
 * row id never crosses the wire: `taskSchema.dependencies` expands each edge as
 * a `TaskRef`, whose `id` is the TASK. A row-id route would have been
 * unreachable from the only UI that calls it.
 *
 * The direction is not part of the address either — `(blocker, blocked)` is
 * unique and the cycle check refuses the mirrored edge, so at most one row can
 * connect the two tasks and "unlink these two" is unambiguous whichever end the
 * user clicked from.
 */
export async function removeDependency(
  scope: ProjectScope,
  actor: TaskActor,
  taskId: string,
  otherTaskId: string,
): Promise<void> {
  const affected = await withTx(async (tx) => {
    await requireTaskRow(tx, taskId);
    const [row] = await tx
      .select({
        id: taskDependencies.id,
        blockerTaskId: taskDependencies.blockerTaskId,
        blockedTaskId: taskDependencies.blockedTaskId,
      })
      .from(taskDependencies)
      .where(
        or(
          and(
            eq(taskDependencies.blockerTaskId, taskId),
            eq(taskDependencies.blockedTaskId, otherTaskId),
          ),
          and(
            eq(taskDependencies.blockerTaskId, otherTaskId),
            eq(taskDependencies.blockedTaskId, taskId),
          ),
        ),
      )
      .limit(1);
    if (!row) throw ApiError.notFound('Dependency not found');

    await tx.delete(taskDependencies).where(eq(taskDependencies.id, row.id));
    await recordActivities(
      [
        {
          projectId: scope.projectId,
          taskId: row.blockedTaskId,
          actorId: actor.userId,
          action: 'dependency.removed',
          field: 'blockers',
          oldValue: row.blockerTaskId,
        },
        {
          projectId: scope.projectId,
          taskId: row.blockerTaskId,
          actorId: actor.userId,
          action: 'dependency.removed',
          field: 'blocked',
          oldValue: row.blockedTaskId,
        },
      ],
      tx,
    );

    return row;
  });

  publishTaskUpdated(scope, actor, affected.blockerTaskId, ['dependencies']);
  publishTaskUpdated(scope, actor, affected.blockedTaskId, ['dependencies']);
}

/**
 * Publish `task.updated` for a task this request changed indirectly (a
 * dependency edge, a confirmed attachment). Reads the audience columns so the
 * notification subscriber does not have to.
 *
 * THE ONE PUBLISHER WHOSE SNAPSHOT IS A RE-READ, and the exception proves the
 * rule: these callers changed a JOIN TABLE, not the task, so there is no
 * transaction that held `tasks.assignee_id` in scope to snapshot from. It is
 * also the safest place for the read to be late — `changedFields` here is
 * `['dependencies']` or `['attachments']`, and `handleTaskUpdated` notifies on
 * none of those, so nothing downstream derives an audience from it today.
 *
 * `isNull(deletedAt)` matters even so: every other read in this file filters
 * soft-deleted rows, and without it a task deleted between the mutation and
 * this read publishes a stale assignee for a task that no longer exists.
 */
export function publishTaskUpdated(
  scope: ProjectScope,
  actor: TaskActor,
  taskId: string,
  changedFields: readonly string[],
): void {
  void db
    .select({ assigneeId: tasks.assigneeId, reporterId: tasks.reporterId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1)
    .then((rows) => {
      publishDomainEvent('task.updated', {
        projectId: scope.projectId,
        actorId: actor.userId,
        originSocketId: actor.socketId,
        taskId,
        changedFields,
        assigneeIdAtCommit: rows[0]?.assigneeId ?? null,
        reporterIdAtCommit: rows[0]?.reporterId ?? null,
      });
    })
    .catch(() => {
      // Publishing is best-effort; a failed read must not fail the mutation
      // that already committed.
    });
}

/** Re-exported so sibling services share one status vocabulary. */
export { loadStatuses, requireStatus };
export type { StatusInfo, TaskRow };
