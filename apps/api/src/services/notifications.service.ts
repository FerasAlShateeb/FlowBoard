/**
 * In-app notifications — the READ side (bell menu, notifications page) and the
 * FAN-OUT side (domain event → recipient set → rows → `notification.created`).
 *
 * ═══ THE THREE RULES THIS FILE IS BUILT ON ═════════════════════════════════
 *
 * 1. **The payload is DENORMALIZED, always.** A notification is a sentence about
 *    something that already happened, and it must keep rendering that sentence
 *    after the task is renamed, the project archived or the actor deactivated.
 *    So every row carries its own `{taskKey, taskTitle, projectKey, projectName,
 *    orgSlug, taskId, actorName, …}` snapshot and the bell menu needs no joins —
 *    which is also what keeps one bell fetch to one indexed read.
 *
 * 2. **Fan-out is FIRE-AND-FORGET.** Every handler here is invoked from a
 *    domain-event subscriber that already committed its transaction. A failure
 *    to notify must never fail the mutation, so nothing here is awaited by a
 *    service and nothing here throws into a publisher — `notifications.bootstrap`
 *    wraps each call in `void …catch(log)`.
 *
 * 3. **A recipient is EARNED, not assumed.** The candidate set (assignee,
 *    reporter, watchers, mentions, sprint participants) is filtered through
 *    three subtractions, in this order and for these reasons:
 *
 *      − the ACTOR      — nobody is told about their own action;
 *      − MUTED watchers — an explicit "stop telling me about this task" beats
 *                         every other reason a row could be produced, including
 *                         being the assignee or being mentioned;
 *      − users WITHOUT PROJECT VISIBILITY — a notification carries the task
 *                         title and key, so delivering one to a non-member is a
 *                         data leak dressed as a convenience.
 *
 *    When two triggers name the same user in one event (mentioned in a comment
 *    AND a watcher of the task), the HIGHEST-PRIORITY type wins and exactly one
 *    row is written — see {@link TYPE_PRIORITY}.
 *
 * 4. **The AUDIENCE comes from the EVENT; the CONTENT comes from the database.**
 *    Every handler here runs after its publisher committed, so a fresh read is a
 *    read of a LATER world. That is harmless for the denormalized payload (rule
 *    1 only asks that it be frozen at write time) and wrong for the recipient
 *    set: reassign a task while a status change is in flight and a re-read
 *    notifies the NEW assignee about a move they never saw, while the person
 *    who actually held the task gets nothing. So assignee and reporter arrive on
 *    the event as an {@link AudienceSnapshot} taken inside the publishing
 *    transaction, and {@link TaskContext} does not even carry them — the
 *    mistake is unavailable rather than merely discouraged. Watchers are still
 *    read live, and `AudienceSnapshot`'s doc comment argues why that split is
 *    the right one.
 *
 * ═══ WHAT THIS FILE DOES NOT DO ═══════════════════════════════════════════
 *
 * It does not touch Socket.IO. It publishes `notification.created` on the
 * domain-event bus and stops; WP4.1's realtime bridge is what turns that into
 * `notification:new` on `user:{userId}`. The domain event carries only
 * `notificationId`, so the bridge re-reads the row with
 * {@link getNotificationById} and the badge total with {@link countUnread} —
 * both exported for exactly that reason.
 */
import { and, desc, eq, exists, inArray, isNull, lte, gte, ne, or, sql } from 'drizzle-orm';
import {
  extractMentionUserIds,
  notificationPayloadSchema,
  notificationTypeSchema,
  type Notification,
  type NotificationListQuery,
  type NotificationPayload,
  type NotificationType,
  type PaginationMeta,
} from '@flowboard/shared';

import {
  activity,
  comments,
  db,
  notifications,
  organizations,
  orgMembers,
  projectMembers,
  projects,
  sprints,
  statuses,
  taskWatchers,
  tasks,
  users,
} from '../db';
import { isTest } from '../config/env';
import { ApiError } from '../utils/api-error';
import {
  publishDomainEvent,
  type AudienceSnapshot,
  type DomainEventMap,
} from '../utils/domain-events';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Wire formatting
// ---------------------------------------------------------------------------

const notificationSelection = {
  id: notifications.id,
  recipientId: notifications.recipientId,
  type: notifications.type,
  payload: notifications.payload,
  readAt: notifications.readAt,
  createdAt: notifications.createdAt,
};

interface NotificationRowShape {
  id: string;
  recipientId: string;
  type: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Row → contract.
 *
 * BOTH jsonb-ish fields go through zod rather than a cast: `payload` is typed
 * `unknown` by design (the column is a snapshot bag), and the pg enum and the
 * shared enum are two independent declarations of the same seven values. A row
 * written outside this file that disagrees with either is a 500 here, which is
 * the honest answer — not a payload the browser then fails to render.
 */
function toNotification(row: NotificationRowShape): Notification {
  return {
    id: row.id,
    recipientId: row.recipientId,
    type: notificationTypeSchema.parse(row.type),
    payload: notificationPayloadSchema.parse(row.payload ?? {}),
    readAt: row.readAt === null ? null : row.readAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Read side — everything the bell menu and the notifications page call
// ---------------------------------------------------------------------------

export interface NotificationPage {
  items: Notification[];
  meta: PaginationMeta;
}

/**
 * `GET /notifications?unread&type&page&pageSize` — the caller's OWN rows,
 * newest first.
 *
 * Self-scoped by construction: `recipientId` comes from the access token, never
 * from the request, so there is no authorization decision to get wrong and no
 * role guard to mount.
 */
export async function listNotifications(
  recipientId: string,
  query: NotificationListQuery,
): Promise<NotificationPage> {
  const filters = [eq(notifications.recipientId, recipientId)];
  if (query.unread === true) filters.push(isNull(notifications.readAt));
  if (query.type !== undefined) filters.push(eq(notifications.type, query.type));
  const where = and(...filters);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(notifications)
    .where(where);
  const total = countRow?.total ?? 0;

  const rows = await db
    .select(notificationSelection)
    .from(notifications)
    .where(where)
    // `id` breaks the tie: two rows from one fan-out share a `created_at` to the
    // microsecond, and an unstable order makes page 2 skip or repeat one.
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    items: rows.map(toNotification),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

/**
 * `GET /notifications/unread-count` — the bell badge.
 *
 * Its own endpoint because it is asked for far more often than the list is
 * opened, and it is served by the PARTIAL index (`… WHERE read_at IS NULL`):
 * the unread set stays tiny while the read set grows without bound, so this
 * stays an index-only scan forever.
 */
export async function countUnread(recipientId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientId, recipientId), isNull(notifications.readAt)));
  return row?.total ?? 0;
}

/** One row by id, ignoring ownership — the realtime bridge's read. `null` if gone. */
export async function getNotificationById(notificationId: string): Promise<Notification | null> {
  const [row] = await db
    .select(notificationSelection)
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1);
  return row ? toNotification(row) : null;
}

/**
 * `POST /notifications/:notificationId/read` — the row click.
 *
 * IDEMPOTENT: marking an already-read row read again returns it unchanged
 * rather than 404-ing or re-stamping, because the bell fires this on every
 * click and a double-click must not be an error.
 */
export async function markNotificationRead(
  recipientId: string,
  notificationId: string,
): Promise<Notification> {
  const [updated] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientId, recipientId),
        isNull(notifications.readAt),
      ),
    )
    .returning(notificationSelection);
  if (updated) return toNotification(updated);

  // Nothing updated: either already read (return it) or not this caller's row.
  // The 404 covers "does not exist" and "belongs to someone else" with ONE
  // answer on purpose — distinguishing them would confirm the existence of
  // another user's notification.
  const [existing] = await db
    .select(notificationSelection)
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.recipientId, recipientId)))
    .limit(1);
  if (!existing) throw ApiError.notFound('Notification not found');
  return toNotification(existing);
}

/**
 * `POST /notifications/read` — mark a specific set read (the shared
 * `markNotificationsReadInputSchema` body). Answers the RESULTING unread count,
 * so the badge lands on the server's number instead of a client-side guess.
 */
export async function markNotificationsRead(
  recipientId: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length > 0) {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          inArray(notifications.id, [...ids]),
          isNull(notifications.readAt),
        ),
      );
  }
  return countUnread(recipientId);
}

/**
 * `POST /notifications/read-all` — everything still unread, in one statement.
 *
 * Returns how many rows it actually stamped (0 when the badge was already
 * clear), which is what the client shows in its confirmation toast.
 */
export async function markAllNotificationsRead(recipientId: string): Promise<number> {
  const stamped = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientId, recipientId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return stamped.length;
}

// ---------------------------------------------------------------------------
// Fan-out — shared machinery
// ---------------------------------------------------------------------------

/**
 * Which type wins when one event names the same user twice.
 *
 * LOWER IS STRONGER. The ordering is about how much the row tells the reader
 * something they did not already know: being *named* ("mentioned") is the most
 * specific thing that can happen to you on a task, being *given* it
 * ("task_assigned") the next; the ambient "somebody changed something you
 * watch" types come last. A user mentioned in a comment on a task they watch
 * gets ONE `mentioned` row, never a `mentioned` plus a `comment_added`.
 */
const TYPE_PRIORITY: Record<NotificationType, number> = {
  mentioned: 0,
  task_assigned: 1,
  due_soon: 2,
  sprint_started: 3,
  sprint_completed: 3,
  status_changed: 4,
  comment_added: 5,
};

/** A user who might be notified, and what they would be notified about. */
interface Candidate {
  userId: string;
  type: NotificationType;
}

/**
 * Everything a task-scoped notification needs to RENDER without a join.
 *
 * Deliberately carries no `assigneeId` / `reporterId`. Those decide WHO gets a
 * row, and by rule 4 in the file header that decision belongs to the event's
 * {@link AudienceSnapshot}, not to a read taken after the fact. Leaving them out
 * is what makes the wrong version un-writable rather than merely discouraged.
 */
interface TaskContext {
  taskId: string;
  projectId: string;
  orgId: string;
  taskKey: string;
  taskTitle: string;
  description: string | null;
  projectKey: string;
  projectName: string;
  orgSlug: string;
}

/**
 * The task, its project and its org in ONE read.
 *
 * `null` (rather than a throw) when the task is gone: a notification handler
 * runs after the fact, and a task deleted between the mutation and the fan-out
 * is a reason to do nothing, not a reason to log an error.
 */
async function loadTaskContext(taskId: string): Promise<TaskContext | null> {
  const [row] = await db
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      number: tasks.number,
      title: tasks.title,
      description: tasks.description,
      projectKey: projects.key,
      projectName: projects.name,
      orgId: projects.orgId,
      orgSlug: organizations.slug,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!row) return null;

  return {
    taskId: row.taskId,
    projectId: row.projectId,
    orgId: row.orgId,
    taskKey: `${row.projectKey}-${String(row.number)}`,
    taskTitle: row.title,
    description: row.description,
    projectKey: row.projectKey,
    projectName: row.projectName,
    orgSlug: row.orgSlug,
  };
}

/** The payload snapshot every task-scoped row carries. */
function taskPayload(context: TaskContext, actorName: string | undefined): NotificationPayload {
  return {
    taskId: context.taskId,
    taskKey: context.taskKey,
    taskTitle: context.taskTitle,
    projectKey: context.projectKey,
    projectName: context.projectName,
    orgSlug: context.orgSlug,
    ...(actorName === undefined ? {} : { actorName }),
  };
}

interface WatcherRow {
  userId: string;
  isMuted: boolean;
}

async function loadWatchers(taskId: string): Promise<WatcherRow[]> {
  return db
    .select({ userId: taskWatchers.userId, isMuted: taskWatchers.isMuted })
    .from(taskWatchers)
    .where(eq(taskWatchers.taskId, taskId));
}

/** Display name for the `actorName` snapshot. `undefined` for system actors. */
async function loadActorName(actorId: string | null): Promise<string | undefined> {
  if (actorId === null) return undefined;
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);
  return row?.name;
}

/**
 * The subset of `userIds` that may see this project.
 *
 * The SAME inheritance chain the guards resolve — global admin ⊃ org admin ⊃
 * explicit project membership — but FILTERING rather than asserting.
 * `tasks.service.assertProjectVisibleUsers` throws on the first stranger, which
 * is right for a request body ("you named someone who is not a member") and
 * wrong here: a watcher who lost their membership last week must be silently
 * skipped, not turned into a 400 on a fan-out nobody asked for.
 */
async function filterProjectVisible(
  projectId: string,
  orgId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Set();

  const rows = await db
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
                and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, users.id)),
              ),
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(orgMembers)
              .where(
                and(
                  eq(orgMembers.orgId, orgId),
                  eq(orgMembers.userId, users.id),
                  eq(orgMembers.role, 'admin'),
                ),
              ),
          ),
        ),
      ),
    );

  return new Set(rows.map((row) => row.id));
}

/** One fan-out: candidates in, notification rows and domain events out. */
interface FanOutInput {
  candidates: readonly Candidate[];
  actorId: string | null;
  actorName: string | undefined;
  originSocketId: string | null;
  projectId: string;
  orgId: string;
  taskId: string | null;
  commentId: string | null;
  /** Watchers who opted out of this task. Subtracted from EVERY type. */
  mutedUserIds?: ReadonlySet<string>;
  payload: NotificationPayload;
}

/**
 * Resolve, insert, publish.
 *
 * Returns the rows it wrote, so the callers' tests can assert the recipient
 * math directly rather than through a second read.
 */
async function fanOut(input: FanOutInput): Promise<Notification[]> {
  // 1. Dedupe: one row per user, strongest type wins.
  const strongest = new Map<string, NotificationType>();
  for (const candidate of input.candidates) {
    const current = strongest.get(candidate.userId);
    if (current === undefined || TYPE_PRIORITY[candidate.type] < TYPE_PRIORITY[current]) {
      strongest.set(candidate.userId, candidate.type);
    }
  }

  // 2. The three subtractions, cheapest first.
  if (input.actorId !== null) strongest.delete(input.actorId);
  if (input.mutedUserIds) {
    for (const muted of input.mutedUserIds) strongest.delete(muted);
  }
  if (strongest.size === 0) return [];

  const visible = await filterProjectVisible(input.projectId, input.orgId, [...strongest.keys()]);
  const recipients = [...strongest.entries()].filter(([userId]) => visible.has(userId));
  if (recipients.length === 0) return [];

  // 3. One multi-row INSERT — a fan-out to eight watchers is one round trip.
  const inserted = await db
    .insert(notifications)
    .values(
      recipients.map(([userId, type]) => ({
        recipientId: userId,
        actorId: input.actorId,
        type,
        projectId: input.projectId,
        taskId: input.taskId,
        commentId: input.commentId,
        payload: input.payload,
      })),
    )
    .returning(notificationSelection);

  // 4. One domain event per row. The bus is synchronous and non-throwing, and
  //    the bridge re-reads what it broadcasts — see the file header.
  const rows = inserted.map(toNotification);
  for (const row of rows) {
    publishDomainEvent('notification.created', {
      recipientId: row.recipientId,
      notificationId: row.id,
      type: row.type,
      projectId: input.projectId,
      actorId: input.actorId,
      originSocketId: input.originSocketId,
    });
  }
  return rows;
}

/**
 * Assignee + reporter + every watcher — the "people who care about this task" set.
 *
 * The first two come from the EVENT (`snapshot`), the third from a live read.
 * Rule 4 in the file header, and `AudienceSnapshot` in `utils/domain-events.ts`,
 * are why the two halves have different provenance.
 */
function taskAudience(
  snapshot: AudienceSnapshot,
  watchers: readonly WatcherRow[],
  type: NotificationType,
): Candidate[] {
  const ids = new Set<string>();
  if (snapshot.assigneeIdAtCommit !== null) ids.add(snapshot.assigneeIdAtCommit);
  if (snapshot.reporterIdAtCommit !== null) ids.add(snapshot.reporterIdAtCommit);
  for (const watcher of watchers) ids.add(watcher.userId);
  return [...ids].map((userId) => ({ userId, type }));
}

function mutedSet(watchers: readonly WatcherRow[]): Set<string> {
  return new Set(watchers.filter((watcher) => watcher.isMuted).map((watcher) => watcher.userId));
}

/**
 * The mentions a description EDIT newly introduced.
 *
 * Diffed against the previous body, read back from the activity stream (the
 * `task.field_changed` / `description` row the same transaction wrote). Without
 * the diff, fixing a typo in a description would re-notify everyone it names —
 * and people learn very quickly to ignore a bell that cries wolf.
 */
async function newlyMentionedInDescription(
  taskId: string,
  description: string | null,
): Promise<string[]> {
  const mentioned = extractMentionUserIds(description ?? '');
  if (mentioned.length === 0) return [];

  const [previous] = await db
    .select({ oldValue: activity.oldValue })
    .from(activity)
    .where(
      and(
        eq(activity.taskId, taskId),
        eq(activity.action, 'task.field_changed'),
        eq(activity.field, 'description'),
      ),
    )
    .orderBy(desc(activity.id))
    .limit(1);

  const before = new Set<string>(
    typeof previous?.oldValue === 'string' ? extractMentionUserIds(previous.oldValue) : [],
  );
  return mentioned.filter((id) => !before.has(id));
}

// ---------------------------------------------------------------------------
// Fan-out — one handler per domain event
// ---------------------------------------------------------------------------

/**
 * `task.created` — a task born assigned to somebody else, or born naming them.
 *
 * The create path has no "changed fields", so both facts come from the create:
 * an assignee that is not the actor is an assignment (`assigneeIdAtCommit`), and
 * a description with mentions in it is a mention (there is no previous body to
 * diff against, so the live description is the right source).
 */
export async function handleTaskCreated(event: DomainEventMap['task.created']): Promise<void> {
  const context = await loadTaskContext(event.taskId);
  if (!context) return;

  const candidates: Candidate[] = [];
  if (event.assigneeIdAtCommit !== null) {
    candidates.push({ userId: event.assigneeIdAtCommit, type: 'task_assigned' });
  }
  for (const userId of extractMentionUserIds(context.description ?? '')) {
    candidates.push({ userId, type: 'mentioned' });
  }
  if (candidates.length === 0) return;

  const watchers = await loadWatchers(event.taskId);
  const actorName = await loadActorName(event.actorId);
  await fanOut({
    candidates,
    actorId: event.actorId,
    actorName,
    originSocketId: event.originSocketId,
    projectId: context.projectId,
    orgId: context.orgId,
    taskId: context.taskId,
    commentId: null,
    mutedUserIds: mutedSet(watchers),
    payload: taskPayload(context, actorName),
  });
}

/**
 * `task.updated` — three triggers share one event, keyed off `changedFields`:
 * `assigneeId` → the new assignee is told; `statusId` → the task's audience is
 * told; `description` → the users the edit newly named are told.
 */
export async function handleTaskUpdated(event: DomainEventMap['task.updated']): Promise<void> {
  const changed = new Set(event.changedFields);
  const wantsAssignment = changed.has('assigneeId');
  const wantsStatus = changed.has('statusId');
  const wantsMentions = changed.has('description');
  if (!wantsAssignment && !wantsStatus && !wantsMentions) return;

  const context = await loadTaskContext(event.taskId);
  if (!context) return;
  const watchers = await loadWatchers(event.taskId);

  const candidates: Candidate[] = [];
  if (wantsStatus) candidates.push(...taskAudience(event, watchers, 'status_changed'));
  if (wantsAssignment && event.assigneeIdAtCommit !== null) {
    candidates.push({ userId: event.assigneeIdAtCommit, type: 'task_assigned' });
  }
  if (wantsMentions) {
    for (const userId of await newlyMentionedInDescription(context.taskId, context.description)) {
      candidates.push({ userId, type: 'mentioned' });
    }
  }
  if (candidates.length === 0) return;

  const actorName = await loadActorName(event.actorId);
  await fanOut({
    candidates,
    actorId: event.actorId,
    actorName,
    originSocketId: event.originSocketId,
    projectId: context.projectId,
    orgId: context.orgId,
    taskId: context.taskId,
    commentId: null,
    mutedUserIds: mutedSet(watchers),
    payload: taskPayload(context, actorName),
  });
}

/**
 * `task.moved` — the board drop, which is a status change about half the time.
 *
 * ONLY A COLUMN CHANGE IS NEWS. A re-order within one column is a drag the
 * watchers do not care about, and notifying on every one of them would make the
 * bell useless to exactly the people who watch a busy board.
 *
 * The event says which half it was. `DomainEventMap['task.moved'].statusChanged`
 * is set inside the move transaction, where the OLD status is still in scope —
 * the wire payload cannot express it (it carries the destination and no
 * origin), which is why the flag is an internal field on the bus rather than on
 * the socket contract.
 *
 * This used to be recovered by reading back the last `activity` row for the
 * task and testing it for `task.status_changed`. That worked, but it put a
 * query on the hottest path in the product to learn something the publisher had
 * already computed — and it was coupled to `moveTask` writing exactly one
 * activity row, LAST, forever.
 */
export async function handleTaskMoved(event: DomainEventMap['task.moved']): Promise<void> {
  if (!event.statusChanged) return;

  const context = await loadTaskContext(event.taskId);
  if (!context) return;
  const watchers = await loadWatchers(event.taskId);
  const actorName = await loadActorName(event.actorId);

  await fanOut({
    candidates: taskAudience(event, watchers, 'status_changed'),
    actorId: event.actorId,
    actorName,
    originSocketId: event.originSocketId,
    projectId: context.projectId,
    orgId: context.orgId,
    taskId: context.taskId,
    commentId: null,
    mutedUserIds: mutedSet(watchers),
    payload: taskPayload(context, actorName),
  });
}

/** Longest excerpt the bell row can show without wrapping past two lines. */
const EXCERPT_LENGTH = 140;

/**
 * A comment body as PLAIN TEXT for the snapshot: `@[Ada](uuid)` becomes `@Ada`,
 * whitespace collapses, and the result is clipped with an ellipsis.
 *
 * Rendered at WRITE time, not read time, because the payload is a snapshot —
 * and because the bell must never have to parse markdown to draw a row.
 */
export function commentExcerpt(body: string, limit = EXCERPT_LENGTH): string {
  const plain = body
    .replace(/@\[([^\]]{1,120})\]\([0-9a-fA-F-]{36}\)/gu, '@$1')
    .replace(/\s+/gu, ' ')
    .trim();
  return plain.length <= limit ? plain : `${plain.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * `comment.created` — the busiest trigger.
 *
 * Two audiences in one pass: the users the body NAMED get `mentioned`, and the
 * task's participants (assignee, reporter, watchers, anyone who has commented
 * on the thread before) get `comment_added`. A user in both sets gets one
 * `mentioned` row — see {@link TYPE_PRIORITY}.
 */
export async function handleCommentCreated(
  event: DomainEventMap['comment.created'],
): Promise<void> {
  const context = await loadTaskContext(event.taskId);
  if (!context) return;

  const [comment] = await db
    .select({ body: comments.body })
    .from(comments)
    .where(eq(comments.id, event.commentId))
    .limit(1);

  const watchers = await loadWatchers(event.taskId);

  // Previous authors on the thread — "task participants" in the plan's sense.
  // A person who answered a question on this task is interested in the answer
  // to their answer, whether or not they ever pressed Watch.
  const authors = await db
    .selectDistinct({ authorId: comments.authorId })
    .from(comments)
    .where(
      and(
        eq(comments.taskId, event.taskId),
        isNull(comments.deletedAt),
        ne(comments.id, event.commentId),
      ),
    );

  const candidates: Candidate[] = taskAudience(event, watchers, 'comment_added');
  for (const author of authors) {
    if (author.authorId !== null) {
      candidates.push({ userId: author.authorId, type: 'comment_added' });
    }
  }
  for (const userId of event.mentionedUserIds) {
    candidates.push({ userId, type: 'mentioned' });
  }

  const actorName = await loadActorName(event.actorId);
  await fanOut({
    candidates,
    actorId: event.actorId,
    actorName,
    originSocketId: event.originSocketId,
    projectId: context.projectId,
    orgId: context.orgId,
    taskId: context.taskId,
    commentId: event.commentId,
    mutedUserIds: mutedSet(watchers),
    payload: {
      ...taskPayload(context, actorName),
      ...(comment === undefined ? {} : { commentExcerpt: commentExcerpt(comment.body) }),
    },
  });
}

/**
 * `sprint.changed` — only `started` and `completed` produce notifications.
 *
 * THE RECIPIENT CHOICE, and why it is not "every project member": a sprint
 * ceremony matters to the people carrying work in it and to the people
 * accountable for the board. So the set is
 *
 *   assignees of the sprint's live tasks  ∪  the project's ADMINS
 *
 * A project member with nothing in the sprint learns about it from the backlog
 * banner, which is where they were going to look anyway; notifying all fifty of
 * them is how a bell becomes something people mute. Created / updated / deleted
 * produce nothing at all — they are edits, not events.
 */
export async function handleSprintChanged(event: DomainEventMap['sprint.changed']): Promise<void> {
  if (event.action !== 'started' && event.action !== 'completed') return;

  const [sprint] = await db
    .select({
      name: sprints.name,
      projectId: sprints.projectId,
      projectKey: projects.key,
      projectName: projects.name,
      orgId: projects.orgId,
      orgSlug: organizations.slug,
    })
    .from(sprints)
    .innerJoin(projects, eq(sprints.projectId, projects.id))
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(eq(sprints.id, event.sprintId))
    .limit(1);
  if (!sprint) return;

  const type: NotificationType = event.action === 'started' ? 'sprint_started' : 'sprint_completed';

  const assignees = await db
    .selectDistinct({ userId: tasks.assigneeId })
    .from(tasks)
    .where(and(eq(tasks.sprintId, event.sprintId), isNull(tasks.deletedAt)));

  const admins = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, sprint.projectId), eq(projectMembers.role, 'admin')));

  const candidates: Candidate[] = [];
  for (const row of assignees) {
    if (row.userId !== null) candidates.push({ userId: row.userId, type });
  }
  for (const row of admins) candidates.push({ userId: row.userId, type });
  if (candidates.length === 0) return;

  const actorName = await loadActorName(event.actorId);
  await fanOut({
    candidates,
    actorId: event.actorId,
    actorName,
    originSocketId: event.originSocketId,
    projectId: sprint.projectId,
    orgId: sprint.orgId,
    // A sprint notification points at the backlog, not at a task, so there is
    // no `taskId` and the click target falls back to the notifications page.
    taskId: null,
    commentId: null,
    payload: {
      sprintName: sprint.name,
      projectKey: sprint.projectKey,
      projectName: sprint.projectName,
      orgSlug: sprint.orgSlug,
      ...(actorName === undefined ? {} : { actorName }),
    },
  });
}

// ---------------------------------------------------------------------------
// due_soon — the one trigger with no domain event behind it
// ---------------------------------------------------------------------------

/** How far ahead "due soon" looks. A calendar day, because `due_date` is a DATE. */
const DUE_SOON_DAYS = 1;

/** How often the sweep runs. */
export const DUE_SOON_SWEEP_MS = 30 * 60_000;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Notify each assignee whose task falls due inside the next day.
 *
 * FOUR CONDITIONS, and each one is load-bearing:
 *   - `due_date` inside `[today, today+1]` — `due_date` is a DATE column, so the
 *     window is calendar days and a string comparison is both correct and
 *     index-friendly (`tasks_project_due_date_idx`). "24 hours" against a value
 *     with no time-of-day would just be a timezone argument with no answer.
 *   - not soft-deleted, and its status is not in the DONE category — finished
 *     work is not due.
 *   - it HAS an assignee — there is nobody to tell otherwise.
 *   - no `due_soon` row for this task+user in the last 24h — the sweep runs
 *     every 30 minutes, so without this it would notify 48 times a day. The
 *     dedupe is a `NOT EXISTS` inside the same statement rather than a read
 *     followed by a filter, so two overlapping sweeps cannot both pass it.
 *
 * Exported and parameterised on `now` so the query logic is testable without
 * waiting half an hour.
 */
export async function runDueSoonSweep(now: Date = new Date()): Promise<Notification[]> {
  const from = isoDay(now);
  const until = isoDay(new Date(now.getTime() + DUE_SOON_DAYS * 86_400_000));
  // An ISO STRING with an explicit cast, not a `Date`: postgres-js binds a
  // parameter inside a raw `sql` fragment by its JS type, and a bare `Date`
  // there throws before it ever reaches the server.
  const since = new Date(now.getTime() - 86_400_000).toISOString();

  const due = await db
    .select({
      taskId: tasks.id,
      assigneeId: tasks.assigneeId,
      number: tasks.number,
      title: tasks.title,
      projectId: tasks.projectId,
      projectKey: projects.key,
      projectName: projects.name,
      orgSlug: organizations.slug,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .innerJoin(statuses, eq(tasks.statusId, statuses.id))
    .where(
      and(
        isNull(tasks.deletedAt),
        sql`${tasks.assigneeId} IS NOT NULL`,
        gte(tasks.dueDate, from),
        lte(tasks.dueDate, until),
        ne(statuses.category, 'done'),
        sql`NOT EXISTS (
          SELECT 1 FROM ${notifications}
          WHERE ${notifications.taskId} = ${tasks.id}
            AND ${notifications.recipientId} = ${tasks.assigneeId}
            AND ${notifications.type} = 'due_soon'
            AND ${notifications.createdAt} > ${since}::timestamptz
        )`,
      ),
    );

  const values = due
    .filter((task): task is typeof task & { assigneeId: string } => task.assigneeId !== null)
    .map((task) => ({
      recipientId: task.assigneeId,
      // A system notification: nobody DID this, the clock did.
      actorId: null,
      type: 'due_soon' as const,
      projectId: task.projectId,
      taskId: task.taskId,
      commentId: null,
      payload: {
        taskId: task.taskId,
        taskKey: `${task.projectKey}-${String(task.number)}`,
        taskTitle: task.title,
        projectKey: task.projectKey,
        projectName: task.projectName,
        orgSlug: task.orgSlug,
      } satisfies NotificationPayload,
    }));
  if (values.length === 0) return [];

  const rows = await db
    .insert(notifications)
    .values(values)
    .returning({
      ...notificationSelection,
      projectId: notifications.projectId,
    });

  const created = rows.map(toNotification);
  for (const [index, row] of created.entries()) {
    publishDomainEvent('notification.created', {
      recipientId: row.recipientId,
      notificationId: row.id,
      type: row.type,
      projectId: rows[index]?.projectId ?? null,
      actorId: null,
      originSocketId: null,
    });
  }
  return created;
}

let dueSoonTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic sweep. Returns a stop function.
 *
 * `unref()` so the interval never holds the process open — a scheduled job must
 * not be the reason `SIGTERM` takes 30 minutes to land. Disabled entirely under
 * `NODE_ENV=test`, where a background timer writing rows into the shared test
 * database is a source of cross-suite flakes and nothing else.
 */
export function startDueSoonSweep(): () => void {
  if (isTest || dueSoonTimer !== null) return stopDueSoonSweep;

  const timer = setInterval(() => {
    void runDueSoonSweep().catch((error: unknown) => {
      logger.error({ err: error }, 'due-soon notification sweep failed');
    });
  }, DUE_SOON_SWEEP_MS);
  timer.unref();
  dueSoonTimer = timer;
  return stopDueSoonSweep;
}

/** Stop the sweep. Idempotent. */
export function stopDueSoonSweep(): void {
  if (dueSoonTimer === null) return;
  clearInterval(dueSoonTimer);
  dueSoonTimer = null;
}
