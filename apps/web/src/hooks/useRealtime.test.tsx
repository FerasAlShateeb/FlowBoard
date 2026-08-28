// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocketAck } from '@flowboard/shared';

import { qk } from '@/lib/query-keys';
import { cancelProjectRefresh, PROJECT_REFRESH_DEBOUNCE_MS } from '@/lib/realtime-cache';
import { useAuthStore, type AuthUser } from '@/stores/useAuthStore';
import { usePresenceStore } from '@/stores/usePresenceStore';
import { useProjectRealtime } from '@/hooks/useRealtime';

/**
 * THE JOIN → INVALIDATION CONTRACT.
 *
 * `useRealtime` owns one decision that cannot be tested anywhere else: after a
 * successful `project:join`, WHICH caches does this tab consider suspect, and
 * how hard does it reconcile them?
 *
 * Both answers are about a gap with no replay buffer behind it:
 *
 *   - a RECONNECT missed an unbounded stretch of events → refetch the project
 *     (debounced, because a flaky link produces bursts of connects);
 *   - a FIRST connect missed the milliseconds between the board query resolving
 *     and the join ack landing → MARK the project stale (`refetchType: 'none'`)
 *     so the next focus reconciles, without doubling the mount's queries.
 *
 * The second case is the regression this suite exists for: it used to do
 * nothing at all, so a broadcast that landed in that window was lost for the
 * lifetime of the view.
 *
 * The transport is faked at the `lib/socket` seam — the module boundary
 * `useRealtime` actually talks to — so no server, no timers inside socket.io,
 * and the connect/reconnect distinction is driven by hand.
 */

const socketMocks = vi.hoisted(() => ({
  /** The `connect` handlers `onSocketConnect` registered. */
  connectHandlers: new Set<(isReconnect: boolean) => void>(),
  /** What the fake gateway answers a `project:join` with. */
  ack: { ok: true } as SocketAck,
  connected: true,
  joins: [] as string[],
  leaves: [] as string[],
}));

vi.mock('@/lib/socket', () => {
  const socket = {
    get connected() {
      return socketMocks.connected;
    },
    on: () => undefined,
    off: () => undefined,
  };

  return {
    connectSocket: () => undefined,
    disconnectSocket: () => undefined,
    getSocket: () => socket,
    getSocketStatus: () => 'connected',
    subscribeSocketStatus: () => () => undefined,
    onSocketConnect: (handler: (isReconnect: boolean) => void) => {
      socketMocks.connectHandlers.add(handler);
      return () => socketMocks.connectHandlers.delete(handler);
    },
    emitProjectJoin: (projectId: string) => {
      socketMocks.joins.push(projectId);
      return Promise.resolve(socketMocks.ack);
    },
    emitProjectLeave: (projectId: string) => {
      socketMocks.leaves.push(projectId);
      return Promise.resolve({ ok: true } as SocketAck);
    },
    emitPresence: () => undefined,
  };
});

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const USER: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ada@flowboard.dev',
  name: 'Ada Lovelace',
  avatarUrl: null,
  isGlobalAdmin: false,
  locale: 'en',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

let queryClient: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** Every invalidation this tab asked for, reduced to what the assertions read. */
function invalidations(): { key: unknown; refetchType: unknown }[] {
  const calls: unknown[][] = invalidate.mock.calls;
  return calls.map((call) => {
    const filters = (call[0] ?? {}) as { queryKey?: unknown; refetchType?: unknown };
    return { key: filters.queryKey, refetchType: filters.refetchType };
  });
}

beforeEach(() => {
  socketMocks.connectHandlers.clear();
  socketMocks.ack = { ok: true };
  socketMocks.connected = true;
  socketMocks.joins = [];
  socketMocks.leaves = [];

  useAuthStore.setState({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    user: USER,
    sessionGeneration: 1,
  });
  usePresenceStore.getState().clearAll();

  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  invalidate = vi.spyOn(queryClient, 'invalidateQueries');
});

afterEach(() => {
  cleanup();
  cancelProjectRefresh();
  queryClient.clear();
  vi.restoreAllMocks();
});

describe('the first successful join', () => {
  it('marks the project prefix stale, so an event missed before the join is not lost forever', async () => {
    // The socket is ALREADY connected — a project switch inside one session,
    // which is the common case and the one that produced no invalidation at all.
    renderHook(
      () => {
        useProjectRealtime(PROJECT_ID);
      },
      { wrapper },
    );

    await vi.waitFor(() => {
      expect(socketMocks.joins).toEqual([PROJECT_ID]);
    });

    await vi.waitFor(() => {
      expect(invalidations()).toContainEqual({
        key: qk.project.all(PROJECT_ID),
        refetchType: 'none',
      });
    });
  });

  it('does NOT refetch — the mount just issued those queries', async () => {
    renderHook(
      () => {
        useProjectRealtime(PROJECT_ID);
      },
      { wrapper },
    );

    await vi.waitFor(() => {
      expect(invalidations().length).toBeGreaterThan(0);
    });

    // Every invalidation on the join path is a mark, never a fetch. An entry
    // without `refetchType` would refetch the whole project on every open.
    for (const call of invalidations()) {
      expect(call.refetchType).toBe('none');
    }
  });

  it('invalidates nothing when the gateway REFUSES the join', async () => {
    socketMocks.ack = { ok: false, code: 'forbidden' };

    renderHook(
      () => {
        useProjectRealtime(PROJECT_ID);
      },
      { wrapper },
    );

    await vi.waitFor(() => {
      expect(socketMocks.joins).toEqual([PROJECT_ID]);
    });
    // A refused join means no room and no events; pretending the cache is
    // suspect would only add requests to a view that is already broken.
    expect(invalidations()).toEqual([]);
  });

  it('joins nothing at all outside a project', () => {
    renderHook(
      () => {
        useProjectRealtime(null);
      },
      { wrapper },
    );

    expect(socketMocks.joins).toEqual([]);
    expect(invalidations()).toEqual([]);
  });
});

describe('a reconnect', () => {
  it('refetches the project rather than only marking it', async () => {
    // Not yet connected on mount, so the join arrives through the connect
    // handler — exactly how a reconnect reaches this code.
    socketMocks.connected = false;

    renderHook(
      () => {
        useProjectRealtime(PROJECT_ID);
      },
      { wrapper },
    );

    const [handler] = [...socketMocks.connectHandlers];
    expect(handler).toBeDefined();
    handler?.(true);

    await vi.waitFor(
      () => {
        expect(invalidations()).toContainEqual({
          key: qk.project.all(PROJECT_ID),
          refetchType: undefined,
        });
      },
      { timeout: PROJECT_REFRESH_DEBOUNCE_MS + 2_000 },
    );
  });
});

describe('teardown', () => {
  it('leaves the room when the view unmounts', async () => {
    const view = renderHook(
      () => {
        useProjectRealtime(PROJECT_ID);
      },
      { wrapper },
    );

    await vi.waitFor(() => {
      expect(socketMocks.joins).toEqual([PROJECT_ID]);
    });

    view.unmount();

    expect(socketMocks.leaves).toEqual([PROJECT_ID]);
  });
});
