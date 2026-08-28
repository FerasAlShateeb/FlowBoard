import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SocketAck } from '@flowboard/shared';

import { setSocketIdProvider } from '@/lib/api';
import { apiBaseUrl } from '@/lib/env';

/**
 * THE SOCKET SINGLETON — one connection per tab, for the whole session.
 *
 * A socket is not a request. Every project view, the notification bell and the
 * presence stack all want realtime, and each one opening its own connection
 * would mean N handshakes, N `user:{id}` room memberships and N socket ids —
 * with only one of them in `X-Socket-Id`, so echo suppression would fail for
 * the other N-1. One connection, many subscriptions, is the whole design.
 *
 * ═══ FOUR THINGS THIS MODULE OWNS ══════════════════════════════════════════
 *
 * 1. **`autoConnect: false`.** The connection is opened when a session exists,
 *    not when this module is first imported. Importing it from a login page
 *    must not fire an unauthenticated handshake that the gateway will refuse.
 *
 * 2. **The auth CALLBACK, not an auth object.** `auth: (cb) => cb({ token })`
 *    is re-invoked on every reconnect attempt, so a socket that dropped while
 *    the access token was expiring reconnects with the token the single-flight
 *    refresh has since written to the store. A static `auth: { token }` would
 *    pin the value captured at connect time and reconnect forever with a token
 *    the gateway rejects.
 *
 * 3. **`setSocketIdProvider` at module init.** This is the browser end of echo
 *    suppression: `lib/api.ts` puts the CURRENT socket id in `X-Socket-Id` on
 *    every mutation, the API carries it as `originSocketId`, and the emitter
 *    uses `.except()` — so the tab that made the change never receives its own
 *    change back on top of its optimistic update. Registered here, at import,
 *    rather than in a hook: a mutation fired before any component mounted a
 *    realtime hook must still carry the header.
 *
 * 4. **A connection status any component can subscribe to**, exposed as a
 *    `useSyncExternalStore` pair rather than as React state, because the
 *    underlying fact lives in a module singleton and several components read it
 *    independently.
 */

/** The client's half of the contract — server→client first, as socket.io-client wants. */
export type FlowBoardSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** What the UI shows: three states, not a boolean. */
export type SocketStatus = 'disconnected' | 'connecting' | 'connected';

/** Returns the current access token, or null when there is no session. */
export type TokenProvider = () => string | null;

let socket: FlowBoardSocket | null = null;
let tokenProvider: TokenProvider = () => null;
let status: SocketStatus = 'disconnected';

/**
 * How many times this tab has established a connection.
 *
 * A RECONNECT is not a first connect: the second one means events were missed
 * while the socket was down, so the project cache has to be re-validated. The
 * `connect` event itself cannot tell them apart, so the count does.
 */
let connectionCount = 0;

const statusListeners = new Set<() => void>();

function setStatus(next: SocketStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of statusListeners) listener();
}

/**
 * Create the client, without connecting.
 *
 * An EMPTY base url means same origin, which is the intended deployment (the
 * Vite dev proxy and nginx both forward `/socket.io`). socket.io-client's
 * single-argument overload is what expresses that — passing `''` as a url is
 * not the same thing.
 */
function createSocket(): FlowBoardSocket {
  const options = {
    autoConnect: false,
    // Re-read on every (re)connect attempt. See note 2 above.
    auth: (cb: (data: object) => void) => {
      cb({ token: tokenProvider() ?? '' });
    },
    // The gateway is same-origin behind the dev proxy / nginx, so the default
    // transports (polling → websocket upgrade) are left in place: a network
    // that blocks upgrades still gets realtime, just over long-polling.
    withCredentials: true,
  };

  const base = apiBaseUrl();
  const created: FlowBoardSocket = base.length > 0 ? io(base, options) : io(options);

  created.on('connect', () => {
    connectionCount += 1;
    setStatus('connected');
  });
  created.on('disconnect', () => {
    setStatus('disconnected');
  });
  created.io.on('reconnect_attempt', () => {
    setStatus('connecting');
  });

  return created;
}

/** The singleton, created on first use. Never connects on its own. */
export function getSocket(): FlowBoardSocket {
  socket ??= createSocket();
  return socket;
}

/**
 * Open the connection (idempotent), using `getToken` for this and every future
 * reconnect.
 *
 * Safe to call on every render of a provider: an already-connected socket is
 * left alone, and only the token source is refreshed.
 */
export function connectSocket(getToken: TokenProvider): FlowBoardSocket {
  tokenProvider = getToken;
  const active = getSocket();
  if (!active.connected) {
    setStatus('connecting');
    active.connect();
  }
  return active;
}

/**
 * Close the connection and forget the token source — sign-out.
 *
 * The socket INSTANCE is kept: its listeners belong to whatever is still
 * mounted, and tearing it down would leave those components subscribed to a
 * dead object. `connect()` on the same instance reconnects cleanly.
 */
export function disconnectSocket(): void {
  tokenProvider = () => null;
  socket?.disconnect();
  setStatus('disconnected');
}

/**
 * The current connection id, or null.
 *
 * This is what `lib/api.ts` sends as `X-Socket-Id`. Null while disconnected,
 * which is correct: with no socket there is no echo to suppress, and the server
 * treats a missing header as "no origin" and broadcasts to everyone.
 */
export function getSocketId(): string | null {
  return socket?.id ?? null;
}

/** Current status, for `useSyncExternalStore`'s `getSnapshot`. */
export function getSocketStatus(): SocketStatus {
  return status;
}

/** How many times this tab has connected. `> 1` means a reconnect happened. */
export function getConnectionCount(): number {
  return connectionCount;
}

/** Subscribe to status changes, for `useSyncExternalStore`'s `subscribe`. */
export function subscribeSocketStatus(onChange: () => void): () => void {
  statusListeners.add(onChange);
  return () => {
    statusListeners.delete(onChange);
  };
}

/**
 * Run `handler` every time the socket (re)connects, and report whether this was
 * a RECONNECT — i.e. whether events were missed while it was down.
 *
 * Returns its own unsubscribe, so it drops straight into a `useEffect`.
 */
export function onSocketConnect(handler: (isReconnect: boolean) => void): () => void {
  const active = getSocket();
  const listener = () => {
    // `createSocket` registers the counter's own `connect` listener first, so
    // by the time this one runs the count already includes this connection —
    // anything past the first is a reconnect, and a reconnect means missed
    // events.
    handler(connectionCount > 1);
  };
  active.on('connect', listener);
  return () => {
    active.off('connect', listener);
  };
}

/**
 * `project:join`, as a promise over the ack.
 *
 * The ack exists because the join is membership-checked: a client that assumed
 * success would render a board that silently never updates, which is
 * indistinguishable from a quiet project.
 */
export function emitProjectJoin(projectId: string): Promise<SocketAck> {
  return new Promise((resolve) => {
    getSocket().emit('project:join', { projectId }, resolve);
  });
}

/** `project:leave`. Resolves even when the socket is already gone. */
export function emitProjectLeave(projectId: string): Promise<SocketAck> {
  return new Promise((resolve) => {
    const active = getSocket();
    if (!active.connected) {
      resolve({ ok: true });
      return;
    }
    active.emit('project:leave', { projectId }, resolve);
  });
}

/** `presence:update` — fire-and-forget by contract; there is no ack. */
export function emitPresence(projectId: string, taskId: string | null): void {
  const active = getSocket();
  if (!active.connected) return;
  active.emit('presence:update', { projectId, taskId });
}

/**
 * TEST SEAM: drop the singleton so the next `getSocket()` builds a fresh one.
 * Never called from application code.
 */
export function __resetSocketForTests(): void {
  socket?.removeAllListeners();
  socket = null;
  tokenProvider = () => null;
  status = 'disconnected';
  connectionCount = 0;
  statusListeners.clear();
}

// ───────────────────────────────────────────────────────────────────────────
// Echo suppression, wired at import time. See note 3 in the header.
// ───────────────────────────────────────────────────────────────────────────
setSocketIdProvider(getSocketId);
