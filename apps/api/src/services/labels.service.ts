/**
 * Project labels — the per-project tag vocabulary.
 *
 * Labels sit at the `member` floor rather than `admin`: tagging is part of doing
 * the work, not of configuring the project, and a viewer still cannot touch them.
 *
 * Deleting a label is a HARD delete. `task_labels` is `ON DELETE CASCADE`, so
 * the tag simply leaves every task that carried it — which is what "delete this
 * label" means to the person clicking it, and why there is no soft-delete column
 * on the table.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Label } from '@flowboard/shared';

import { db, labels, withTx } from '../db';
import { ApiError } from '../utils/api-error';
import { isUniqueViolation } from './pg-errors';
import type { ActorContext } from './projects.service';
import { announceWorkflowChange, recordWorkflowChange } from './workflow.service';

function toLabel(row: { id: string; projectId: string; name: string; color: string }): Label {
  return { id: row.id, projectId: row.projectId, name: row.name, color: row.color };
}

/** `GET /projects/:projectId/labels` — any project viewer. */
export async function listLabels(projectId: string): Promise<Label[]> {
  const rows = await db
    .select()
    .from(labels)
    .where(eq(labels.projectId, projectId))
    .orderBy(asc(labels.name));
  return rows.map(toLabel);
}

/** `POST /projects/:projectId/labels` — project member. */
export async function createLabel(
  projectId: string,
  input: { name: string; color: string },
  context: ActorContext,
): Promise<Label> {
  const created = await withTx(async (tx) => {
    let row: { id: string; projectId: string; name: string; color: string } | undefined;
    try {
      [row] = await tx
        .insert(labels)
        .values({ projectId, name: input.name, color: input.color })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('A label with that name already exists in this project');
      }
      throw error;
    }
    if (!row) throw ApiError.internal('Label insert returned no row');

    await recordWorkflowChange(tx, projectId, context, 'label', null, {
      id: row.id,
      name: row.name,
    });
    return row;
  });

  announceWorkflowChange(projectId, context, 'labels');
  return toLabel(created);
}

/** `PATCH /projects/:projectId/labels/:labelId` — project member. */
export async function updateLabel(
  projectId: string,
  labelId: string,
  input: { name?: string; color?: string },
  context: ActorContext,
): Promise<Label> {
  const [current] = await db
    .select()
    .from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.projectId, projectId)))
    .limit(1);
  if (!current) throw ApiError.notFound('Label not found');

  const updated = await withTx(async (tx) => {
    let row: { id: string; projectId: string; name: string; color: string } | undefined;
    try {
      [row] = await tx
        .update(labels)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.color === undefined ? {} : { color: input.color }),
        })
        .where(and(eq(labels.id, labelId), eq(labels.projectId, projectId)))
        .returning();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('A label with that name already exists in this project');
      }
      throw error;
    }
    if (!row) throw ApiError.notFound('Label not found');

    await recordWorkflowChange(
      tx,
      projectId,
      context,
      'label',
      { id: current.id, name: current.name, color: current.color },
      { id: row.id, name: row.name, color: row.color },
    );
    return row;
  });

  announceWorkflowChange(projectId, context, 'labels');
  return toLabel(updated);
}

/** `DELETE /projects/:projectId/labels/:labelId` — project member. Cascades `task_labels`. */
export async function deleteLabel(
  projectId: string,
  labelId: string,
  context: ActorContext,
): Promise<void> {
  await withTx(async (tx) => {
    const [row] = await tx
      .delete(labels)
      .where(and(eq(labels.id, labelId), eq(labels.projectId, projectId)))
      .returning();
    if (!row) throw ApiError.notFound('Label not found');

    await recordWorkflowChange(
      tx,
      projectId,
      context,
      'label',
      { id: row.id, name: row.name, color: row.color },
      null,
    );
  });

  announceWorkflowChange(projectId, context, 'labels');
}
