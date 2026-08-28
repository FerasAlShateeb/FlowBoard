/**
 * The client→server half of the gateway: `project:join`, `project:leave` and
 * `presence:update`.
 *
 * `io.ts` owns identity (the handshake, `user:{id}`) and stops there. This file
 * owns everything a connected socket can ASK for, and there are only three
 * things — which is the point: a socket is a subscription, not a second API.
 * Nothing here mutates domain data; the browser still does that over HTTP.
 *
 * ── EVERY JOIN IS MEMBERSHIP-CHECKED ────────────────────────────────────────
 * A project room carries task titles, comment bodies and who is reading what.
 * `resolveProjectRole` (the same function `requireProjectRole` uses, exported
 * for exactly this) runs the full inheritance chain — global admin ⊃ org admin
 * ⊃ project member — and a `null` role is a `FORBIDDEN` ack. `viewer` is the
 * floor: reading a board is a read, and the room only ever carries reads.
 *
 * The result is ACKED rather than assumed. A client that silently failed to
 * join would show a board that never updates and no way to tell that from a
 * quiet project, so the contract makes the client learn the answer
 * (`socketAckSchema` — `ok:false` plus a stable `code`).
 *
 * ── PRESENCE IS THROTTLED HERE, NOT ON THE CLIENT ───────────────────────────
 * `presence:update` fires on navigation, and a client bug (or a hostile one)
 * could fire it in a loop — each one costing a broadcast to every socket in the
 * room. One update per second per socket is far more than a human generates and
 * far less than a loop does. The excess is DROPPED, not queued: presence is a
 * current-state fact, so the next update supersedes the one that was dropped.
 *
 * ── WHY THE USER SUMMARY IS FETCHED ONCE ────────────────────────────────────
 * The roster needs a name and an avatar, and the handshake only leaves an id in
 * `socket.data` (`SocketData` is a shared type this package must not widen). It
 * is read on the FIRST join and cached for the life of the socket: a connection
 * that never opens a project — the notification-only case — never pays for it,
 * and one that hops between five projects pays once.
 */
import {
  presenceUpdatePayloadSchema,
  projectRoom,
  projectRoomPayloadSchema,
} from '@flowboard/shared';
import type { PresenceStatePayload, SocketAck, UserSummary } from '@flowboard/shared';

import { resolveProjectRole } from '../middlewares/require-roles';
import { logger } from '../utils/logger';
import {
  presenceRoster,
  removePresence,
  removeSocket,
  setPresence,
  updatePresenceTask,
} from './presence';
import { loadProjectRef, loadUserSummary } from './socket-reads';
// TYPE-ONLY, deliberately: `io.ts` imports `attachRoomHandlers` from here, so a
// value import would close a runtime require() cycle. `projectRoom` comes
// straight from the shared contract above instead of through `io.ts`'s
// re-export, which keeps this file's only edge to `io.ts` erased at compile
// time.
import type { FlowBoardServer, FlowBoardSocket } from './io';

/** Minimum gap between two accepted `presence:update`s from one socket. */
export const PRESENCE_THROTTLE_MS = 1000;

/** `socketId` → the summary the roster renders. Dropped on disconnect. */
const userCache = new Map<string, UserSummary>();

/** `socketId` → when its last `presence:update` was accepted. */
const lastPresenceAt = new Map<string, number>();

/** Test seam: forget the per-socket caches between suites. */
export function __resetRoomCaches(): void {
  userCache.clear();
  lastPresenceAt.clear();
}

/** Answer an ack callback, tolerating a client that did not supply one. */
function reply(ack: ((result: SocketAck) => void) | undefined, result: SocketAck): void {
  if (typeof ack === 'function') ack(result);
}

/** Broadcast the whole roster of one project to everyone in its room. */
function broadcastRoster(io: FlowBoardServer, projectId: string): void {
  const payload: PresenceStatePayload = { projectId, entries: presenceRoster(projectId) };
  io.to(projectRoom(projectId)).emit('presence:state', payload);
}

/** The socket's user summary, read once and cached for the connection. */
async function summaryFor(socket: FlowBoardSocket): Promise<UserSummary | null> {
  const cached = userCache.get(socket.id);
  if (cached) return cached;
  const summary = await loadUserSummary(socket.data.userId);
  if (summary) userCache.set(socket.id, summary);
  return summary;
}

/** `project:join` — membership-checked, then room + presence + roster. */
async function handleJoin(
  io: FlowBoardServer,
  socket: FlowBoardSocket,
  rawPayload: unknown,
): Promise<SocketAck> {
  const parsed = projectRoomPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return { ok: false, code: 'BAD_REQUEST', message: 'Invalid payload' };
  const { projectId } = parsed.data;

  const ref = await loadProjectRef(projectId);
  if (!ref) return { ok: false, code: 'NOT_FOUND', message: 'Project not found' };

  const role = await resolveProjectRole(
    { id: socket.data.userId, isGlobalAdmin: socket.data.isGlobalAdmin },
    ref,
  );
  if (role === null) {
    return { ok: false, code: 'FORBIDDEN', message: 'You do not have access to this project' };
  }

  await socket.join(projectRoom(projectId));

  const user = await summaryFor(socket);
  if (user) {
    setPresence(projectId, { socketId: socket.id, user, taskId: null });
    broadcastRoster(io, projectId);
  }

  return { ok: true };
}

/** `project:leave` — always succeeds; leaving a room you are not in is a no-op. */
async function handleLeave(
  io: FlowBoardServer,
  socket: FlowBoardSocket,
  rawPayload: unknown,
): Promise<SocketAck> {
  const parsed = projectRoomPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return { ok: false, code: 'BAD_REQUEST', message: 'Invalid payload' };
  const { projectId } = parsed.data;

  await socket.leave(projectRoom(projectId));
  // Broadcast AFTER the removal so the leaver is already gone from the roster,
  // and to the room they just left — which no longer includes them.
  if (removePresence(projectId, socket.id)) broadcastRoster(io, projectId);

  return { ok: true };
}

/**
 * `presence:update` — "I am now looking at this". Fire-and-forget by contract
 * (no ack in `ClientToServerEvents`), so failures are logged, never returned.
 */
function handlePresenceUpdate(
  io: FlowBoardServer,
  socket: FlowBoardSocket,
  rawPayload: unknown,
): void {
  const parsed = presenceUpdatePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return;

  const now = Date.now();
  const previous = lastPresenceAt.get(socket.id);
  if (previous !== undefined && now - previous < PRESENCE_THROTTLE_MS) return;
  lastPresenceAt.set(socket.id, now);

  const { projectId, taskId } = parsed.data;
  // `updatePresenceTask` returns false for a socket that never joined this
  // room — an update is not an implicit, unchecked join — and also for a
  // no-op repeat of the same task, which saves the room a broadcast.
  if (updatePresenceTask(projectId, socket.id, taskId)) broadcastRoster(io, projectId);
}

/**
 * Wire the three client events (plus presence cleanup) onto one socket.
 *
 * Called from `io.ts`'s `connection` handler. Every handler is `void`-wrapped
 * with a `.catch`: an unhandled rejection inside a Socket.IO listener takes the
 * process down, and a failed membership lookup must be one denied join, not an
 * outage.
 */
export function attachRoomHandlers(io: FlowBoardServer, socket: FlowBoardSocket): void {
  socket.on('project:join', (payload, ack) => {
    void handleJoin(io, socket, payload).then(
      (result) => {
        reply(ack, result);
      },
      (error: unknown) => {
        logger.error({ err: error, socketId: socket.id }, 'project:join failed');
        reply(ack, { ok: false, code: 'INTERNAL', message: 'Could not join the project' });
      },
    );
  });

  socket.on('project:leave', (payload, ack) => {
    void handleLeave(io, socket, payload).then(
      (result) => {
        reply(ack, result);
      },
      (error: unknown) => {
        logger.error({ err: error, socketId: socket.id }, 'project:leave failed');
        reply(ack, { ok: false, code: 'INTERNAL', message: 'Could not leave the project' });
      },
    );
  });

  socket.on('presence:update', (payload) => {
    try {
      handlePresenceUpdate(io, socket, payload);
    } catch (error) {
      logger.error({ err: error, socketId: socket.id }, 'presence:update failed');
    }
  });

  socket.on('disconnect', () => {
    // Socket.IO leaves the rooms itself; the roster is ours to clean up. The
    // broadcast goes to the room the socket has already been removed from, so
    // the departing client does not receive its own removal.
    for (const projectId of removeSocket(socket.id)) broadcastRoster(io, projectId);
    userCache.delete(socket.id);
    lastPresenceAt.delete(socket.id);
  });
}
