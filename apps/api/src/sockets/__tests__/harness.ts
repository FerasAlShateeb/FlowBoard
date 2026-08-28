/**
 * Socket integration-test support: a REAL http server, a real Socket.IO server,
 * and real `socket.io-client` connections over a real ephemeral port.
 *
 * WHY NOT A MOCKED `io`. Everything WP4.1 is responsible for is a property of
 * the transport: whether a handshake is refused, whether a room contains a
 * socket, and — the one that matters most — whether `.except(originSocketId)`
 * actually withholds an event from ONE of two connected clients. A fake `io`
 * whose `to()/except()/emit()` are spies can only assert that the code called
 * the methods we wrote; it cannot assert that the other tab received the event
 * and this one did not. That distinction IS the echo-suppression contract, so
 * the tests pay for two live sockets.
 *
 * Lives in `__tests__/` (like the route suites' fixtures) because `tsconfig`
 * excludes that folder from the build: this module imports `socket.io-client`,
 * a devDependency that must never reach `dist/`.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@flowboard/shared';

import { db, users } from '../../db';
import { clearPresence } from '../presence';
import { __resetRoomCaches } from '../rooms';
import {
  closeSocketServer,
  initSocketServer,
  setSocketUserResolver,
  type FlowBoardServer,
} from '../io';

/** The browser's half of the contract, typed off the same shared maps. */
export type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

export interface Gateway {
  url: string;
  io: FlowBoardServer;
  /** Every client this gateway handed out, so a suite cannot leak one. */
  clients: TestClient[];
  close: () => Promise<void>;
}

/**
 * Boot a gateway on an ephemeral port.
 *
 * The user resolver is wired to the real `users` table — the same lookup
 * `bootstrap()` installs — because the revocation half of the handshake is
 * under test: without it, `io.ts` falls back to its dev-mode "accept on
 * signature alone" branch and the stale-token case would silently pass.
 */
export async function startGateway(): Promise<Gateway> {
  clearPresence();
  __resetRoomCaches();

  const httpServer: HttpServer = createServer();
  const server = initSocketServer(httpServer);

  setSocketUserResolver(async (userId) => {
    const [row] = await db
      .select({ tokenVersion: users.tokenVersion, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('gateway did not bind to a TCP port');
  }
  const { port } = address satisfies AddressInfo;

  const clients: TestClient[] = [];

  return {
    url: `http://127.0.0.1:${String(port)}`,
    io: server,
    clients,
    close: async () => {
      for (const client of clients) client.disconnect();
      clients.length = 0;
      setSocketUserResolver(null);
      await closeSocketServer();
      clearPresence();
      __resetRoomCaches();
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          resolve();
        });
      });
    },
  };
}

/**
 * Connect a client and resolve once the handshake has succeeded.
 *
 * Rejects with the `connect_error` message when it is refused, so a suite can
 * assert on the refusal as easily as on the success. `forceNew` keeps each
 * client on its own Manager: socket.io-client caches managers by URL, and two
 * clients sharing one would share a single transport — and therefore a single
 * socket id, which would make the `except()` assertion meaningless.
 */
export function connectClient(gateway: Gateway, token: string): Promise<TestClient> {
  const client: TestClient = connect(gateway.url, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  gateway.clients.push(client);

  return new Promise<TestClient>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timed out waiting for the handshake'));
    }, 4000);

    client.on('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.on('connect_error', (error: Error) => {
      clearTimeout(timer);
      client.disconnect();
      reject(error);
    });
  });
}

/** Resolve with the next payload of `event`, or reject on timeout. */
export function waitFor<TEvent extends keyof ServerToClientEvents>(
  client: TestClient,
  event: TEvent,
  timeoutMs = 4000,
): Promise<Parameters<ServerToClientEvents[TEvent]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);

    client.once(event, ((payload: Parameters<ServerToClientEvents[TEvent]>[0]) => {
      clearTimeout(timer);
      resolve(payload);
    }) as ServerToClientEvents[TEvent]);
  });
}

/**
 * Assert that `event` does NOT arrive within `windowMs` — the negative half of
 * the echo-suppression test, and the only way to express "this socket was
 * excluded". Always paired with a positive assertion on the OTHER client, so
 * the window is proven long enough by the event that did arrive in it.
 */
export function expectNoEvent<TEvent extends keyof ServerToClientEvents>(
  client: TestClient,
  event: TEvent,
  windowMs = 400,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (() => {
      clearTimeout(timer);
      client.off(event);
      reject(new Error(`${event} was delivered to a socket that should have been excluded`));
    }) as ServerToClientEvents[TEvent];

    const timer = setTimeout(() => {
      client.off(event);
      resolve();
    }, windowMs);

    client.once(event, handler);
  });
}

/**
 * Resolve with the disconnect REASON once the server drops this client.
 *
 * The reason string is the assertion that matters: `disconnectSockets(true)`
 * closes the underlying connection, which socket.io-client reports as
 * `io server disconnect` — a client-side `client.disconnect()` or a transport
 * hiccup would report something else, and only the first one proves the
 * revocation path ran.
 */
export function waitForDisconnect(client: TestClient, timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('disconnect');
      reject(new Error('timed out waiting for the server to close the socket'));
    }, timeoutMs);

    client.once('disconnect', (reason: string) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

/** `emitWithAck`, but typed for the two room events and their `SocketAck`. */
export function joinProject(client: TestClient, projectId: string) {
  return new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timed out waiting for the project:join ack'));
    }, 4000);
    client.emit('project:join', { projectId }, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

/** `project:leave` with its ack. */
export function leaveProject(client: TestClient, projectId: string) {
  return new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timed out waiting for the project:leave ack'));
    }, 4000);
    client.emit('project:leave', { projectId }, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}
