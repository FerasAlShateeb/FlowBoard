/**
 * READS of the `activity` audit stream. The writer is `activity.service.ts` and
 * nothing here inserts, updates or deletes — the stream is append-only, which is
 * exactly what lets the cumulative-flow report replay it.
 *
 * Two pagination modes, both supported by the same call:
 *
 *  - `?page&pageSize` — the API-wide offset convention, so the feed reports
 *    `meta { page, pageSize, total, totalPages }` like every other list.
 *  - `?beforeId` — a keyset cursor on the bigserial id, for infinite scroll. An
 *    append-only stream shifts under an offset every time anyone touches
 *    anything, so page 2 of an offset query can repeat a row it already showed;
 *    the cursor cannot.
 *
 * `id` crosses the wire as a STRING (`bigIntId`): Postgres `bigint` exceeds
 * `Number.MAX_SAFE_INTEGER` and JSON has no 64-bit integer.
 */
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { Activity, ActivityQuery, PaginationMeta } from '@flowboard/shared';
import { activityActionSchema } from '@flowboard/shared';

import { activity, db, users } from '../db';

export interface ActivityPage {
  items: Activity[];
  meta: PaginationMeta;
}

/** `GET /projects/:projectId/activity` — any project viewer. */
export async function listProjectActivity(
  projectId: string,
  query: ActivityQuery,
): Promise<ActivityPage> {
  const filters = [eq(activity.projectId, projectId)];
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
    // LEFT: `actor_id` is null for system-generated entries, and those rows must
    // still appear in the feed.
    .leftJoin(users, eq(activity.actorId, users.id))
    .where(where)
    .orderBy(desc(activity.id))
    .limit(query.pageSize)
    .offset(query.beforeId === undefined ? (query.page - 1) * query.pageSize : 0);

  const items: Activity[] = rows.map((row) => ({
    id: String(row.id),
    projectId: row.projectId,
    taskId: row.taskId,
    actor:
      row.actorId === null || row.actorName === null
        ? null
        : { id: row.actorId, name: row.actorName, avatarUrl: row.actorAvatarUrl },
    // The writer is typed against this same enum, so a parse failure here means
    // a row was written outside `recordActivity` — a 500 is the honest answer.
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
