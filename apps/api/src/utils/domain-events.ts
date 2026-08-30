/**
 * The typed in-process domain-event bus.
 *
 * This is the seam that lets Wave 2 (services), Wave 4.1 (realtime) and
 * Wave 4.2 (notifications) be written by different agents at the same time:
 * a service publishes `task.moved` and is DONE — it never imports the socket
 * server, never knows a notification exists. Subscribers register from their
 * own files, so adding realtime or notifications never edits a service.
 *
 * Deliberately NOT built on Node's `EventEmitter`: its `on(event: string,
 * listener: (...args: any[]) => void)` signature erases the payload type at the
 * boundary, and `any` is a hard lint gate here. A plain `Map` of handler arrays
 * keeps `publishDomainEvent('task.moved', …)` checked against exactly the
 * payload `DomainEventMap` declares.
 *
 * Handler errors are caught and logged, never rethrown into the publisher: a
 * broken notification fan-out must not roll back a task move that already
 * committed.
 */
import type {
  NotificationType,
  SprintChangedPayload,
  TaskMovedPayload,
  Uuid,
} from '@flowboard/shared';
import { logger } from './logger';

/**
 * ── Relationship to the socket contract ─────────────────────────────────────
 * A domain event is NOT a socket payload, and the two must not be conflated:
 * the bus carries the minimum a subscriber needs to decide what to do (ids and
 * flags), while `@flowboard/shared`'s socket payloads carry the HYDRATED entity
 * the browser renders. WP4.1's bridge is what turns one into the other, and it
 * reads the row it broadcasts.
 *
 * Where a field means the same thing on both sides it is therefore TYPED FROM
 * the shared schema (`Pick<TaskMovedPayload, …>`, `SprintChangedPayload['action']`,
 * `NotificationType`) rather than re-declared — a contract change is then a
 * compile error in the bridge instead of a payload that quietly stops matching.
 * Internal-only fields (`actorId`, `originSocketId`, `mentionedUserIds`, and the
 * {@link AudienceSnapshot} pair) stay local: they never cross the wire.
 * `changedFields` is the one exception — WP4.7 added it to
 * `taskUpdatedPayloadSchema`, so it is forwarded rather than stripped.
 */

/**
 * Fields every project-scoped domain event carries.
 *
 * `originSocketId` is the echo-suppression key: the web client sends its socket
 * id in `X-Socket-Id` on every mutation, services copy it onto the event, and
 * the realtime layer emits `io.to(room).except(originSocketId)`. The actor's
 * own cache is written by its optimistic update plus the HTTP response — an
 * echo would be a redundant, and sometimes conflicting, third write.
 */
export interface DomainEventContext {
  projectId: Uuid;
  /** `users.id` of whoever caused the change. INTERNAL — never emitted. */
  actorId: Uuid;
  /** Socket id of the originating tab, or `null` for server-side actors. */
  originSocketId: string | null;
}

/**
 * The task's audience-defining columns, AS THEY STOOD IN THE PUBLISHING
 * TRANSACTION. Internal, like `actorId` — stripped at the socket boundary.
 *
 * ── WHY A SNAPSHOT AND NOT A RE-READ ───────────────────────────────────────
 * The notification fan-out runs after the publisher committed, and it used to
 * answer "who cares about this task?" with a fresh `SELECT`. That read is a
 * different moment in time from the event, and the gap is big enough to lose a
 * race: reassign FLOW-142 from Ada to Ben while a status change is still in
 * flight, and the status-change notification goes to BEN — a person who had
 * nothing to do with the task when it moved, and who now gets told about a
 * column change they never saw. Ada, whose task it actually was, gets nothing.
 *
 * The publisher already has both ids in scope inside its transaction, so it
 * carries them. Snapshot > re-read for anything that decides an AUDIENCE.
 *
 * ── WHAT IS *NOT* SNAPSHOTTED, AND WHY ─────────────────────────────────────
 * WATCHERS are still read live. The split is deliberate and it is about the
 * direction of the error:
 *
 *   - assignee / reporter are EXCLUSIVE roles. A late read does not add a
 *     recipient, it SUBSTITUTES one — the right person silently loses the
 *     notification and a stranger gains it. That is a correctness bug.
 *   - watchers are an ADDITIVE set, and membership in it is self-service
 *     ("notify me about this task"). A watcher who subscribed a millisecond
 *     after the event gets one extra notification about the thing they just
 *     said they wanted to hear about; one who unsubscribed in the same window
 *     misses nothing they had asked to keep. Neither outcome is wrong, and
 *     snapshotting a whole set into every event would cost a read on the
 *     hottest path in the product to prevent nothing.
 *
 * The DENORMALIZED PAYLOAD (task key, title, project name) is likewise read
 * live: it is what the row RENDERS, not who receives it, and rule 1 in
 * `notifications.service` only requires that it be frozen at WRITE time.
 */
export interface AudienceSnapshot {
  /** `tasks.assignee_id` inside the publishing transaction. */
  assigneeIdAtCommit: Uuid | null;
  /** `tasks.reporter_id` inside the publishing transaction. */
  reporterIdAtCommit: Uuid | null;
}

/** The complete catalogue of in-process events. Adding one is a type change. */
export interface DomainEventMap {
  'task.created': DomainEventContext &
    AudienceSnapshot & {
      taskId: Uuid;
      /** Denormalised so subscribers can route without a DB read. */
      statusId: Uuid;
    };
  'task.updated': DomainEventContext &
    AudienceSnapshot & {
      taskId: Uuid;
      /** Column names that actually changed — drives targeted cache patches. */
      changedFields: readonly string[];
    };
  /**
   * The board drop. The wire fields are `Pick`ed from `task:moved` so a
   * contract change breaks the bridge at compile time, plus ONE internal flag.
   *
   * `statusChanged` distinguishes a move BETWEEN columns from a re-order WITHIN
   * one, which the wire payload cannot express: it carries the destination
   * status and no previous one, so the two look identical downstream. That
   * distinction is the difference between notifying every watcher of a task and
   * notifying nobody, and the mover is the only party who knows it — the
   * comparison is `target.id !== current.statusId`, made inside the move
   * transaction where the old status is still in scope.
   *
   * It stays INTERNAL, like `actorId`: the browser re-renders the card either
   * way, and `taskMovedPayloadSchema.parse()` strips it on the way to the wire.
   * Before this flag existed, `notifications.service` recovered the same fact by
   * reading back the last activity row for the task — one query per drag on the
   * hottest path in the product, to learn something the publisher already knew.
   *
   * `updatedAt` is `Pick`ed like the rest of the wire fields, and like the
   * {@link AudienceSnapshot} pair it is read INSIDE the move transaction: it is
   * the stamp the web orders this splice against, so it has to be the value THIS
   * transaction wrote, not whatever a post-commit re-read happens to find.
   */
  'task.moved': DomainEventContext &
    AudienceSnapshot &
    Pick<TaskMovedPayload, 'taskId' | 'statusId' | 'boardRank' | 'rebalanced' | 'updatedAt'> & {
      statusChanged: boolean;
    };
  'task.deleted': DomainEventContext & { taskId: Uuid };
  /**
   * Carries the {@link AudienceSnapshot} for the same reason the task events do:
   * `comment_added` goes to the task's assignee and reporter, and a reassignment
   * landing between the insert and the fan-out must not redirect it.
   */
  'comment.created': DomainEventContext &
    AudienceSnapshot & {
      taskId: Uuid;
      commentId: Uuid;
      /** Extracted from `@[name](userId)` markers — the mention fan-out input. */
      mentionedUserIds: readonly Uuid[];
    };
  'comment.updated': DomainEventContext & {
    taskId: Uuid;
    commentId: Uuid;
    mentionedUserIds: readonly Uuid[];
  };
  'comment.deleted': DomainEventContext & { taskId: Uuid; commentId: Uuid };
  /**
   * `action` (not `change`) and its member list come from the socket payload:
   * the bridge forwards this verb verbatim, so one name and one vocabulary.
   */
  'sprint.changed': DomainEventContext & {
    sprintId: Uuid;
    action: SprintChangedPayload['action'];
  };
  /**
   * `change` has no socket counterpart on purpose — `workflow:changed` ships the
   * ENTIRE new workflow, so the browser never needs to know which third of it
   * moved. Notifications and telemetry do, hence the internal discriminator.
   */
  'workflow.changed': DomainEventContext & {
    change: 'statuses' | 'transitions' | 'labels';
  };
  /**
   * Every session this account holds has just been revoked — `token_version`
   * was bumped by a deactivation, an admin force-logout, or a password reset.
   *
   * ACCOUNT-SCOPED, so it carries no {@link DomainEventContext}: there is no
   * project, no originating tab to exclude (the point is that EVERY tab goes),
   * and the actor is an administrator whose own session is untouched.
   *
   * The bump alone stops the next HTTP request and the next socket HANDSHAKE —
   * both re-check `token_version`. It does nothing to a socket that is ALREADY
   * connected, because that check ran once, at connect time. A deactivated user
   * therefore kept receiving live board and notification traffic until they
   * happened to reconnect. The realtime bridge subscribes to this and closes
   * the connections.
   */
  'user.revoked': { userId: Uuid };
  /**
   * An organization has just been archived (`organizations.deleted_at` set by
   * `orgs.service.softDeleteOrg`).
   *
   * ORG-SCOPED, like {@link DomainEventMap['user.revoked']} is account-scoped:
   * no {@link DomainEventContext}, because there is no single project, no
   * originating tab worth excluding (everyone in the org loses access at once),
   * and the actor is a global admin who is not in any of these rooms.
   *
   * WHY IT EXISTS. R2 W3.5 made the HTTP guards and `project:join` refuse an
   * archived org (`middlewares/require-roles.ts` documents the fix), which
   * covers every FUTURE request. It does nothing about a socket that is already
   * sitting in one of the org's project rooms — that membership was checked once,
   * at join time — so those tabs kept receiving task, comment, presence and
   * workflow traffic for an organization the admin had just switched off.
   *
   * `projectIds` is DENORMALISED onto the event, exactly as `task.created`
   * carries its `statusId`: the subscriber must be able to route without a
   * database read, and the publisher already has the ids in hand.
   */
  'org.archived': { orgId: Uuid; projectIds: readonly Uuid[] };
  'notification.created': {
    /** Who the bell badge should light up for. */
    recipientId: Uuid;
    notificationId: Uuid;
    /** Notification kind — the shared closed enum, mirrored by the pg enum. */
    type: NotificationType;
    /** Null for account-level notifications that belong to no project. */
    projectId: Uuid | null;
    actorId: Uuid | null;
    originSocketId: string | null;
  };
}

/** Any event name in the catalogue. */
export type DomainEventName = keyof DomainEventMap;

/** A subscriber. May be async; the bus does not await it. */
export type DomainEventHandler<TName extends DomainEventName> = (
  payload: DomainEventMap[TName],
) => void | Promise<void>;

/** Unsubscribe function returned by `onDomainEvent`. */
export type Unsubscribe = () => void;

/**
 * Storage type for a heterogeneous handler list.
 *
 * `(payload: never) => …` is the trick that makes this work without `any`:
 * function parameters are contravariant, so EVERY concrete
 * `DomainEventHandler<K>` is assignable to it, while nothing can be *called*
 * through it by accident — the call site narrows back with a cast to the
 * handler type the key guarantees.
 */
type StoredHandler = (payload: never) => void | Promise<void>;

const registry = new Map<DomainEventName, StoredHandler[]>();

/**
 * Subscribe to a domain event.
 *
 * @returns an unsubscribe function — call it in tests, or when a subsystem
 * shuts down, so handlers cannot pile up across hot reloads.
 *
 * @example
 *   onDomainEvent('task.moved', ({ projectId, taskId, originSocketId }) => {
 *     getIo().to(`project:${projectId}`).except(originSocketId ?? '').emit(…);
 *   });
 */
export function onDomainEvent<TName extends DomainEventName>(
  name: TName,
  handler: DomainEventHandler<TName>,
): Unsubscribe {
  const handlers = registry.get(name) ?? [];
  handlers.push(handler as StoredHandler);
  registry.set(name, handlers);

  return () => {
    const current = registry.get(name);
    if (!current) return;
    const index = current.indexOf(handler as StoredHandler);
    if (index >= 0) current.splice(index, 1);
  };
}

/**
 * Publish a domain event to every subscriber.
 *
 * Synchronous and non-throwing by contract: handlers are invoked in
 * registration order, a thrown error (or a rejected promise) is logged and
 * swallowed, and the publisher's transaction is never affected.
 */
export function publishDomainEvent<TName extends DomainEventName>(
  name: TName,
  payload: DomainEventMap[TName],
): void {
  const handlers = registry.get(name);
  if (!handlers || handlers.length === 0) return;

  // Copy first: a handler is allowed to unsubscribe itself while it runs.
  for (const stored of [...handlers]) {
    const handler = stored as DomainEventHandler<TName>;
    try {
      const result = handler(payload);
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          logger.error({ err: error, event: name }, 'Domain event handler rejected');
        });
      }
    } catch (error) {
      logger.error({ err: error, event: name }, 'Domain event handler threw');
    }
  }
}

/** How many handlers are registered for an event — diagnostics and tests. */
export function domainEventHandlerCount(name: DomainEventName): number {
  return registry.get(name)?.length ?? 0;
}

/** Drop every subscriber. Test-only; never called from production code. */
export function clearDomainEventHandlers(): void {
  registry.clear();
}
