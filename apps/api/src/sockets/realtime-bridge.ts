/**
 * THE REALTIME BRIDGE — domain events in, socket emits out (plus the two
 * handlers at the bottom that move sockets instead of emitting on them:
 * `user.revoked` closes connections, `org.archived` empties rooms).
 *
 * This is the one place where the two halves of the plan's decoupling meet.
 * Wave-2 services publish `task.moved` and are done: they never import
 * Socket.IO, never know a browser exists. This file subscribes, HYDRATES what
 * the wire contract asks for, and broadcasts. Adding realtime therefore edited
 * no service file, which is what let Wave 2 and Wave 4 be written in parallel.
 *
 * ═══ ECHO SUPPRESSION — the contract this file exists to honour ═════════════
 *
 * The browser sends its socket id in `X-Socket-Id` on every mutation; the
 * middleware puts it on the request; services copy it onto the domain event as
 * `originSocketId`; and every project emit below goes through
 * {@link projectTarget}, which builds
 *
 *     io.to(projectRoom(projectId)).except(originSocketId ?? '')
 *
 * so the tab that CAUSED the change never receives its own change back. That
 * tab already painted it twice — once optimistically on drop, once from the
 * HTTP response — and a third write arriving asynchronously is exactly what
 * makes a just-dragged card jump. `?? ''` is the no-origin case (a server-side
 * actor, a curl request, a client with no socket): the empty string is a room
 * nobody is in, so `except('')` excludes nobody.
 *
 * ═══ A DOMAIN EVENT IS NOT A SOCKET PAYLOAD ════════════════════════════════
 *
 * The bus carries the MINIMUM a subscriber needs to act — ids and flags. The
 * socket contract carries the HYDRATED entity the browser renders. Turning one
 * into the other is this file's actual work, and it means most handlers do a
 * read. Those reads go through services (`getTask`, `requireSprint`,
 * `listStatuses`, `listTransitions`); the two with no service to call go
 * through `socket-reads.ts`, which documents why.
 *
 * A read that comes back empty is a SKIPPED EMIT, never a throw: the event
 * fires after the transaction committed, so a row that vanished in the
 * meantime means there is nothing to broadcast.
 *
 * ═══ EVERY PAYLOAD IS PARSED BEFORE IT IS EMITTED ══════════════════════════
 *
 * Always, in every environment — not only in dev. The cost is one zod parse of
 * an object we just built; the benefit is threefold:
 *
 *  1. the project's "zod at every boundary, both ends" rule holds on the socket
 *     boundary too;
 *  2. a hydration bug (a `Date` that never became an ISO string) surfaces here
 *     as a logged, dropped emit rather than as a client-side parse failure that
 *     leaves a board half-patched;
 *  3. **it strips internal fields.** `task.moved`'s bus payload carries
 *     `actorId`, which must never reach a browser. `parse()` drops unknown keys,
 *     so the spread that makes the pass-through cheap cannot leak one.
 *
 * A parse that throws is caught by the bus (`publishDomainEvent` logs and
 * swallows handler errors by contract), so a malformed emit can never fail the
 * mutation that already committed.
 */
import {
  commentCreatedPayloadSchema,
  commentDeletedPayloadSchema,
  commentUpdatedPayloadSchema,
  notificationNewPayloadSchema,
  projectRoom,
  SOCKET_EVENTS,
  sprintChangedPayloadSchema,
  taskCreatedPayloadSchema,
  taskDeletedPayloadSchema,
  taskMovedPayloadSchema,
  taskUpdatedPayloadSchema,
  userRoom,
  workflowChangedPayloadSchema,
  type Task,
  type TaskSummary,
} from '@flowboard/shared';

import { db } from '../db';
import { requireSprint } from '../services/sprints.service';
import { getTask } from '../services/tasks.service';
import { listStatuses, listTransitions } from '../services/workflow.service';
import { onDomainEvent, type Unsubscribe } from '../utils/domain-events';
import { logger } from '../utils/logger';
import { tryGetIo } from './io';
import { clearProjectPresence } from './presence';
import { loadComment, loadNotificationPush } from './socket-reads';

/**
 * `Task` → `TaskSummary`.
 *
 * The service layer's own row→summary mapper is private and takes a SELECT row,
 * while everything reachable from here answers with the detail shape, so the
 * narrowing happens here. It is the exact mirror of the web's
 * `board-cache.taskToSummary`, and the two derived fields are why the mapping
 * cannot be a spread: `hasDescription` collapses the markdown to the glyph a
 * card actually draws, and `labelIds` flattens the expanded labels.
 *
 * Broadcasting the detail shape instead would ship every card's whole
 * description to every listener on every keystroke of someone else's edit.
 */
export function toTaskSummary(task: Task): TaskSummary {
  return {
    id: task.id,
    number: task.number,
    title: task.title,
    type: task.type,
    priority: task.priority,
    statusId: task.statusId,
    assignee: task.assignee,
    storyPoints: task.storyPoints,
    startDate: task.startDate,
    dueDate: task.dueDate,
    labelIds: task.labels.map((label) => label.id),
    epicId: task.epicId,
    parentId: task.parentId,
    boardRank: task.boardRank,
    backlogRank: task.backlogRank,
    sprintId: task.sprintId,
    hasDescription: (task.description ?? '').trim().length > 0,
    commentCount: task.commentCount,
    attachmentCount: task.attachmentCount,
    updatedAt: task.updatedAt,
  };
}

/**
 * THE ECHO-SUPPRESSING TARGET: the project room minus the originating tab.
 *
 * Returns `null` when the gateway has not been initialised — the bus is a
 * process-wide singleton and a script (`seed.ts`, a migration) can publish
 * without a server attached. That is not an error; it is a run with no
 * listeners, and it must not throw inside a domain-event handler.
 *
 * A helper rather than an inline chain so there is exactly ONE place where
 * `except()` could be forgotten, and one place to read to verify it never is.
 */
function projectTarget(projectId: string, originSocketId: string | null) {
  const io = tryGetIo();
  if (!io) return null;
  return io.to(projectRoom(projectId)).except(originSocketId ?? '');
}

/** Log-and-continue for a hydration read that failed. Never rethrows. */
function skip(event: string, error: unknown): void {
  logger.warn({ err: error, event }, 'Realtime bridge could not hydrate an event — emit skipped');
}

let unsubscribes: Unsubscribe[] = [];

/**
 * Subscribe every domain event to its socket emit.
 *
 * Called once from `bootstrap()`. Idempotent by guard rather than by accident:
 * a second call with the handlers still registered would double every
 * broadcast, and a hot reload is exactly the situation that produces one.
 */
export function registerRealtimeBridge(): void {
  if (unsubscribes.length > 0) return;

  unsubscribes = [
    // ── Tasks ──────────────────────────────────────────────────────────────
    onDomainEvent('task.created', ({ projectId, taskId, originSocketId }) => {
      const target = projectTarget(projectId, originSocketId);
      if (!target) return;
      void getTask(taskId)
        .then((task) => {
          target.emit(
            SOCKET_EVENTS.TASK_CREATED,
            taskCreatedPayloadSchema.parse({ projectId, task: toTaskSummary(task) }),
          );
        })
        .catch((error: unknown) => {
          skip('task.created', error);
        });
    }),

    /**
     * `task.updated` is the workhorse: a field patch, a backlog re-rank, a
     * dependency edge and a confirmed attachment all arrive here (the last two
     * via `publishTaskUpdated`). All four collapse to one "replace this card"
     * broadcast, and `changedFields` is FORWARDED so the receiver can tell them
     * apart — the browser needs it for exactly one cache, the Roadmap's arrow
     * layer, which lives outside the task key prefix and would otherwise have to
     * be invalidated on every remote keystroke. See `lib/realtime-cache.ts`.
     */
    onDomainEvent('task.updated', ({ projectId, taskId, originSocketId, changedFields }) => {
      const target = projectTarget(projectId, originSocketId);
      if (!target) return;
      void getTask(taskId)
        .then((task) => {
          target.emit(
            SOCKET_EVENTS.TASK_UPDATED,
            taskUpdatedPayloadSchema.parse({
              projectId,
              task: toTaskSummary(task),
              // The bus types this `readonly string[]`; the wire schema wants a
              // mutable array, and a copy is cheaper than arguing about it.
              changedFields: [...changedFields],
            }),
          );
        })
        .catch((error: unknown) => {
          skip('task.updated', error);
        });
    }),

    /**
     * The only handler that needs NO read: `task.moved`'s bus payload is
     * `Pick`ed from `TaskMovedPayload` precisely so the drop — the most
     * latency-sensitive event in the product — broadcasts straight through.
     * `parse()` is what strips the `actorId` the spread carries along.
     *
     * That `Pick` is also why `updatedAt` needs no line here: the move service
     * reads it inside its transaction, the spread forwards it, and `parse()`
     * would REJECT a payload missing it. Re-reading the row to stamp a version
     * would defeat the whole point of the one read-free handler — and would
     * read a timestamp from after the commit rather than the one committed.
     */
    onDomainEvent('task.moved', ({ projectId, originSocketId, ...move }) => {
      projectTarget(projectId, originSocketId)?.emit(
        SOCKET_EVENTS.TASK_MOVED,
        taskMovedPayloadSchema.parse({ projectId, ...move }),
      );
    }),

    onDomainEvent('task.deleted', ({ projectId, taskId, originSocketId }) => {
      projectTarget(projectId, originSocketId)?.emit(
        SOCKET_EVENTS.TASK_DELETED,
        taskDeletedPayloadSchema.parse({ projectId, taskId }),
      );
    }),

    // ── Comments ───────────────────────────────────────────────────────────
    onDomainEvent('comment.created', ({ projectId, taskId, commentId, originSocketId }) => {
      const target = projectTarget(projectId, originSocketId);
      if (!target) return;
      void loadComment(commentId)
        .then((comment) => {
          if (!comment) return;
          target.emit(
            SOCKET_EVENTS.COMMENT_CREATED,
            commentCreatedPayloadSchema.parse({ projectId, taskId, comment }),
          );
        })
        .catch((error: unknown) => {
          skip('comment.created', error);
        });
    }),

    onDomainEvent('comment.updated', ({ projectId, taskId, commentId, originSocketId }) => {
      const target = projectTarget(projectId, originSocketId);
      if (!target) return;
      void loadComment(commentId)
        .then((comment) => {
          if (!comment) return;
          target.emit(
            SOCKET_EVENTS.COMMENT_UPDATED,
            commentUpdatedPayloadSchema.parse({ projectId, taskId, comment }),
          );
        })
        .catch((error: unknown) => {
          skip('comment.updated', error);
        });
    }),

    onDomainEvent('comment.deleted', ({ projectId, taskId, commentId, originSocketId }) => {
      projectTarget(projectId, originSocketId)?.emit(
        SOCKET_EVENTS.COMMENT_DELETED,
        commentDeletedPayloadSchema.parse({ projectId, taskId, commentId }),
      );
    }),

    // ── Sprints ────────────────────────────────────────────────────────────
    /**
     * `sprint` is `null` for `deleted` — the row is gone, and the contract says
     * so. It is ALSO null when the read fails for any other reason, because a
     * backlog that learns "something happened to this sprint" and invalidates
     * is strictly better than a backlog that learns nothing.
     */
    onDomainEvent('sprint.changed', ({ projectId, sprintId, action, originSocketId }) => {
      const target = projectTarget(projectId, originSocketId);
      if (!target) return;
      const load =
        action === 'deleted'
          ? Promise.resolve(null)
          : requireSprint(db, projectId, sprintId).catch(() => null);

      void load
        .then((sprint) => {
          target.emit(
            SOCKET_EVENTS.SPRINT_CHANGED,
            sprintChangedPayloadSchema.parse({ projectId, sprintId, action, sprint }),
          );
        })
        .catch((error: unknown) => {
          skip('sprint.changed', error);
        });
    }),

    // ── Workflow ───────────────────────────────────────────────────────────
    /**
     * `workflow:changed` ships the ENTIRE workflow rather than the `change`
     * discriminator the bus carries, so an open board re-renders its columns
     * and its forbidden-drop styling from the payload alone — no refetch, and
     * no flash of a board still drawn with the old columns.
     */
    onDomainEvent('workflow.changed', ({ projectId, originSocketId }) => {
      const target = projectTarget(projectId, originSocketId);
      if (!target) return;
      void Promise.all([listStatuses(projectId), listTransitions(projectId)])
        .then(([statuses, transitions]) => {
          target.emit(
            SOCKET_EVENTS.WORKFLOW_CHANGED,
            workflowChangedPayloadSchema.parse({ projectId, statuses, transitions }),
          );
        })
        .catch((error: unknown) => {
          skip('workflow.changed', error);
        });
    }),

    // ── Notifications ──────────────────────────────────────────────────────
    /**
     * The one event that goes to a USER room, and the one that suppresses no
     * echo.
     *
     * `user:{recipientId}`, because a notification is addressed to a person,
     * not to a project — and several kinds (a due-soon reminder) belong to no
     * project at all.
     *
     * No `.except()`, because there is nothing to suppress: the fan-out never
     * writes a row for the actor, so a `notification.created` that a tab caused
     * is by construction addressed to somebody else. Excluding the origin
     * socket would only matter if you could notify yourself, and you cannot.
     *
     * The unread total rides along so the bell badge never needs a follow-up
     * request to render the number it just changed.
     */
    onDomainEvent('notification.created', ({ recipientId, notificationId }) => {
      const io = tryGetIo();
      if (!io) return;
      void loadNotificationPush(notificationId, recipientId)
        .then((push) => {
          if (!push) return;
          io.to(userRoom(recipientId)).emit(
            SOCKET_EVENTS.NOTIFICATION_NEW,
            notificationNewPayloadSchema.parse(push),
          );
        })
        .catch((error: unknown) => {
          skip('notification.created', error);
        });
    }),

    // ── Sessions ───────────────────────────────────────────────────────────
    /**
     * The only handler that CLOSES connections instead of emitting on them.
     *
     * `token_version` is checked once per socket, in the handshake. That makes
     * the bump behind a deactivation, an admin force-logout or a password reset
     * a rule about FUTURE connections only: the tabs already open keep receiving
     * every board update and every notification for the account, indefinitely,
     * because a websocket that is already established never asks again.
     *
     * `disconnectSockets(true)` closes the underlying connection rather than
     * merely detaching the namespace — `false` would leave the transport alive
     * and let the client resume onto a new socket without a handshake, which is
     * precisely the check being enforced. The client sees a normal disconnect;
     * its reconnect attempt then presents the stale token to `io.ts` and is
     * refused there, which is where the user-visible "signed out" comes from.
     *
     * No `except()`: revoking a session means ALL of them. The administrator who
     * pressed the button is a different user in a different room.
     */
    onDomainEvent('user.revoked', ({ userId }) => {
      tryGetIo()?.in(userRoom(userId)).disconnectSockets(true);
    }),

    /**
     * The org archive's live half — the second handler that moves sockets
     * rather than emitting on them, and deliberately the GENTLER of the two.
     *
     * `user.revoked` closes connections because the SESSION is gone: nothing the
     * socket could still be told is legitimate. Archiving an organization
     * revokes one tenancy, not a person — the same tab may be watching a board
     * in another live org, and it is certainly still entitled to its
     * notifications. So this empties the rooms (`socketsLeave`) and leaves the
     * connections alone. Emptying a room is also idempotent and cheap: a room
     * nobody is in is a no-op, which is the normal case.
     *
     * There is no `except()`, for the same reason `user.revoked` has none: the
     * archive is an instance-admin action taken from `/admin/orgs`, and that
     * admin is not in any of these project rooms.
     *
     * PRESENCE IS CLEANED UP TOO, not left to the disconnect handler. The
     * roster is a `Map` keyed by project, not a projection of the Socket.IO
     * rooms, so a `socketsLeave` alone would leave every evicted tab listed as
     * "present" in a project nobody can open — for as long as those tabs stay
     * connected, which for a browser left open is indefinitely. The broadcast
     * that would normally follow a roster change is pointless here (the room is
     * empty by the time it would go out), so it is skipped.
     *
     * `socketsLeave` returns void in the single-node case this deployment is
     * (`InterServerEvents` is declared empty in the shared contract), so nothing
     * is awaited; the handler stays synchronous like every other one here.
     */
    onDomainEvent('org.archived', ({ orgId, projectIds }) => {
      const io = tryGetIo();
      if (!io) return;
      for (const projectId of projectIds) {
        const room = projectRoom(projectId);
        io.in(room).socketsLeave(room);
        clearProjectPresence(projectId);
      }
      logger.debug({ orgId, projects: projectIds.length }, 'Org archived — project rooms emptied');
    }),
  ];

  logger.debug({ handlers: unsubscribes.length }, 'Realtime bridge subscribed to domain events');
}

/**
 * Drop every subscription.
 *
 * Exists for tests (a suite that registers the bridge against its own server
 * must not leave handlers behind for the next file) and for a clean shutdown.
 * `bootstrap()` never calls it.
 */
export function unregisterRealtimeBridge(): void {
  for (const unsubscribe of unsubscribes) unsubscribe();
  unsubscribes = [];
}

/**
 * ═══ WHAT CROSSES, AND WHAT DOES NOT ══════════════════════════════════════
 *
 * The bus payload and the wire payload are different objects on purpose, and
 * the boundary is enforced by `parse()` rather than by discipline: every
 * handler above spreads its bus payload into a shared schema, and zod strips
 * whatever the schema does not declare.
 *
 * INTERNAL, stripped at the boundary:
 *   - `actorId` — who did it. The socket layer already routes by room; telling
 *     every viewer which user id caused a change is a privacy leak with no
 *     consumer.
 *   - `originSocketId` — consumed HERE, by `except()`. Forwarding it would
 *     invite a client to implement echo suppression a second time, wrongly.
 *   - `statusChanged` (`task.moved`) — the fan-out in `notifications.service`
 *     needs it; a browser re-renders the card either way.
 *
 * FORWARDED, because a receiver genuinely cannot re-derive it:
 *   - `changedFields` (`task.updated`) — four different mutations arrive as one
 *     event, and a dependency edge changes no field the summary carries. WP4.7
 *     added `changedFields` to `taskUpdatedPayloadSchema` to close this gap;
 *     before that the web invalidated the whole dependency graph on every
 *     update, which was correct and far coarser than necessary.
 */
