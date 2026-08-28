/**
 * Socket.IO bootstrap: the default namespace, the JWT handshake gate, and the
 * `user:{userId}` room every connection joins.
 *
 * Project rooms, presence and the domain-event → emit bridge are Wave 4 (WP4.1)
 * and attach from their own files — this module owns identity and the server
 * handle, nothing else. WP4.1 added exactly one line to the `connection`
 * handler (`attachRoomHandlers`), so the room/presence protocol stays entirely
 * in `rooms.ts` and this file remains readable as "who is this socket".
 *
 * ── Why the handshake re-checks `tokenVersion` ──────────────────────────────
 * An HTTP request lives milliseconds, so a stale access token is a 15-minute
 * window nobody pays a `SELECT` per request to close. A SOCKET lives for hours.
 * A revoked session (password change, admin force-revoke, deactivation) must
 * not keep streaming a project's task updates until the token happens to
 * expire, so the handshake — once per connection, not once per event — resolves
 * the user and compares versions.
 *
 * ── Injection ───────────────────────────────────────────────────────────────
 * That lookup is a DB read, and WP1.2 must compile with zero imports from
 * `src/db/**`, so it arrives through `setSocketUserResolver()`. With no
 * resolver configured the handshake FAILS CLOSED in production and
 * allows-with-a-warning in development/test — a foundation package that
 * silently accepted revoked tokens in prod would be a security bug shipped by
 * omission.
 */
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  projectRoom,
  userRoom,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '@flowboard/shared';
import { env, isProduction } from '../config/env';
import { extractBearerToken, verifyAccessToken, type TokenPayload } from '../utils/jwt';
import { logger } from '../utils/logger';
import type { AuthenticatedUser } from '../types/auth';
import { attachRoomHandlers } from './rooms';

/**
 * The four generics come from `@flowboard/shared`'s socket contract, so
 * `io.to(room).emit('task:moved', payload)` is checked HERE against the same
 * declaration the browser's listener is checked against. An event name typo or
 * a payload-shape change is a compile error on both ends of the same commit.
 *
 * The room-name builders are re-exported from the same contract rather than
 * rebuilt — a room string that two files spell differently is a listener that
 * silently never fires.
 */
export { projectRoom, userRoom };
export type { SocketData };

/** The concrete server type, so Wave-4 files can annotate without re-deriving. */
export type FlowBoardServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** The concrete socket type for handler signatures. */
export type FlowBoardSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** Resolves the current auth-relevant state of a user id, or null if unknown. */
export type SocketUserResolver = (
  userId: string,
) => Promise<{ tokenVersion: number; isActive: boolean } | null>;

/** Error surfaced to the client's `connect_error` with a machine-readable code. */
export class SocketAuthError extends Error {
  readonly data: { code: string };

  constructor(message: string, code: string) {
    super(message);
    this.name = 'SocketAuthError';
    this.data = { code };
    Object.setPrototypeOf(this, SocketAuthError.prototype);
  }
}

let io: FlowBoardServer | null = null;
let resolveUser: SocketUserResolver | null = null;

/**
 * Wire the handshake's user lookup.
 *
 * INJECTION POINT — call once from the composition root:
 * `setSocketUserResolver(async (id) => userService.getAuthState(id))`.
 * Pass `null` to detach (tests).
 */
export function setSocketUserResolver(resolve: SocketUserResolver | null): void {
  resolveUser = resolve;
}

/** Verify the handshake token and resolve the identity behind it. */
async function authenticate(socket: FlowBoardSocket): Promise<AuthenticatedUser> {
  const handshakeAuth: unknown = socket.handshake.auth;
  const authToken =
    typeof handshakeAuth === 'object' && handshakeAuth !== null
      ? (handshakeAuth as { token?: unknown }).token
      : undefined;
  const token =
    typeof authToken === 'string' && authToken.length > 0
      ? authToken
      : extractBearerToken(socket.handshake.headers.authorization);

  if (token === null || token === undefined) {
    throw new SocketAuthError('Authentication required', 'AUTH_FAILED');
  }

  let payload: TokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new SocketAuthError('Authentication required', 'AUTH_FAILED');
  }

  const resolver = resolveUser;
  if (!resolver) {
    if (isProduction) {
      // Fail closed: without the lookup we cannot honour a revocation.
      logger.error('Socket user resolver is not configured — refusing connections');
      throw new SocketAuthError('Socket authentication unavailable', 'AUTH_UNAVAILABLE');
    }
    logger.warn(
      { userId: payload.sub },
      'Socket user resolver not configured — accepting handshake on token signature alone (dev/test only)',
    );
  } else {
    const current = await resolver(payload.sub);
    if (!current || !current.isActive) {
      throw new SocketAuthError('Account is not active', 'ACCOUNT_DISABLED');
    }
    if (current.tokenVersion !== payload.tokenVersion) {
      // Distinguishable on the wire: the client should refresh and retry after
      // this, but must STOP retrying after ACCOUNT_DISABLED.
      throw new SocketAuthError('Session has been revoked', 'AUTH_FAILED');
    }
  }

  return {
    id: payload.sub,
    isGlobalAdmin: payload.isGlobalAdmin,
    tokenVersion: payload.tokenVersion,
  };
}

/** Create the Socket.IO server on an existing HTTP server. */
export function initSocketServer(httpServer: HttpServer): FlowBoardServer {
  const server: FlowBoardServer = new Server(httpServer, {
    cors: { origin: env.WEB_ORIGIN, credentials: true },
    // The web client sends its id in `X-Socket-Id`; keep the default path.
    serveClient: false,
  });

  server.use((socket, next) => {
    authenticate(socket).then(
      (user) => {
        socket.data.userId = user.id;
        socket.data.isGlobalAdmin = user.isGlobalAdmin;
        socket.data.tokenVersion = user.tokenVersion;
        next();
      },
      (error: unknown) => {
        next(
          error instanceof SocketAuthError
            ? error
            : new SocketAuthError('Authentication failed', 'AUTH_FAILED'),
        );
      },
    );
  });

  server.on('connection', (socket) => {
    const { userId } = socket.data;
    void socket.join(userRoom(userId));
    logger.debug({ socketId: socket.id, userId }, 'Socket connected');

    // WP4.1: `project:join` / `project:leave` / `presence:update`, and the
    // presence cleanup this socket's disconnect owes its rooms.
    attachRoomHandlers(server, socket);

    socket.on('disconnect', (reason) => {
      logger.debug({ socketId: socket.id, userId, reason }, 'Socket disconnected');
    });
  });

  io = server;
  return server;
}

/**
 * The live server.
 *
 * @throws {Error} when called before `initSocketServer` — a subscriber that
 * emits during module evaluation is a wiring bug, and a silent no-op would hide
 * it until someone noticed missing realtime updates in production.
 */
export function getIo(): FlowBoardServer {
  if (!io) throw new Error('Socket.IO server has not been initialised');
  return io;
}

/** The live server, or null — for optional emitters that must not throw. */
export function tryGetIo(): FlowBoardServer | null {
  return io;
}

/**
 * Close the server and drop the singleton (graceful shutdown, tests).
 *
 * Note: Socket.IO's `close()` also closes the HTTP server it was attached to,
 * so `server.ts` treats a subsequent `ERR_SERVER_NOT_RUNNING` as success.
 */
export function closeSocketServer(): Promise<void> {
  const server = io;
  io = null;
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
