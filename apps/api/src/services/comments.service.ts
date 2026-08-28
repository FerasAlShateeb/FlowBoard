/**
 * Task comments, and the mention fan-out input they produce.
 *
 * MENTIONS ARE DERIVED, NEVER SUPPLIED. The body is stored verbatim and
 * `extractMentionUserIds` re-reads it to decide who was named — see the long
 * note in `comments.schema.ts`. Deriving from what was actually saved is what
 * makes "editing a mention out stops notifying" true, and what stops a
 * hand-crafted request notifying somebody the text never named. Every id the
 * body yields is then checked against project visibility, so a comment cannot
 * reach across a project boundary either.
 */
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { extractMentionUserIds, type Comment } from '@flowboard/shared';

import { comments, db, projects, tasks, users, withTx, type Db, type Tx } from '../db';
import { ApiError } from '../utils/api-error';
import { publishDomainEvent } from '../utils/domain-events';
import { recordActivity } from './activity.service';
import { record } from './telemetry.service';
import {
  assertProjectVisibleUsers,
  requireTaskRow,
  toIsoDateTime,
  type ProjectScope,
  type TaskActor,
} from './tasks.service';
import type { ProjectRole } from '../middlewares/require-roles';

type Executor = Db | Tx;

/** A page of a comment thread, plus the total for the envelope's `meta`. */
export interface CommentPage {
  items: Comment[];
  total: number;
}

/**
 * Stand-in author for a row whose user row went away.
 *
 * FlowBoard never deletes users (they deactivate), so this is unreachable in
 * practice — but `commentSchema.author` is non-nullable, and dropping the
 * comment from the thread would silently lose content.
 */
const UNKNOWN_AUTHOR = {
  id: '00000000-0000-4000-8000-000000000000',
  name: 'Unknown user',
  avatarUrl: null,
} as const;

function toComment(row: {
  id: string;
  taskId: string;
  body: string;
  editedAt: Date | null;
  createdAt: Date;
  authorId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
}): Comment {
  return {
    id: row.id,
    taskId: row.taskId,
    author:
      row.authorId === null || row.authorName === null
        ? { ...UNKNOWN_AUTHOR }
        : { id: row.authorId, name: row.authorName, avatarUrl: row.authorAvatarUrl },
    body: row.body,
    editedAt: row.editedAt === null ? null : toIsoDateTime(row.editedAt),
    createdAt: toIsoDateTime(row.createdAt),
  };
}

const commentSelection = {
  id: comments.id,
  taskId: comments.taskId,
  body: comments.body,
  editedAt: comments.editedAt,
  createdAt: comments.createdAt,
  authorId: users.id,
  authorName: users.name,
  authorAvatarUrl: users.avatarUrl,
};

async function loadComment(executor: Executor, commentId: string): Promise<Comment> {
  const [row] = await executor
    .select(commentSelection)
    .from(comments)
    .leftJoin(users, eq(comments.authorId, users.id))
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
    .limit(1);
  if (!row) throw ApiError.notFound('Comment not found');
  return toComment(row);
}

/** The comment's owning task and project — the route only carries a comment id. */
export async function requireCommentContext(
  executor: Executor,
  commentId: string,
): Promise<{ commentId: string; taskId: string; projectId: string; authorId: string | null }> {
  const [row] = await executor
    .select({
      commentId: comments.id,
      taskId: comments.taskId,
      projectId: tasks.projectId,
      authorId: comments.authorId,
    })
    .from(comments)
    .innerJoin(tasks, eq(comments.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(comments.id, commentId),
        isNull(comments.deletedAt),
        isNull(tasks.deletedAt),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw ApiError.notFound('Comment not found');
  return row;
}

/** `GET /tasks/:taskId/comments` — oldest first, the order a thread reads in. */
export async function listComments(
  taskId: string,
  page: number,
  pageSize: number,
): Promise<CommentPage> {
  await requireTaskRow(db, taskId);
  const where = and(eq(comments.taskId, taskId), isNull(comments.deletedAt));

  const [rows, totals] = await Promise.all([
    db
      .select(commentSelection)
      .from(comments)
      .leftJoin(users, eq(comments.authorId, users.id))
      .where(where)
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(comments).where(where),
  ]);

  return { items: rows.map(toComment), total: totals[0]?.value ?? 0 };
}

/** Every mentioned id, validated against project visibility. */
async function resolveMentions(
  executor: Executor,
  scope: ProjectScope,
  body: string,
): Promise<string[]> {
  const mentioned = extractMentionUserIds(body);
  if (mentioned.length === 0) return [];
  await assertProjectVisibleUsers(executor, scope, mentioned);
  return mentioned;
}

/** `POST /tasks/:taskId/comments`. */
export async function createComment(
  scope: ProjectScope,
  actor: TaskActor,
  taskId: string,
  body: string,
): Promise<Comment> {
  const created = await withTx(async (tx) => {
    // The row is read for its existence check AND for the audience snapshot the
    // event carries — see `AudienceSnapshot` in `utils/domain-events.ts`.
    const task = await requireTaskRow(tx, taskId);
    const mentionedUserIds = await resolveMentions(tx, scope, body);

    const [row] = await tx
      .insert(comments)
      .values({ taskId, authorId: actor.userId, body })
      .returning({ id: comments.id });
    if (!row) throw ApiError.internal('Comment insert returned no row');

    await recordActivity(
      {
        projectId: scope.projectId,
        taskId,
        actorId: actor.userId,
        action: 'comment.added',
        newValue: { commentId: row.id },
      },
      tx,
    );

    return {
      commentId: row.id,
      mentionedUserIds,
      assigneeIdAtCommit: task.assigneeId,
      reporterIdAtCommit: task.reporterId,
    };
  });

  const comment = await loadComment(db, created.commentId);

  record(
    'comment_added',
    { taskId, commentId: comment.id },
    {
      userId: actor.userId,
      orgId: scope.orgId,
      projectId: scope.projectId,
    },
  );
  publishDomainEvent('comment.created', {
    projectId: scope.projectId,
    actorId: actor.userId,
    originSocketId: actor.socketId,
    taskId,
    commentId: comment.id,
    mentionedUserIds: created.mentionedUserIds,
    assigneeIdAtCommit: created.assigneeIdAtCommit,
    reporterIdAtCommit: created.reporterIdAtCommit,
  });

  return comment;
}

/**
 * Author, or a project admin.
 *
 * An admin can remove or correct somebody else's comment because moderation has
 * to live somewhere; a plain member cannot touch a comment that is not theirs.
 */
function assertCanModify(authorId: string | null, actorId: string, role: ProjectRole): void {
  if (authorId === actorId) return;
  if (role === 'admin') return;
  throw ApiError.forbidden('Only the author or a project admin can change this comment');
}

/** `PATCH /comments/:commentId` — stamps `edited_at`, which is what "(edited)" reads. */
export async function updateComment(
  scope: ProjectScope,
  actor: TaskActor,
  role: ProjectRole,
  commentId: string,
  body: string,
): Promise<Comment> {
  const updated = await withTx(async (tx) => {
    const context = await requireCommentContext(tx, commentId);
    assertCanModify(context.authorId, actor.userId, role);
    const mentionedUserIds = await resolveMentions(tx, scope, body);

    await tx.update(comments).set({ body, editedAt: new Date() }).where(eq(comments.id, commentId));

    await recordActivity(
      {
        projectId: scope.projectId,
        taskId: context.taskId,
        actorId: actor.userId,
        action: 'comment.edited',
        newValue: { commentId },
      },
      tx,
    );

    return { taskId: context.taskId, mentionedUserIds };
  });

  const comment = await loadComment(db, commentId);

  publishDomainEvent('comment.updated', {
    projectId: scope.projectId,
    actorId: actor.userId,
    originSocketId: actor.socketId,
    taskId: updated.taskId,
    commentId,
    mentionedUserIds: updated.mentionedUserIds,
  });

  return comment;
}

/** `DELETE /comments/:commentId` — soft, so the thread keeps its shape in history. */
export async function deleteComment(
  scope: ProjectScope,
  actor: TaskActor,
  role: ProjectRole,
  commentId: string,
): Promise<void> {
  const taskId = await withTx(async (tx) => {
    const context = await requireCommentContext(tx, commentId);
    assertCanModify(context.authorId, actor.userId, role);

    await tx.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
    await recordActivity(
      {
        projectId: scope.projectId,
        taskId: context.taskId,
        actorId: actor.userId,
        action: 'comment.deleted',
        oldValue: { commentId },
      },
      tx,
    );

    return context.taskId;
  });

  publishDomainEvent('comment.deleted', {
    projectId: scope.projectId,
    actorId: actor.userId,
    originSocketId: actor.socketId,
    taskId,
    commentId,
  });
}
