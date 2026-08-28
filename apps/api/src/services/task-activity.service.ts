/**
 * READS of one TASK's slice of the `activity` audit stream — the history tab in
 * the task detail sheet.
 *
 * The stream itself is append-only and its only writer is
 * `services/activity.service.ts`, called from inside each mutation's
 * transaction. Nothing here inserts, updates or deletes.
 *
 * WHY THIS IS NOT `listProjectActivity(projectId, { taskId })`. The project feed
 * and the task history answer different questions and are guarded from different
 * route params: the project feed is addressed by `:projectId` and deliberately
 * INCLUDES the project-scoped rows (`workflow.changed`, `member.added`) whose
 * `task_id` is null, while this one is addressed by `:taskId` — so a soft-deleted
 * task is a 404 at the guard rather than an empty list here — and shows only the
 * rows that belong to that task. Folding them together would mean one function
 * whose behaviour is entirely decided by which of two arguments is null.
 *
 * PAGINATION, both modes, from the same shared `activityQuerySchema`:
 *
 *  - `?page&pageSize` — the API-wide offset convention, so the feed reports
 *    `meta { page, pageSize, total, totalPages }` like every other list. This is
 *    what the sheet's "Load more" button walks.
 *  - `?beforeId` — a keyset cursor on the bigserial id. An append-only stream
 *    shifts under an offset whenever anyone touches the task, so a long-lived
 *    feed can keyset instead and never show a row twice.
 *
 * `id` crosses the wire as a STRING (`bigIntId`): Postgres `bigint` exceeds
 * `Number.MAX_SAFE_INTEGER` and JSON has no 64-bit integer.
 */
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { Activity, ActivityQuery, PaginationMeta } from '@flowboard/shared';
import { activityActionSchema } from '@flowboard/shared';

import { activity, db, users } from '../db';

export interface TaskActivityPage {
  items: Activity[];
  meta: PaginationMeta;
}

/** `GET /tasks/:taskId/activity` — newest first. Any project viewer. */
export async function listTaskActivity(
  taskId: string,
  query: ActivityQuery,
): Promise<TaskActivityPage> {
  const filters = [eq(activity.taskId, taskId)];
  if (query.action !== undefined) filters.push(eq(activity.action, query.action));
  if (query.beforeId !== undefined) filters.push(lt(activity.id, Number(query.beforeId)));
  const where = and(...filters);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(activity)
    .where(where);
  const total = countRow?.total ?? 0;

  const rows = await db
    .select({
      id: activity.id,
      projectId: activity.projectId,
      taskId: activity.taskId,
      action: activity.action,
      field: activity.field,
      oldValue: activity.oldValue,
      newValue: activity.newValue,
      createdAt: activity.createdAt,
      actorId: users.id,
      actorName: users.name,
      actorAvatarUrl: users.avatarUrl,
    })
    .from(activity)
    // LEFT: `actor_id` is null for system-generated entries (a sprint completing
    // on schedule), and those rows must still appear in the history.
    .leftJoin(users, eq(activity.actorId, users.id))
    .where(where)
    // `(task_id, id)` is an index, and DESC on a btree reads backwards for free.
    .orderBy(desc(activity.id))
    .limit(query.pageSize)
    // A keyset request has already expressed its position in `beforeId`; adding
    // an offset on top of it would skip rows the client never saw.
    .offset(query.beforeId === undefined ? (query.page - 1) * query.pageSize : 0);

  const items: Activity[] = rows.map((row) => ({
    id: String(row.id),
    projectId: row.projectId,
    taskId: row.taskId,
    actor:
      row.actorId === null || row.actorName === null
        ? null
        : { id: row.actorId, name: row.actorName, avatarUrl: row.actorAvatarUrl },
    // The writer is typed against this same enum, so a parse failure here means a
    // row was written outside `recordActivity` — a 500 is the honest answer.
    action: activityActionSchema.parse(row.action),
    field: row.field ?? undefined,
    oldValue: row.oldValue ?? undefined,
    newValue: row.newValue ?? undefined,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    items,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}
