/**
 * The workflow rules that guard EVERY status change — the board drop
 * (`POST /tasks/:taskId/move`) and the field edit (`PATCH /tasks/:taskId`)
 * alike.
 *
 * The two entry points exist because they are different gestures, but they must
 * never be different rules: a column a drag cannot reach must not be reachable
 * by editing the status field in the detail sheet. Everything both paths share
 * lives here — status lookup, the transition whitelist, the WIP ceiling and the
 * `resolved_at` stamp — and `tasks.service.ts` calls it from both.
 *
 * Layering: this module reads the database directly (it is a service) and
 * knows nothing about HTTP beyond throwing `ApiError`.
 */
import { and, asc, count, eq, isNull, ne } from 'drizzle-orm';
import type { StatusCategory } from '@flowboard/shared';

import { statuses, tasks, workflowTransitions, type Db, type Tx } from '../db';
import { ApiError } from '../utils/api-error';

type Executor = Db | Tx;

/** The slice of a `statuses` row every rule in this module needs. */
export interface StatusInfo {
  id: string;
  name: string;
  category: StatusCategory;
  position: number;
  wipLimit: number | null;
}

/** Every board column of a project, in board order. */
export async function loadStatuses(executor: Executor, projectId: string): Promise<StatusInfo[]> {
  return executor
    .select({
      id: statuses.id,
      name: statuses.name,
      category: statuses.category,
      position: statuses.position,
      wipLimit: statuses.wipLimit,
    })
    .from(statuses)
    .where(eq(statuses.projectId, projectId))
    .orderBy(asc(statuses.position), asc(statuses.id));
}

/**
 * Narrow a client-supplied status id to a column of THIS project.
 *
 * A 400 rather than a 404: the id is a request field, and a status that belongs
 * to somebody else's project is a malformed request, not a missing resource.
 */
export function requireStatus(available: readonly StatusInfo[], statusId: string): StatusInfo {
  const status = available.find((candidate) => candidate.id === statusId);
  if (!status) throw ApiError.badRequest('Status does not belong to this project');
  return status;
}

/**
 * Where a task lands when the caller names no status: the first `todo` column,
 * falling back to the leftmost column of any category (a workflow may have been
 * edited down to none).
 */
export function defaultStatus(available: readonly StatusInfo[]): StatusInfo {
  const todo = available.find((status) => status.category === 'todo');
  const fallback = todo ?? available[0];
  if (!fallback) throw ApiError.badRequest('This project has no board columns');
  return fallback;
}

/**
 * Enforce the transition whitelist.
 *
 * SEMANTICS (workflow.schema.ts, normative): **zero rows for a source status
 * means every target is allowed**; one or more rows make that set exhaustive.
 * That is what lets a fresh project be fully open with no rows at all, and why
 * this asks "are there any rows FROM here" before it asks "is this pair here".
 *
 * A move to the SAME status is never a transition (it is a reorder) and is
 * always allowed.
 */
export async function assertTransitionAllowed(
  executor: Executor,
  projectId: string,
  fromStatusId: string,
  toStatusId: string,
): Promise<void> {
  if (fromStatusId === toStatusId) return;

  const rows = await executor
    .select({ toStatusId: workflowTransitions.toStatusId })
    .from(workflowTransitions)
    .where(
      and(
        eq(workflowTransitions.projectId, projectId),
        eq(workflowTransitions.fromStatusId, fromStatusId),
      ),
    );

  if (rows.length === 0) return;
  if (rows.some((row) => row.toStatusId === toStatusId)) return;

  throw new ApiError(
    409,
    'transition_not_allowed',
    'That status change is not allowed by this project workflow',
  );
}

/**
 * Enforce the target column's WIP limit.
 *
 * The moving task is excluded from the count, and a move WITHIN a column is
 * exempt entirely — a reorder cannot make a column more crowded than it already
 * is, and refusing it would strand a team that is sitting on its own limit.
 */
export async function assertWipCapacity(
  executor: Executor,
  projectId: string,
  target: StatusInfo,
  movingTaskId: string,
  fromStatusId: string,
): Promise<void> {
  if (target.wipLimit === null) return;
  if (target.id === fromStatusId) return;

  const [row] = await executor
    .select({ value: count() })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.statusId, target.id),
        isNull(tasks.deletedAt),
        ne(tasks.id, movingTaskId),
      ),
    );

  const current = row?.value ?? 0;
  if (current >= target.wipLimit) {
    throw new ApiError(
      409,
      'wip_limit_exceeded',
      `"${target.name}" is at its WIP limit of ${String(target.wipLimit)}`,
      { statusId: target.id, wipLimit: target.wipLimit, current },
    );
  }
}

/** What entering (or leaving) a `done` column does to `resolved_at`. */
export interface ResolutionChange {
  /** The value to write, when `changed` is true. */
  resolvedAt: Date | null;
  changed: boolean;
  /** True only on the todo/in_progress -> done edge; drives `task_completed`. */
  completed: boolean;
}

/**
 * Decide the `resolved_at` stamp for a status change.
 *
 * Keyed off the status CATEGORY, never the name — a project is free to call its
 * done column "Shipped", and every report reads the category.
 */
export function resolutionFor(
  previous: StatusCategory,
  next: StatusCategory,
  currentResolvedAt: Date | null,
  now: Date = new Date(),
): ResolutionChange {
  const wasDone = previous === 'done';
  const isDone = next === 'done';

  if (isDone && !wasDone) return { resolvedAt: now, changed: true, completed: true };
  if (!isDone && wasDone) return { resolvedAt: null, changed: true, completed: false };
  // Re-entering done from another done column keeps the original stamp; a task
  // that somehow sits in done without one gets it now.
  if (isDone && currentResolvedAt === null) {
    return { resolvedAt: now, changed: true, completed: false };
  }
  return { resolvedAt: currentResolvedAt, changed: false, completed: false };
}

/**
 * The whole rule set for one status change, in the order both callers need it.
 *
 * Returns the target column so the caller can compute the new board rank
 * against it without re-reading the row.
 */
export async function validateStatusChange(
  executor: Executor,
  params: {
    projectId: string;
    taskId: string;
    fromStatusId: string;
    toStatusId: string;
    available: readonly StatusInfo[];
  },
): Promise<StatusInfo> {
  const target = requireStatus(params.available, params.toStatusId);
  await assertTransitionAllowed(executor, params.projectId, params.fromStatusId, params.toStatusId);
  await assertWipCapacity(executor, params.projectId, target, params.taskId, params.fromStatusId);
  return target;
}
