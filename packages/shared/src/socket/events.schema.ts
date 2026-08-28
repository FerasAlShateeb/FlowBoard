// The Socket.IO protocol: payload schemas for every realtime event, plus the two
// typed event maps `socket.io` and `socket.io-client` are generic over, so both
// ends get `emit`/`on` autocompletion off the same source.
//
// SHAPE OF THE PROTOCOL (see the plan's socket map):
//   - default namespace; JWT in `handshake.auth.token`, `tokenVersion` re-checked
//     on connect so a revoked token cannot hold a live socket open;
//   - rooms: `user:{userId}` joined automatically, `project:{projectId}` joined on
//     demand and membership-checked in the ack;
//   - ECHO SUPPRESSION: the web sends its socket id as `X-Socket-Id` on every
//     mutation, services carry it as `originSocketId`, and the emitter uses
//     `io.to(room).except(originSocketId)`. The actor's own cache is written by
//     its optimistic update and the HTTP response — never twice.
//
// Payloads carry `taskSummarySchema`, not the full task: these events patch board
// caches, and the detail sheet refetches. Every payload includes `projectId` so a
// listener can route to a cache key without consulting the room it arrived on.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { isoDateTime, uuid } from '../common';
import { commentSchema } from '../comments.schema';
import { notificationSchema } from '../notifications.schema';
import { sprintSchema } from '../sprints.schema';
import { rankSchema, taskSummarySchema } from '../tasks.schema';
import { userSummarySchema } from '../users.schema';
import { workflowSchema } from '../workflow.schema';

/** The room a user's personal events (notifications) are delivered to. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** The room every event about one project is delivered to. */
export function projectRoom(projectId: string): string {
  return `project:${projectId}`;
}

/** `handshake.auth` — the access token, verified exactly like a Bearer header. */
export const socketAuthSchema = z.object({
  token: z.string().min(1),
});
export type SocketAuth = z.infer<typeof socketAuthSchema>;

/**
 * The single ack shape for every client->server event. `ok: false` carries a
 * stable `code` (`FORBIDDEN`, `NOT_FOUND`) so a join denied by membership is
 * distinguishable from a transport failure, which is a retry and this is not.
 */
export const socketAckSchema = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type SocketAck = z.infer<typeof socketAckSchema>;

/** `project:join` / `project:leave` — the room to enter or leave. */
export const projectRoomPayloadSchema = z.object({
  projectId: uuid,
});
export type ProjectRoomPayload = z.infer<typeof projectRoomPayloadSchema>;

/**
 * `presence:update` (C->S) — what this client is currently looking at, so other
 * viewers see an avatar on the task. `taskId: null` means "on the board, not in a
 * task".
 */
export const presenceUpdatePayloadSchema = z.object({
  projectId: uuid,
  taskId: uuid.nullable(),
});
export type PresenceUpdatePayload = z.infer<typeof presenceUpdatePayloadSchema>;

/** One person currently in a project room. */
export const presenceEntrySchema = z.object({
  user: userSummarySchema,
  /** The task they have open, or `null` when they are on a project-level view. */
  taskId: uuid.nullable(),
});
export type PresenceEntry = z.infer<typeof presenceEntrySchema>;

/**
 * `presence:state` (S->C) — the FULL set for a project room, re-broadcast on
 * every join/leave/update rather than diffed. A room holds a handful of people,
 * so a whole-set payload is smaller than the bookkeeping a diff protocol needs to
 * survive a reconnect.
 */
export const presenceStatePayloadSchema = z.object({
  projectId: uuid,
  entries: z.array(presenceEntrySchema),
});
export type PresenceStatePayload = z.infer<typeof presenceStatePayloadSchema>;

/** `task:created` — splice the card into its column. */
export const taskCreatedPayloadSchema = z.object({
  projectId: uuid,
  task: taskSummarySchema,
});
export type TaskCreatedPayload = z.infer<typeof taskCreatedPayloadSchema>;

/**
 * `task:updated` — replace the card; the detail sheet refetches separately.
 *
 * ── `changedFields` ─────────────────────────────────────────────────────────
 * Which columns the update actually touched, when the publisher knows. Four
 * different mutations collapse into this one event — a field patch, a backlog
 * re-rank, a dependency edge, an attachment confirmation — and the new summary
 * alone cannot tell them apart, because a dependency edge changes no field the
 * summary carries.
 *
 * The one cache that needs the distinction is the Roadmap's arrow layer
 * (`qk.project.dependencies`), which lives outside the task prefix and is
 * therefore missed by every task invalidation. Without this field the client
 * had to invalidate the whole edge set on EVERY remote keystroke; with it, only
 * when `'dependencies'` is named.
 *
 * OPTIONAL, and a receiver must treat an absent value as "unknown", not as
 * "nothing changed" — a publisher that cannot enumerate the change omits it,
 * and the conservative fallback (invalidate) is the correct reading. The values
 * are entity field names (`'title'`, `'dependencies'`, `'attachments'`), left
 * as a loose `string[]` on purpose: this is a HINT for cache targeting, and a
 * closed enum here would turn adding a column into a wire-contract change.
 */
export const taskUpdatedPayloadSchema = z.object({
  projectId: uuid,
  task: taskSummarySchema,
  changedFields: z.array(z.string()).optional(),
});
export type TaskUpdatedPayload = z.infer<typeof taskUpdatedPayloadSchema>;

/** `task:deleted` — a soft delete; the card leaves every cached list. */
export const taskDeletedPayloadSchema = z.object({
  projectId: uuid,
  taskId: uuid,
});
export type TaskDeletedPayload = z.infer<typeof taskDeletedPayloadSchema>;

/**
 * `task:moved` — the drop, as the smallest patch that can reproduce it:
 * which task, which column, which rank.
 *
 * `rebalanced: true` means the move rewrote the whole column's ranks, so a
 * listener's other cached ranks are stale and it must INVALIDATE the board
 * instead of splicing this one card.
 *
 * ── `updatedAt` — the version stamp that makes the splice orderable ──────────
 * The row's `updated_at` AS THE MOVE TRANSACTION WROTE IT. Every other task
 * write in the product — the mutation response and `task:updated` alike — is
 * ordered by this stamp (`isStaleTaskWrite` on the web), so a broadcast and the
 * HTTP response describing the same edit can arrive either way round without
 * the older one repainting the card.
 *
 * Without it this event was the one unordered task write: it carried a
 * destination and a rank and no version at all, so two moves of the same card
 * delivered out of order left the board showing the first one. It is read
 * INSIDE the move transaction rather than from a post-commit re-read, for the
 * same reason the audience ids are: a re-read can pick up a LATER writer's
 * timestamp and make this move look newer than the edit that actually followed
 * it, which inverts the very ordering the stamp exists to establish.
 */
export const taskMovedPayloadSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  statusId: uuid,
  boardRank: rankSchema,
  rebalanced: z.boolean(),
  updatedAt: isoDateTime,
});
export type TaskMovedPayload = z.infer<typeof taskMovedPayloadSchema>;

/** `comment:created`. */
export const commentCreatedPayloadSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  comment: commentSchema,
});
export type CommentCreatedPayload = z.infer<typeof commentCreatedPayloadSchema>;

/** `comment:updated`. */
export const commentUpdatedPayloadSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  comment: commentSchema,
});
export type CommentUpdatedPayload = z.infer<typeof commentUpdatedPayloadSchema>;

/** `comment:deleted`. */
export const commentDeletedPayloadSchema = z.object({
  projectId: uuid,
  taskId: uuid,
  commentId: uuid,
});
export type CommentDeletedPayload = z.infer<typeof commentDeletedPayloadSchema>;

/**
 * `sprint:changed` — one event for the whole sprint lifecycle, discriminated by
 * `action`, because every listener does the same thing (invalidate the backlog
 * and the sprint list) regardless of which change it was. `sprint` is `null` only
 * for `deleted`.
 */
export const sprintChangedPayloadSchema = z.object({
  projectId: uuid,
  sprintId: uuid,
  action: z.enum(['created', 'updated', 'started', 'completed', 'deleted']),
  sprint: sprintSchema.nullable(),
});
export type SprintChangedPayload = z.infer<typeof sprintChangedPayloadSchema>;

/**
 * `workflow:changed` — carries the ENTIRE new workflow rather than a diff, so an
 * open board re-renders its columns and its forbidden-drop styling from the
 * payload alone.
 */
export const workflowChangedPayloadSchema = z.object({
  projectId: uuid,
  ...workflowSchema.shape,
});
export type WorkflowChangedPayload = z.infer<typeof workflowChangedPayloadSchema>;

/**
 * `notification:new` — delivered to `user:{userId}`, never a project room. Ships
 * the new unread total alongside the row so the badge never needs a follow-up
 * fetch.
 */
export const notificationNewPayloadSchema = z.object({
  notification: notificationSchema,
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationNewPayload = z.infer<typeof notificationNewPayloadSchema>;

/**
 * Every event name in one place — import this instead of typing the strings, so
 * a rename is a compile error rather than a listener that silently never fires.
 */
export const SOCKET_EVENTS = {
  // client -> server
  PROJECT_JOIN: 'project:join',
  PROJECT_LEAVE: 'project:leave',
  PRESENCE_UPDATE: 'presence:update',
  // server -> client
  PRESENCE_STATE: 'presence:state',
  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  TASK_DELETED: 'task:deleted',
  TASK_MOVED: 'task:moved',
  COMMENT_CREATED: 'comment:created',
  COMMENT_UPDATED: 'comment:updated',
  COMMENT_DELETED: 'comment:deleted',
  SPRINT_CHANGED: 'sprint:changed',
  WORKFLOW_CHANGED: 'workflow:changed',
  NOTIFICATION_NEW: 'notification:new',
} as const;

/** Union of every event name the protocol defines. */
export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/**
 * Registry of server->client payload schemas keyed by event name — what the web's
 * socket wrapper parses an incoming payload with before it touches a cache. A
 * malformed payload is then a logged parse failure, not a corrupted board.
 */
export const serverToClientEventSchemas = {
  'presence:state': presenceStatePayloadSchema,
  'task:created': taskCreatedPayloadSchema,
  'task:updated': taskUpdatedPayloadSchema,
  'task:deleted': taskDeletedPayloadSchema,
  'task:moved': taskMovedPayloadSchema,
  'comment:created': commentCreatedPayloadSchema,
  'comment:updated': commentUpdatedPayloadSchema,
  'comment:deleted': commentDeletedPayloadSchema,
  'sprint:changed': sprintChangedPayloadSchema,
  'workflow:changed': workflowChangedPayloadSchema,
  'notification:new': notificationNewPayloadSchema,
} as const;

/** Registry of client->server payload schemas — what the gateway validates on. */
export const clientToServerEventSchemas = {
  'project:join': projectRoomPayloadSchema,
  'project:leave': projectRoomPayloadSchema,
  'presence:update': presenceUpdatePayloadSchema,
} as const;

/**
 * Server -> client map. Both `Server<…>` (api) and `Socket<…>` (web) are generic
 * over this, so `io.to(room).emit('task:moved', payload)` is checked at both ends
 * against the same declaration.
 */
export interface ServerToClientEvents {
  'presence:state': (payload: PresenceStatePayload) => void;
  'task:created': (payload: TaskCreatedPayload) => void;
  'task:updated': (payload: TaskUpdatedPayload) => void;
  'task:deleted': (payload: TaskDeletedPayload) => void;
  'task:moved': (payload: TaskMovedPayload) => void;
  'comment:created': (payload: CommentCreatedPayload) => void;
  'comment:updated': (payload: CommentUpdatedPayload) => void;
  'comment:deleted': (payload: CommentDeletedPayload) => void;
  'sprint:changed': (payload: SprintChangedPayload) => void;
  'workflow:changed': (payload: WorkflowChangedPayload) => void;
  'notification:new': (payload: NotificationNewPayload) => void;
}

/**
 * Client -> server map. The two room events take an ACK callback: joining a
 * project room is membership-checked, so the client has to learn whether it is
 * actually receiving that project's events rather than assuming it.
 */
export interface ClientToServerEvents {
  'project:join': (payload: ProjectRoomPayload, ack: (result: SocketAck) => void) => void;
  'project:leave': (payload: ProjectRoomPayload, ack: (result: SocketAck) => void) => void;
  'presence:update': (payload: PresenceUpdatePayload) => void;
}

/** Inter-server events — declared empty; FlowBoard runs a single Socket.IO node. */
export type InterServerEvents = Record<string, never>;

/**
 * Per-connection state the gateway attaches after the handshake
 * (`socket.data`), so every handler has the authenticated identity without
 * re-verifying the token.
 *
 * Server-side only — `socket.data` never crosses the wire — but declared here
 * because it is the fourth generic argument of the same `Server<…>` /
 * `Socket<…>` types the maps above parameterize, and splitting one type
 * signature across two packages is how the two halves drift.
 *
 * `tokenVersion` is retained from the handshake (where it was compared against
 * the `users` row) so a long-lived socket can be re-checked on demand without
 * decoding its token again.
 */
export interface SocketData {
  /** `users.id` — the verified `sub` of the handshake token. */
  userId: string;
  isGlobalAdmin: boolean;
  tokenVersion: number;
}
