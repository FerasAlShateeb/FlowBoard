import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The socket singleton, driven against a FAKE `socket.io-client`.
 *
 * There is no server here on purpose: the three properties this module is
 * responsible for are all observable from the client side alone —
 *
 *   1. the auth CALLBACK re-reads the token on every connect attempt, which is
 *      what makes a reconnect after a refresh carry the new token;
 *   2. `getSocketId()` reports the live id, which is what `X-Socket-Id` sends
 *      and therefore the entire browser half of echo suppression;
 *   3. a RECONNECT is distinguishable from a first connect, which is what tells
 *      `useProjectRealtime` that it missed events and must re-validate.
 *
 * The API-side suites already prove the wire behaviour with two real sockets.
 */

interface FakeSocket {
  id: string | undefined;
  connected: boolean;
  io: { on: (event: string, listener: () => void) => void; off: (event: string) => void };
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  off: (event: string, listener?: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
  connect: () => void;
  disconnect: () => void;
  removeAllListeners: () => void;
  /** Test-only: drive an event as if the transport had produced it. */
  fire: (event: string, ...args: unknown[]) => void;
  /** Test-only: everything `emit` was called with. */
  emitted: { event: string; args: unknown[] }[];
  /** Test-only: the options the module constructed the client with. */
  options: { auth?: (cb: (data: object) => void) => void; autoConnect?: boolean };
}

let fake: FakeSocket;

function createFake(options: FakeSocket['options']): FakeSocket {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const managerListeners = new Map<string, Set<() => void>>();

  const socket: FakeSocket = {
    id: undefined,
    connected: false,
    options,
    emitted: [],
    io: {
      on: (event, listener) => {
        const set = managerListeners.get(event) ?? new Set();
        set.add(listener);
        managerListeners.set(event, set);
      },
      off: (event) => managerListeners.delete(event),
    },
    on: (event, listener) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    off: (event, listener) => {
      if (listener === undefined) listeners.delete(event);
      else listeners.get(event)?.delete(listener);
    },
    emit: (event, ...args) => {
      socket.emitted.push({ event, args });
    },
    connect: () => {
      socket.id = `sock-${String(socket.emitted.length)}-${String(Date.now())}`;
      socket.connected = true;
      socket.fire('connect');
    },
    disconnect: () => {
      socket.connected = false;
      socket.id = undefined;
      socket.fire('disconnect', 'io client disconnect');
    },
    removeAllListeners: () => {
      listeners.clear();
      managerListeners.clear();
    },
    fire: (event, ...args) => {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
      for (const listener of [...(managerListeners.get(event) ?? [])]) listener();
    },
  };

  return socket;
}

vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => {
    const options = (args.length > 1 ? args[1] : args[0]) as FakeSocket['options'];
    fake = createFake(options);
    return fake;
  },
}));

const socketIdProvider = vi.fn();
vi.mock('@/lib/api', () => ({
  setSocketIdProvider: (provider: unknown) => {
    socketIdProvider(provider);
  },
}));

type SocketModule = typeof import('@/lib/socket');

/**
 * A fresh module graph per test.
 *
 * The module under test is a SINGLETON by design — one connection per tab — so
 * the state it holds (the socket, the status, the connection count) survives
 * between tests unless the registry is reset. `resetModules` is cleaner than a
 * test-only reset here because it also re-runs the `setSocketIdProvider` wiring
 * at import, which is itself one of the assertions.
 */
async function loadModule(): Promise<SocketModule> {
  vi.resetModules();
  socketIdProvider.mockClear();
  return import('@/lib/socket');
}

let socketModule: SocketModule;

beforeEach(async () => {
  socketModule = await loadModule();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('echo suppression wiring', () => {
  /** The browser half of `X-Socket-Id`. Registered at IMPORT, so a mutation
   *  fired before any realtime hook mounts still carries the header. */
  it('registers the socket-id provider with lib/api at module init', () => {
    expect(socketIdProvider).toHaveBeenCalledTimes(1);
    expect(socketIdProvider).toHaveBeenCalledWith(socketModule.getSocketId);
  });

  it('reports null while disconnected — no socket means no echo to suppress', () => {
    expect(socketModule.getSocketId()).toBeNull();
  });

  it('reports the live id once connected', () => {
    socketModule.connectSocket(() => 'token');

    expect(socketModule.getSocketId()).toBe(fake.id);
    expect(socketModule.getSocketId()).toBeTruthy();
  });
});

describe('the connection', () => {
  it('does not connect on import', () => {
    socketModule.getSocket();

    expect(fake.options.autoConnect).toBe(false);
    expect(fake.connected).toBe(false);
  });

  /**
   * The auth CALLBACK, not a static auth object: it is re-invoked on every
   * reconnect attempt, so a socket that dropped while the access token was
   * expiring reconnects with whatever the single-flight refresh has since
   * written to the store.
   */
  it('re-reads the token on every connect attempt', () => {
    let token = 'first-token';
    socketModule.connectSocket(() => token);

    const read = (): unknown => {
      let captured: unknown;
      fake.options.auth?.((data) => {
        captured = data;
      });
      return captured;
    };

    expect(read()).toEqual({ token: 'first-token' });

    token = 'refreshed-token';
    expect(read()).toEqual({ token: 'refreshed-token' });
  });

  it('sends an empty token when there is no session', () => {
    socketModule.connectSocket(() => null);

    let captured: unknown;
    fake.options.auth?.((data) => {
      captured = data;
    });
    expect(captured).toEqual({ token: '' });
  });

  it('is idempotent — a second connect on a live socket is a no-op', () => {
    socketModule.connectSocket(() => 'token');
    const id = socketModule.getSocketId();

    socketModule.connectSocket(() => 'token');

    expect(socketModule.getSocketId()).toBe(id);
  });

  it('reports connecting, then connected, then disconnected', () => {
    expect(socketModule.getSocketStatus()).toBe('disconnected');

    socketModule.connectSocket(() => 'token');
    expect(socketModule.getSocketStatus()).toBe('connected');

    socketModule.disconnectSocket();
    expect(socketModule.getSocketStatus()).toBe('disconnected');
  });

  it('notifies status subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = socketModule.subscribeSocketStatus(listener);

    socketModule.connectSocket(() => 'token');
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    socketModule.disconnectSocket();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('reconnect detection', () => {
  /**
   * The whole reason this distinction exists: a RECONNECT means events were
   * missed while the socket was down (there is no replay buffer), so the tab
   * has to re-join the room AND re-validate its project cache. A first connect
   * has nothing to catch up on, and invalidating there would refetch a board
   * that was just fetched on mount.
   */
  it('reports isReconnect=false on the first connect', () => {
    const handler = vi.fn();
    socketModule.onSocketConnect(handler);

    socketModule.connectSocket(() => 'token');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(false);
  });

  it('reports isReconnect=true on every connect after the first', () => {
    const handler = vi.fn();
    socketModule.onSocketConnect(handler);

    socketModule.connectSocket(() => 'token');
    fake.disconnect();
    fake.connect();

    expect(handler).toHaveBeenNthCalledWith(1, false);
    expect(handler).toHaveBeenNthCalledWith(2, true);
  });

  it('stops calling the handler after unsubscribe', () => {
    const handler = vi.fn();
    const unsubscribe = socketModule.onSocketConnect(handler);

    socketModule.connectSocket(() => 'token');
    unsubscribe();
    fake.disconnect();
    fake.connect();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('counts connections', () => {
    socketModule.connectSocket(() => 'token');
    fake.disconnect();
    fake.connect();

    expect(socketModule.getConnectionCount()).toBe(2);
  });
});

describe('room and presence emits', () => {
  it('emits project:join with the room payload', async () => {
    socketModule.connectSocket(() => 'token');

    const pending = socketModule.emitProjectJoin('project-1');
    const sent = fake.emitted.find((entry) => entry.event === 'project:join');
    expect(sent?.args[0]).toEqual({ projectId: 'project-1' });

    // Resolve the ack the way the gateway would.
    (sent?.args[1] as (ack: { ok: boolean }) => void)({ ok: true });
    await expect(pending).resolves.toEqual({ ok: true });
  });

  /** A leave for an already-dead socket must resolve, not hang a cleanup. */
  it('resolves project:leave without emitting when disconnected', async () => {
    await expect(socketModule.emitProjectLeave('project-1')).resolves.toEqual({ ok: true });
    expect(fake.emitted.filter((entry) => entry.event === 'project:leave')).toEqual([]);
  });

  it('emits presence:update with the task the tab is on', () => {
    socketModule.connectSocket(() => 'token');

    socketModule.emitPresence('project-1', 'task-9');

    expect(fake.emitted).toContainEqual({
      event: 'presence:update',
      args: [{ projectId: 'project-1', taskId: 'task-9' }],
    });
  });

  it('drops a presence update while disconnected rather than queueing it', () => {
    socketModule.emitPresence('project-1', null);

    expect(fake.emitted).toEqual([]);
  });
});
