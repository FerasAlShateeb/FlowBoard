import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/useAuthStore';
import {
  PAGE_VIEW_DEBOUNCE_MS,
  __resetTelemetryClientForTests,
  initTelemetryClient,
  isTelemetryEnabled,
  normalizePath,
  reportPageView,
  trackExportCsv,
  trackThemeChanged,
  type RouterLike,
} from '@/lib/telemetry-client';

/**
 * The browser's telemetry emitter.
 *
 * TWO UNITS, TESTED DIFFERENTLY.
 *
 *  1. `normalizePath` is a PURE function and the most load-bearing thing in the
 *     module — it is what keeps org slugs and task keys out of an append-only
 *     analytics stream, and what keeps `page_view` from becoming one bucket per
 *     task. It is tested as arithmetic: inputs in, templates out.
 *  2. Everything else is tested through a MOCKED `fetch`, not a stubbed
 *     `api.post`. Stubbing the transport seam would skip the envelope handling
 *     and the 204 path, and would let a request that never actually forms pass.
 *
 * `MODE` IS STUBBED TO `development` IN THE SUITES THAT SEND. The module is
 * deliberately inert under vitest (`isTelemetryEnabled`), which is exactly the
 * behaviour the first describe asserts — and exactly the behaviour the rest
 * have to lift to observe anything at all.
 */

/** A 204, which is what the ingest route actually answers with. */
function accepted(): Response {
  return new Response(null, { status: 204 });
}

let fetchMock: ReturnType<typeof vi.fn>;

/** The JSON body of the single mocked call. */
function sentBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  __resetTelemetryClientForTests();
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
  fetchMock = vi.fn().mockResolvedValue(accepted());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  __resetTelemetryClientForTests();
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizePath — the privacy and cardinality guarantee
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizePath', () => {
  it('replaces every identifier in the real route table with its parameter name', () => {
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('/o/acme')).toBe('/o/:orgSlug');
    expect(normalizePath('/o/acme/members')).toBe('/o/:orgSlug/members');
    expect(normalizePath('/o/acme/p/FB/board')).toBe('/o/:orgSlug/p/:projectKey/board');
    expect(normalizePath('/o/acme/p/FB/settings/labels')).toBe(
      '/o/:orgSlug/p/:projectKey/settings/labels',
    );
    expect(normalizePath('/o/acme/p/FB/board/t/FB-142')).toBe(
      '/o/:orgSlug/p/:projectKey/board/t/:taskKey',
    );
    expect(normalizePath('/invite/9f3ab2c1')).toBe('/invite/:token');
    expect(normalizePath('/admin/telemetry/events')).toBe('/admin/telemetry/events');
  });

  it('sends an UNKNOWN segment to `:id` rather than leaking it', () => {
    // The safety net: a route added after this file, a deep link from an email,
    // a 404. None of them may put an identifier into the payload just because
    // nobody remembered to update the static-segment list.
    expect(normalizePath('/something/9f3a-b2c1')).toBe('/:id/:id');
    expect(normalizePath('/o/acme/p/FB/gantt')).toBe('/o/:orgSlug/p/:projectKey/:id');
  });

  it('drops a query string, a hash and a trailing slash', () => {
    expect(normalizePath('/admin/telemetry/events?type=page_view&page=2')).toBe(
      '/admin/telemetry/events',
    );
    expect(normalizePath('/o/acme/p/FB/board#top')).toBe('/o/:orgSlug/p/:projectKey/board');
    expect(normalizePath('/notifications/')).toBe('/notifications');
    expect(normalizePath('')).toBe('/');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The two gates
// ═══════════════════════════════════════════════════════════════════════════

describe('isTelemetryEnabled', () => {
  it('is FALSE under vitest, whatever the session looks like', () => {
    // Not a detail: a suite that renders a page must not open a connection, and
    // a suite asserting on `fetch` must not find a stray telemetry POST in its
    // mock's call list.
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('is false for an anonymous visitor even outside test mode', () => {
    vi.stubEnv('MODE', 'development');
    useAuthStore.setState({ accessToken: null, refreshToken: null, user: null });

    expect(isTelemetryEnabled()).toBe(false);

    trackThemeChanged('midnight');
    // An anonymous page view is not recordable, and firing it would earn a 401
    // per navigation on the sign-in screen.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The emitters
// ═══════════════════════════════════════════════════════════════════════════

describe('the client emitters', () => {
  beforeEach(() => {
    vi.stubEnv('MODE', 'development');
  });

  it('POSTs `theme_changed` to the ingest route with no actor in the body', async () => {
    trackThemeChanged('midnight');
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/telemetry/events');
    // The actor comes from the Bearer token; there is deliberately no field for
    // it, so a client can never attribute an event to somebody else.
    expect(sentBody()).toEqual({ type: 'theme_changed', payload: { theme: 'midnight' } });
    expect(sentBody()).not.toHaveProperty('userId');
  });

  it('stamps `export_csv` with its source and row count', async () => {
    trackExportCsv('table', 312);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(sentBody()).toEqual({
      type: 'export_csv',
      payload: { source: 'table', rows: 312 },
    });
  });

  it('swallows a rejected request instead of surfacing it', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    // No `await`, no throw, no unhandled rejection: the whole contract.
    expect(() => {
      trackThemeChanged('midnight');
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Page views: the debounce, the dedupe, and the router subscription
// ═══════════════════════════════════════════════════════════════════════════

describe('reportPageView', () => {
  beforeEach(() => {
    vi.stubEnv('MODE', 'development');
    vi.useFakeTimers();
  });

  it('coalesces a redirect chain into ONE event for the destination', async () => {
    // `/` → `/o/acme` → `/o/acme/p/FB/board` is one navigation to a user and
    // three to the router.
    reportPageView('/');
    reportPageView('/o/acme');
    reportPageView('/o/acme/p/FB/board');

    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEBOUNCE_MS + 10);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({
      type: 'page_view',
      payload: { path: '/o/:orgSlug/p/:projectKey/board' },
    });
  });

  it('does not re-report the path it is already on', async () => {
    reportPageView('/notifications');
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEBOUNCE_MS + 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A second notification for the same location — a StrictMode double-invoke,
    // a re-render, a router state change that did not move.
    reportPageView('/notifications');
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEBOUNCE_MS + 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('initTelemetryClient', () => {
  beforeEach(() => {
    vi.stubEnv('MODE', 'development');
    vi.useFakeTimers();
  });

  /** The six lines of router this module actually consumes. */
  function fakeRouter(pathname: string): RouterLike & { go: (next: string) => void } {
    const listeners = new Set<(state: { location: { pathname: string } }) => void>();
    const state = { location: { pathname } };
    return {
      state,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      go: (next) => {
        state.location = { pathname: next };
        for (const listener of listeners) listener(state);
      },
    };
  }

  it('reports the landing page and every navigation after it', async () => {
    const router = fakeRouter('/o/acme/p/FB/board');
    const unsubscribe = initTelemetryClient(router);

    // The first location never arrives through `subscribe` — the router is
    // already there — so without the priming call the landing page is lost.
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEBOUNCE_MS + 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    router.go('/o/acme/p/FB/backlog');
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEBOUNCE_MS + 10);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const second = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body),
    ) as { payload: { path: string } };
    expect(second.payload.path).toBe('/o/:orgSlug/p/:projectKey/backlog');

    unsubscribe();
    router.go('/notifications');
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_DEBOUNCE_MS + 10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
