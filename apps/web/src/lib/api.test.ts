import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  TOKEN_EXPIRED_CODE,
  __resetRefreshStateForTests,
  api,
  setSocketIdProvider,
  toQuery,
} from '@/lib/api';
import { useAuthStore, type AuthUser } from '@/stores/useAuthStore';

/**
 * `lib/api` is the file every other request in the app funnels through, so
 * these suites cover the three behaviours a caller relies on and cannot see:
 * the envelope is unwrapped, a failure becomes a typed `ApiError`, and a burst
 * of expired requests produces exactly ONE refresh.
 *
 * `fetch` is mocked at the global level rather than through a transport seam —
 * that is the boundary the module actually talks to, so the test exercises the
 * real header assembly, the real retry, and the real JSON handling.
 */

const USER: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@flowboard.dev',
  name: 'Ada Lovelace',
  avatarUrl: null,
  isGlobalAdmin: true,
  locale: 'en',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** A `Response` carrying a JSON envelope. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function successBody(data: unknown, meta?: unknown) {
  return meta === undefined ? { success: true, data } : { success: true, data, meta };
}

function errorBody(code: string, message = 'nope') {
  return { success: false, error: { code, message } };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetRefreshStateForTests();
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toQuery', () => {
  it('drops empty values and comma-joins arrays', () => {
    expect(
      toQuery({
        page: 2,
        q: '',
        assignee: null,
        sprint: undefined,
        label: ['bug', 'ui'],
        done: false,
      }),
    ).toBe('?page=2&label=bug%2Cui&done=false');
  });

  it('returns an empty string when nothing survives', () => {
    expect(toQuery({ q: '', label: [], missing: undefined })).toBe('');
  });
});

describe('envelope unwrapping', () => {
  it('returns the data payload on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, successBody({ id: 't-1', title: 'Ship it' })),
    );

    await expect(api.get('/tasks/t-1')).resolves.toEqual({ id: 't-1', title: 'Ship it' });
  });

  it('exposes pagination meta through api.paged', async () => {
    const meta = { page: 1, pageSize: 25, total: 3, totalPages: 1 };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, successBody([], meta)));

    await expect(api.paged('/projects/p-1/tasks')).resolves.toEqual({ data: [], meta });
  });

  it('throws a typed ApiError carrying the envelope code', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, errorBody('forbidden', 'Viewers cannot write')),
    );

    // The code is the contract; the message is only a fallback for logs.
    await expect(api.post('/tasks', {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'forbidden',
      message: 'Viewers cannot write',
    });
  });

  it('treats a 204 with no body as success, not as a malformed envelope', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(api.del('/tasks/t-1/watchers/me')).resolves.toBeUndefined();
  });

  it('surfaces a fetch rejection as a network ApiError rather than a raw TypeError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = await api.get('/health').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'network_error' });
  });

  it('runs the zod schema against the payload when one is given', async () => {
    const { z } = await import('zod');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, successBody({ id: 7 })));

    // `id` is a number on the wire but the schema demands a string: the parse
    // must reject rather than let a wrong-typed value into the cache.
    await expect(api.get('/whoami', { schema: z.object({ id: z.string() }) })).rejects.toThrow();
  });

  it('sends the bearer token from the auth store', async () => {
    useAuthStore.setState({ accessToken: 'access-1', refreshToken: 'refresh-1', user: USER });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, successBody(null)));

    await api.get('/auth/me');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
  });
});

describe('single-flight refresh', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: 'expired', refreshToken: 'refresh-1', user: USER });
  });

  it('refreshes once for a burst of concurrent 401s, then retries each request', async () => {
    // Every original request 401s with token_expired; the refresh succeeds; the
    // retries succeed. `mockImplementation` (not a queue of `mockResolvedValueOnce`)
    // because the interleaving of three concurrent requests is not deterministic.
    let refreshCalls = 0;
    const retried = new Set<string>();

    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(
          jsonResponse(200, successBody({ accessToken: 'access-2', refreshToken: 'refresh-2' })),
        );
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer access-2') {
        retried.add(url);
        return Promise.resolve(jsonResponse(200, successBody({ url })));
      }
      return Promise.resolve(jsonResponse(401, errorBody(TOKEN_EXPIRED_CODE)));
    });

    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);

    // THE POINT OF THE WHOLE MECHANISM: three expiries, one rotation. Without
    // the shared promise, three refreshes would race and two would be rejected
    // by the API's token rotation, logging the user out mid-session.
    expect(refreshCalls).toBe(1);
    expect(retried.size).toBe(3);
    expect(results).toHaveLength(3);
    expect(useAuthStore.getState().accessToken).toBe('access-2');
  });

  it('clears the session and rethrows when the refresh itself fails', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        return Promise.resolve(jsonResponse(401, errorBody('invalid_refresh_token')));
      }
      return Promise.resolve(jsonResponse(401, errorBody(TOKEN_EXPIRED_CODE)));
    });

    await expect(api.get('/tasks')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('does NOT refresh on a 401 that is not token_expired', async () => {
    // A revoked tokenVersion or a disabled account is terminal — spending the
    // refresh token on it only burns the one credential that could still work.
    fetchMock.mockResolvedValueOnce(jsonResponse(401, errorBody('token_revoked')));

    await expect(api.get('/tasks')).rejects.toMatchObject({ code: 'token_revoked' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBe('expired');
  });

  it('retries at most once — a second 401 after a successful refresh is final', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        return Promise.resolve(
          jsonResponse(200, successBody({ accessToken: 'access-2', refreshToken: 'refresh-2' })),
        );
      }
      return Promise.resolve(jsonResponse(401, errorBody(TOKEN_EXPIRED_CODE)));
    });

    await expect(api.get('/tasks')).rejects.toMatchObject({ code: TOKEN_EXPIRED_CODE });
    // original + refresh + one retry, and then it stops.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('tears the session down EXACTLY ONCE for a burst that all fail together', async () => {
    // The mirror image of the happy path. Five requests expire at once, the
    // single rotation fails, and the store must be cleared once — not five
    // times, which would fire five subscriber notifications and could race a
    // sign-in the user has already started on the login screen.
    let clears = 0;
    let refreshCalls = 0;
    const { clearSession } = useAuthStore.getState();
    useAuthStore.setState({
      clearSession: () => {
        clears += 1;
        clearSession();
      },
    } as Partial<ReturnType<typeof useAuthStore.getState>>);

    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(jsonResponse(401, errorBody('invalid_refresh_token')));
      }
      return Promise.resolve(jsonResponse(401, errorBody(TOKEN_EXPIRED_CODE)));
    });

    const settled = await Promise.allSettled([
      api.get('/a'),
      api.get('/b'),
      api.get('/c'),
      api.get('/d'),
      api.get('/e'),
    ]);

    expect(settled.every((result) => result.status === 'rejected')).toBe(true);
    expect(refreshCalls).toBe(1);
    expect(clears).toBe(1);
    expect(useAuthStore.getState().accessToken).toBeNull();

    useAuthStore.setState({ clearSession } as Partial<ReturnType<typeof useAuthStore.getState>>);
  });

  it('does not POST /auth/refresh at all when there is no refresh token to spend', async () => {
    useAuthStore.setState({ accessToken: 'expired', refreshToken: null });
    fetchMock.mockResolvedValueOnce(jsonResponse(401, errorBody(TOKEN_EXPIRED_CODE)));

    await expect(api.get('/tasks')).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('clears the session when the refresh answers 200 with an unusable payload', async () => {
    // The refresh path hand-checks its two fields rather than zod-parsing them
    // (it runs during error recovery). A 200 whose `data` is not a token pair
    // must still be treated as a failed refresh, not written into the store.
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        return Promise.resolve(jsonResponse(200, successBody({ accessToken: 'only-half' })));
      }
      return Promise.resolve(jsonResponse(401, errorBody(TOKEN_EXPIRED_CODE)));
    });

    await expect(api.get('/tasks')).rejects.toMatchObject({ status: 401 });

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
  });

  it('clears the session when the refresh envelope is not JSON at all', async () => {
    // A proxy error page in front of the API: `success` is undefined, so the
    // envelope gate must reject it rather than reading `data` off nothing.
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        return Promise.resolve(new Response('<html>502</html>', { status: 200 }));
      }
      return Promise.resolve(jsonResponse(401, errorBody(TOKEN_EXPIRED_CODE)));
    });

    await expect(api.get('/tasks')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('clears the session when the network drops MID-refresh', async () => {
    // The tokens we hold are known-stale by this point, so a signed-out user
    // who can retry by signing in is the safe verdict — not a session left in
    // a state where every request 401s forever.
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/auth/refresh')) return Promise.reject(new TypeError('offline'));
      return Promise.resolve(jsonResponse(401, errorBody(TOKEN_EXPIRED_CODE)));
    });

    await expect(api.get('/tasks')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  /**
   * A refresh OUTLIVING the session that started it.
   *
   * The window is small and completely ordinary: a board page 401s, the
   * single-flight refresh goes out, and the user hits "Sign out" before it
   * comes back. Without the session-generation guard the rotated pair is
   * written into a store that was just cleared — and because that store is
   * persisted, the next boot reads a valid session and signs the user back in.
   * A logout that un-does itself is the whole reason `sessionGeneration` exists.
   */
  describe('a refresh that resolves after the session moved on', () => {
    /** A refresh whose response the test releases by hand. */
    function gatedRefresh(refreshResult: () => Response) {
      let release = (): void => {
        /* replaced below */
      };
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      fetchMock.mockImplementation(async (url: string) => {
        if (url.endsWith('/api/auth/refresh')) {
          await gate;
          return refreshResult();
        }
        return jsonResponse(401, errorBody(TOKEN_EXPIRED_CODE));
      });

      // The original request 401s, then the refresh goes out and blocks.
      const pending = api.get('/tasks').catch((error: unknown) => error);
      return { pending, release };
    }

    it('does NOT write the rotated pair back into a store that was cleared meanwhile', async () => {
      const { pending, release } = gatedRefresh(() =>
        jsonResponse(200, successBody({ accessToken: 'access-2', refreshToken: 'refresh-2' })),
      );

      // Wait until the refresh is genuinely in flight (original + refresh).
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });

      useAuthStore.getState().clearSession();
      release();
      await pending;

      expect(useAuthStore.getState().accessToken).toBeNull();
      expect(useAuthStore.getState().refreshToken).toBeNull();
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('does not retry the original request either — there is no session to retry under', async () => {
      const { pending, release } = gatedRefresh(() =>
        jsonResponse(200, successBody({ accessToken: 'access-2', refreshToken: 'refresh-2' })),
      );

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
      useAuthStore.getState().clearSession();
      release();
      await pending;

      // Original + refresh, and nothing after it.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not clear a NEWER session when the late refresh FAILS', async () => {
      // The subtler half. By the time a stale refresh fails, the tokens it
      // would drop can belong to somebody who has since signed in.
      const { pending, release } = gatedRefresh(() =>
        jsonResponse(401, errorBody('invalid_refresh_token')),
      );

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });

      useAuthStore.getState().setSession({
        user: USER,
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
      });
      release();
      await pending;

      expect(useAuthStore.getState().accessToken).toBe('access-new');
      expect(useAuthStore.getState().refreshToken).toBe('refresh-new');
    });

    it('still writes the pair when nothing displaced the session', async () => {
      // The control: the guard must not break the ordinary happy path.
      const { pending, release } = gatedRefresh(() =>
        jsonResponse(200, successBody({ accessToken: 'access-2', refreshToken: 'refresh-2' })),
      );

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
      release();
      await pending;

      expect(useAuthStore.getState().accessToken).toBe('access-2');
      expect(useAuthStore.getState().refreshToken).toBe('refresh-2');
    });
  });

  it('starts a NEW flight for the next expiry rather than replaying the last one', async () => {
    // `refreshInFlight` is cleared in a `finally`, so a later expiry gets its
    // own rotation. Without that, one successful refresh would satisfy every
    // future 401 for the lifetime of the tab.
    let refreshCalls = 0;
    let dataCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(
          jsonResponse(
            200,
            successBody({
              accessToken: `access-${String(refreshCalls)}`,
              refreshToken: `refresh-${String(refreshCalls)}`,
            }),
          ),
        );
      }
      // Odd calls are the two ORIGINALS (each expired); even calls are the
      // retries that follow their own rotation.
      dataCalls += 1;
      return Promise.resolve(
        dataCalls % 2 === 1
          ? jsonResponse(401, errorBody(TOKEN_EXPIRED_CODE))
          : jsonResponse(200, successBody({ ok: true })),
      );
    });

    await api.get('/first');
    await api.get('/second');

    expect(refreshCalls).toBe(2);
  });
});

describe('the verbs and the socket-id header', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: 'access-1', refreshToken: 'refresh-1', user: USER });
  });

  afterEach(() => {
    setSocketIdProvider(null);
  });

  it.each([
    ['post', (body: unknown) => api.post('/x', body), 'POST'],
    ['patch', (body: unknown) => api.patch('/x', body), 'PATCH'],
    ['put', (body: unknown) => api.put('/x', body), 'PUT'],
  ])('%s sends a JSON body and unwraps the envelope', async (_name, call, method) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, successBody({ ok: true })));

    await expect(call({ title: 'Ship it' })).resolves.toEqual({ ok: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe(method);
    expect(init.body).toBe(JSON.stringify({ title: 'Ship it' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('del sends no body and no Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, successBody(null)));

    await api.del('/x');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(init.headers as Record<string, string>).not.toHaveProperty('Content-Type');
  });

  it('stamps X-Socket-Id on a mutation, so the server can suppress the echo', async () => {
    setSocketIdProvider(() => 'socket-abc');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, successBody({ ok: true })));

    await api.post('/tasks', { title: 'x' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Socket-Id']).toBe('socket-abc');
  });

  it('does NOT stamp it on a GET — a read produces no broadcast to suppress', async () => {
    setSocketIdProvider(() => 'socket-abc');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, successBody([])));

    await api.get('/tasks');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty('X-Socket-Id');
  });

  it('omits the header while the socket is disconnected', async () => {
    // The provider is a FUNCTION because the id changes on every reconnect;
    // between connections it answers null and the header is simply absent.
    setSocketIdProvider(() => null);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, successBody({ ok: true })));

    await api.post('/tasks', { title: 'x' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty('X-Socket-Id');
  });

  it('lets a caller override any header, including the bearer token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, successBody({ ok: true })));

    await api.get('/x', { headers: { Authorization: 'Bearer invite-token' } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer invite-token');
  });

  it('serialises query params onto the url', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, successBody([])));

    await api.get('/tasks', { query: { statusId: ['a', 'b'], page: 2, q: '' } });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/api/tasks?');
    expect(url).toContain('statusId=a%2Cb');
    expect(url).toContain('page=2');
    expect(url).not.toContain('q=');
  });

  it('re-throws an AbortError as itself, so TanStack Query reads it as a cancel', async () => {
    // A cancelled request wrapped in a network `ApiError` would be retried and
    // surfaced as a failure; the DOMException must survive intact.
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));

    await expect(api.get('/tasks')).rejects.toBeInstanceOf(DOMException);
  });
});
