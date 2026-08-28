/**
 * The socket layer's database reads — and the ONE documented exception to the
 * project's layering rule.
 *
 * ── WHY THIS FILE IS ALLOWED TO IMPORT `src/db` ─────────────────────────────
 * The rule is `routes → controllers → services → db`, and sockets sit ABOVE the
 * service layer, so the gateway normally calls services (it does: the bridge
 * uses `getTask`, `requireSprint`, `listStatuses`, `listTransitions`). Four
 * reads have no service to call:
 *
 *  1. **the user summary for presence** — nothing in the service layer answers
 *     "name + avatar for this id" without also answering questions presence has
 *     no business asking (`admin-users.service` is global-admin CRUD);
 *  2. **project → org id**, needed to run {@link resolveProjectRole} on a
 *     `project:join`. `require-roles.ts` has this lookup, but only inside a
 *     private `resolveProjectRef` behind an Express `RequestHandler`;
 *  3. **one comment by id** — `comments.service` exposes only a paginated
 *     thread, and the bridge needs exactly the row the domain event named;
 *  4. **one notification + the recipient's unread count** — the notifications
 *     service is WP4.2's, and the bridge must not take a build dependency on a
 *     package being written in parallel.
 *
 * The alternative — widening four service APIs purely so the socket layer can
 * reach them — would put functions in those services that no HTTP route calls,
 * which is a worse smell than one clearly-labelled read module. Everything here
 * is a SELECT: this file never writes, and never contains business rules.
 *
 * Every function returns `null` for "not found" rather than throwing. A socket
 * broadcast fires after a transaction has already committed; a row that
 * vanished in between (a task deleted a millisecond later) means "skip this
 * emit", not "crash a handler".
 */
import { and, count, eq, isNull } from 'drizzle-orm';
import {
  notificationPayloadSchema,
  type Comment,
  type Notification,
  type UserSummary,
} from '@flowboard/shared';

import { comments, db, notifications, projects, users } from '../db';
import { logger } from '../utils/logger';

/** `{ projectId, orgId }` — the shape {@link resolveProjectRole} takes. */
export interface ProjectRef {
  projectId: string;
  orgId: string;
}

/**
 * The org a (live) project belongs to, or `null`.
 *
 * Soft-deleted projects are excluded, so a join into an archived project is a
 * `NOT_FOUND` ack rather than a room nobody will ever broadcast to.
 */
export async function loadProjectRef(projectId: string): Promise<ProjectRef | null> {
  const [row] = await db
    .select({ projectId: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Name + avatar for a presence entry, or `null` if the user row is gone. */
export async function loadUserSummary(userId: string): Promise<UserSummary | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/**
 * One comment, hydrated the way `commentSchema` wants it.
 *
 * Mirrors `comments.service`'s private `toComment`, including its
 * unknown-author fallback: `commentSchema.author` is non-nullable, and dropping
 * a comment from a broadcast because its author row went missing would lose
 * content that the HTTP thread still renders.
 */
export async function loadComment(commentId: string): Promise<Comment | null> {
  const [row] = await db
    .select({
      id: comments.id,
      taskId: comments.taskId,
      body: comments.body,
      editedAt: comments.editedAt,
      createdAt: comments.createdAt,
      authorId: users.id,
      authorName: users.name,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(comments)
    .leftJoin(users, eq(comments.authorId, users.id))
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
    .limit(1);
  if (!row) return null;

  return {
    id: row.id,
    taskId: row.taskId,
    author:
      row.authorId === null || row.authorName === null
        ? { id: '00000000-0000-4000-8000-000000000000', name: 'Unknown user', avatarUrl: null }
        : { id: row.authorId, name: row.authorName, avatarUrl: row.authorAvatarUrl },
    body: row.body,
    editedAt: row.editedAt === null ? null : row.editedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * One notification plus its recipient's live unread total — the two halves of
 * `notification:new`, read together so the bell badge never needs a follow-up
 * request.
 *
 * The jsonb `payload` column is typed `unknown` in the schema on purpose, so it
 * is parsed here with the shared schema. A payload that fails to parse degrades
 * to `{}` rather than dropping the notification: the row is still a real event
 * the recipient must see, just with less to render.
 */
export async function loadNotificationPush(
  notificationId: string,
  recipientId: string,
): Promise<{ notification: Notification; unreadCount: number } | null> {
  const [row] = await db
    .select({
      id: notifications.id,
      recipientId: notifications.recipientId,
      type: notifications.type,
      payload: notifications.payload,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1);
  if (!row) return null;

  const parsedPayload = notificationPayloadSchema.safeParse(row.payload ?? {});
  if (!parsedPayload.success) {
    logger.warn({ notificationId }, 'Notification payload failed to parse — pushing it empty');
  }

  const [unread] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientId, recipientId), isNull(notifications.readAt)));

  return {
    notification: {
      id: row.id,
      recipientId: row.recipientId,
      type: row.type,
      payload: parsedPayload.success ? parsedPayload.data : {},
      readAt: row.readAt === null ? null : row.readAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    },
    unreadCount: unread?.value ?? 0,
  };
}
