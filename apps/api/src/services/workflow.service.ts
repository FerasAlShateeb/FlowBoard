/**
 * Per-project workflow: the board's columns and the whitelist of moves between
 * them.
 *
 * Every mutation in this file does the same three things in the same order:
 * write inside `withTx`, append a `workflow.changed` audit row in that SAME
 * transaction, and — only after it commits — `publishDomainEvent`. The order
 * matters: publishing before the commit would let the realtime layer broadcast
 * a workflow that then rolled back, and every open board would render columns
 * that do not exist.
 *
 * `workflow:changed` ships the ENTIRE workflow to the browser, so the event
 * itself carries only the internal `change` discriminator; subscribers re-read.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Status, StatusCategory, Transition, TransitionEdge } from '@flowboard/shared';
import { rankBetween } from '@flowboard/shared';

import { db, statuses, tasks, withTx, workflowTransitions } from '../db';
import type { Tx } from '../db';
import { ApiError } from '../utils/api-error';
import { publishDomainEvent } from '../utils/domain-events';
import { recordActivity } from './activity.service';
import { isForeignKeyViolation, isUniqueViolation } from './pg-errors';
import type { ActorContext } from './projects.service';

interface StatusColumnRow {
  id: string;
  projectId: string;
  name: string;
  category: StatusCategory;
  color: string;
  position: number;
  wipLimit: number | null;
}

function toStatus(row: StatusColumnRow): Status {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    category: row.category,
    color: row.color,
    position: row.position,
    wipLimit: row.wipLimit,
  };
}

function toTransition(row: {
  id: string;
  projectId: string;
  fromStatusId: string;
  toStatusId: string;
}): Transition {
  return {
    id: row.id,
    projectId: row.projectId,
    fromStatusId: row.fromStatusId,
    toStatusId: row.toStatusId,
  };
}

/**
 * One place to announce a workflow edit, so no mutation can forget half of it.
 * Exported because labels are part of the same `change` union and their service
 * announces through here too.
 */
export function announceWorkflowChange(
  projectId: string,
  context: ActorContext,
  change: 'statuses' | 'transitions' | 'labels',
): void {
  publishDomainEvent('workflow.changed', {
    projectId,
    actorId: context.actorId,
    originSocketId: context.socketId,
    change,
  });
}

/**
 * The `workflow.changed` audit row. Exported because labels are part of the same
 * `change` union and their service records identical entries.
 */
export async function recordWorkflowChange(
  tx: Tx,
  projectId: string,
  context: ActorContext,
  field: string,
  oldValue: unknown,
  newValue: unknown,
): Promise<void> {
  await recordActivity(
    { projectId, actorId: context.actorId, action: 'workflow.changed', field, oldValue, newValue },
    tx,
  );
}

/** `GET /projects/:projectId/statuses` — any project viewer, board order. */
export async function listStatuses(projectId: string): Promise<Status[]> {
  const rows = await db
    .select()
    .from(statuses)
    .where(eq(statuses.projectId, projectId))
    .orderBy(asc(statuses.position), asc(statuses.name));
  return rows.map(toStatus);
}

/** `GET /projects/:projectId/transitions` — any project viewer. */
export async function listTransitions(projectId: string): Promise<Transition[]> {
  const rows = await db
    .select()
    .from(workflowTransitions)
    .where(eq(workflowTransitions.projectId, projectId));
  return rows.map(toTransition);
}

async function requireStatus(projectId: string, statusId: string): Promise<StatusColumnRow> {
  const [row] = await db
    .select()
    .from(statuses)
    .where(and(eq(statuses.id, statusId), eq(statuses.projectId, projectId)))
    .limit(1);
  if (!row) throw ApiError.notFound('Status not found');
  return row;
}

/**
 * `POST /projects/:projectId/statuses` — project admin.
 *
 * New columns are appended (`position = max + 1`) rather than inserted:
 * reordering is a separate, whole-set operation, so create never has to shuffle
 * its neighbours.
 */
export async function createStatus(
  projectId: string,
  input: { name: string; category: StatusCategory; color: string; wipLimit: number | null },
  context: ActorContext,
): Promise<Status> {
  const created = await withTx(async (tx) => {
    const [highest] = await tx
      .select({ max: sql<number | null>`max(${statuses.position})` })
      .from(statuses)
      .where(eq(statuses.projectId, projectId));

    let row: StatusColumnRow | undefined;
    try {
      [row] = await tx
        .insert(statuses)
        .values({
          projectId,
          name: input.name,
          category: input.category,
          color: input.color,
          wipLimit: input.wipLimit,
          position: (highest?.max ?? -1) + 1,
        })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('A status with that name already exists in this project');
      }
      throw error;
    }
    if (!row) throw ApiError.internal('Status insert returned no row');

    await recordWorkflowChange(tx, projectId, context, 'status', null, {
      id: row.id,
      name: row.name,
      category: row.category,
    });
    return row;
  });

  announceWorkflowChange(projectId, context, 'statuses');
  return toStatus(created);
}

/** `PATCH /projects/:projectId/statuses/:statusId` — project admin. */
export async function updateStatus(
  projectId: string,
  statusId: string,
  input: { name?: string; category?: StatusCategory; color?: string; wipLimit?: number | null },
  context: ActorContext,
): Promise<Status> {
  const current = await requireStatus(projectId, statusId);

  const updated = await withTx(async (tx) => {
    let row: StatusColumnRow | undefined;
    try {
      [row] = await tx
        .update(statuses)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.category === undefined ? {} : { category: input.category }),
          ...(input.color === undefined ? {} : { color: input.color }),
          ...(input.wipLimit === undefined ? {} : { wipLimit: input.wipLimit }),
        })
        .where(and(eq(statuses.id, statusId), eq(statuses.projectId, projectId)))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('A status with that name already exists in this project');
      }
      throw error;
    }
    if (!row) throw ApiError.notFound('Status not found');

    await recordWorkflowChange(
      tx,
      projectId,
      context,
      'status',
      {
        id: current.id,
        name: current.name,
        category: current.category,
        wipLimit: current.wipLimit,
      },
      { id: row.id, name: row.name, category: row.category, wipLimit: row.wipLimit },
    );
    return row;
  });

  announceWorkflowChange(projectId, context, 'statuses');
  return toStatus(updated);
}

/**
 * `DELETE /projects/:projectId/statuses/:statusId` — project admin.
 *
 * `tasks.status_id` is `ON DELETE RESTRICT`, so a column holding work cannot
 * simply disappear. When it does hold work the caller must name `moveTasksTo`
 * and the tasks are relocated inside the SAME transaction as the delete.
 *
 * **Rank strategy (deliberately simple).** Every moved task is appended to the
 * tail of the target column: read that column's greatest `board_rank` once, then
 * chain `rankBetween(prev, null)` for each task. Relative order among the moved
 * tasks is preserved, existing cards are untouched, and no rebalance is needed —
 * a "merge into" is a rare admin action, not the drag path that fractional
 * indexing is tuned for.
 */
export async function deleteStatus(
  projectId: string,
  statusId: string,
  moveTasksTo: string | undefined,
  context: ActorContext,
): Promise<void> {
  const status = await requireStatus(projectId, statusId);

  await withTx(async (tx) => {
    const remaining = await tx
      .select({ id: statuses.id })
      .from(statuses)
      .where(eq(statuses.projectId, projectId));
    if (remaining.length <= 1) {
      throw ApiError.conflict('A project must keep at least one status');
    }

    // Soft-deleted tasks still hold the FK, so they are counted and moved too.
    const held = await tx
      .select({ id: tasks.id, boardRank: tasks.boardRank, resolvedAt: tasks.resolvedAt })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.statusId, statusId)))
      .orderBy(asc(tasks.boardRank));

    if (held.length > 0) {
      if (moveTasksTo === undefined) {
        throw ApiError.conflict('Choose a status to move the tasks in this column to', {
          taskCount: held.length,
        });
      }
      if (moveTasksTo === statusId) {
        throw ApiError.badRequest('Tasks cannot be moved into the status being deleted');
      }

      const [target] = await tx
        .select({ id: statuses.id, category: statuses.category })
        .from(statuses)
        .where(and(eq(statuses.id, moveTasksTo), eq(statuses.projectId, projectId)))
        .limit(1);
      if (!target) throw ApiError.badRequest('moveTasksTo must be a status in this project');

      const [tail] = await tx
        .select({ max: sql<string | null>`max(${tasks.boardRank})` })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), eq(tasks.statusId, moveTasksTo)));

      let previous = tail?.max ?? null;
      const now = new Date();
      for (const task of held) {
        const boardRank = rankBetween(previous, null);
        previous = boardRank;
        await tx
          .update(tasks)
          .set({
            statusId: moveTasksTo,
            boardRank,
            // Keep `resolved_at` truthful: it means "is in a done column".
            resolvedAt: target.category === 'done' ? (task.resolvedAt ?? now) : null,
          })
          .where(eq(tasks.id, task.id));
      }
    }

    try {
      await tx
        .delete(statuses)
        .where(and(eq(statuses.id, statusId), eq(statuses.projectId, projectId)));
    } catch (error) {
      // Backstop for the race the count above cannot close: a task created into
      // this column between the read and the delete.
      if (isForeignKeyViolation(error)) {
        throw ApiError.conflict('That status still holds tasks');
      }
      throw error;
    }

    await recordWorkflowChange(
      tx,
      projectId,
      context,
      'status',
      { id: status.id, name: status.name, category: status.category },
      null,
    );
  });

  announceWorkflowChange(projectId, context, 'statuses');
}

/**
 * `PUT /projects/:projectId/statuses/order` — project admin, whole-set.
 *
 * The list must be EXACTLY the project's current status set. A stale drag that
 * omits a column added a second ago is rejected rather than silently applied,
 * which is the whole reason the order API is a whole-set PUT.
 */
export async function reorderStatuses(
  projectId: string,
  statusIds: readonly string[],
  context: ActorContext,
): Promise<Status[]> {
  await withTx(async (tx) => {
    const rows = await tx
      .select({ id: statuses.id })
      .from(statuses)
      .where(eq(statuses.projectId, projectId));

    const current = new Set(rows.map((row) => row.id));
    const next = new Set(statusIds);
    const sameSize = next.size === statusIds.length && next.size === current.size;
    const sameMembers = sameSize && [...next].every((id) => current.has(id));
    if (!sameMembers) {
      throw ApiError.validation('statusIds must list every status of this project exactly once', {
        expected: [...current],
      });
    }

    for (const [position, id] of statusIds.entries()) {
      await tx
        .update(statuses)
        .set({ position })
        .where(and(eq(statuses.id, id), eq(statuses.projectId, projectId)));
    }

    await recordWorkflowChange(tx, projectId, context, 'statusOrder', null, [...statusIds]);
  });

  announceWorkflowChange(projectId, context, 'statuses');
  return listStatuses(projectId);
}

/**
 * `PUT /projects/:projectId/transitions` — project admin, whole-set replace.
 *
 * Duplicate edges are collapsed instead of rejected: the payload describes a
 * graph, and naming the same edge twice says nothing different. Self-loops are
 * already rejected by the shared schema (a same-column reorder is not a
 * transition).
 */
export async function replaceTransitions(
  projectId: string,
  edges: readonly TransitionEdge[],
  context: ActorContext,
): Promise<Transition[]> {
  const unique = new Map<string, TransitionEdge>();
  for (const edge of edges) unique.set(`${edge.fromStatusId}->${edge.toStatusId}`, edge);
  const wanted = [...unique.values()];

  await withTx(async (tx) => {
    if (wanted.length > 0) {
      const referenced = [
        ...new Set(wanted.flatMap((edge) => [edge.fromStatusId, edge.toStatusId])),
      ];
      const rows = await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(and(eq(statuses.projectId, projectId), inArray(statuses.id, referenced)));
      const known = new Set(rows.map((row) => row.id));
      const strangers = referenced.filter((id) => !known.has(id));
      if (strangers.length > 0) {
        throw ApiError.badRequest('Every transition must reference statuses of this project', {
          statusIds: strangers,
        });
      }
    }

    await tx.delete(workflowTransitions).where(eq(workflowTransitions.projectId, projectId));
    if (wanted.length > 0) {
      await tx.insert(workflowTransitions).values(
        wanted.map((edge) => ({
          projectId,
          fromStatusId: edge.fromStatusId,
          toStatusId: edge.toStatusId,
        })),
      );
    }

    await recordWorkflowChange(tx, projectId, context, 'transitions', null, wanted);
  });

  announceWorkflowChange(projectId, context, 'transitions');
  return listTransitions(projectId);
}
