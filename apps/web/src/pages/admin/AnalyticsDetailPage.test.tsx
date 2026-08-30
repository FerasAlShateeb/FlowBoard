// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import '@/i18n';
import { __clearMetricDomainCache } from '@/components/admin/analytics/metric-registry';
import { useAuthStore } from '@/stores/useAuthStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import AnalyticsDetailPage from '@/pages/admin/AnalyticsDetailPage';

/**
 * The generic drill-down, driven through the router the way a bookmark drives
 * it.
 *
 * The two questions worth a rendered test:
 *
 *  1. **Does a stale or hand-typed URL land somewhere useful?** These paths get
 *     bookmarked and pasted into incident channels, and a blank screen tells
 *     the reader nothing about whether the link is wrong or the console is
 *     broken.
 *  2. **Does the registry actually drive the page?** Title, back link, columns
 *     and facets all come out of `metric-registry`, and the only way to know
 *     the wiring holds is to render one and read it.
 */

const TRAFFIC = {
  requestsSeries: [
    { t: '2026-08-01T00:00:00.000Z', value: 10 },
    { t: '2026-08-02T00:00:00.000Z', value: 20 },
  ],
  errorSeries: [
    { t: '2026-08-01T00:00:00.000Z', value: 1 },
    { t: '2026-08-02T00:00:00.000Z', value: 0 },
  ],
  errorRateSeries: [
    { t: '2026-08-01T00:00:00.000Z', value: 0.1 },
    { t: '2026-08-02T00:00:00.000Z', value: 0 },
  ],
  latency: { p50: 12, p90: 40, p95: 88, p99: 210, max: 900 },
  topEndpoints: [
    { method: 'GET', path: '/api/tasks', count: 40, avgDurationMs: 12, errorRate: 0 },
    { method: 'POST', path: '/api/tasks', count: 9, avgDurationMs: 30, errorRate: 0.25 },
  ],
  statusBreakdown: { '2xx': 45, '3xx': 0, '4xx': 3, '5xx': 1 },
};

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

beforeEach(() => {
  // The registry's per-window payload cache is module scope; one case's window
  // would otherwise satisfy the next case's first render.
  __clearMetricDomainCache();
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
  // A fresh `Response` per call — a body can only be read once.
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(ok(TRAFFIC)));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <Routes>
          <Route path="/admin/analytics/:domain/:metric" element={<AnalyticsDetailPage />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Unknown pairs
// ═══════════════════════════════════════════════════════════════════════════

describe('AnalyticsDetailPage — a URL that does not resolve', () => {
  it('renders a friendly not-found for an unknown METRIC, naming both segments', () => {
    renderAt('/admin/analytics/traffic/nonsense');

    expect(screen.getByTestId('admin-analytics-detail-missing')).toBeInTheDocument();
    expect(screen.getByText('Unknown metric')).toBeInTheDocument();
    // Naming what was asked for is what tells a reader whether they mistyped.
    expect(screen.getByText(/“nonsense”/u)).toBeInTheDocument();
    expect(screen.getByText(/traffic/u)).toBeInTheDocument();
  });

  it('renders it for an unknown DOMAIN too', () => {
    renderAt('/admin/analytics/nonsense/requests');
    expect(screen.getByTestId('admin-analytics-detail-missing')).toBeInTheDocument();
  });

  it('renders it for `overview`, which deliberately has no registry', () => {
    // Letting `/admin/analytics/overview/x` resolve would promise a drill-down
    // that has no metrics to reach.
    renderAt('/admin/analytics/overview/dau');
    expect(screen.getByTestId('admin-analytics-detail-missing')).toBeInTheDocument();
  });

  it('offers a way BACK rather than a dead end', () => {
    renderAt('/admin/analytics/traffic/nonsense');

    const back = screen.getByTestId('analytics-detail-notfound-back');
    expect(back).toHaveAttribute('href', '/admin/analytics/engagement');
    expect(back).toHaveTextContent('Back to Analytics');
  });

  it('does NOT fetch anything for an unresolvable pair', () => {
    renderAt('/admin/analytics/traffic/nonsense');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is not fooled by an inherited Object property in the URL', () => {
    // `/admin/analytics/traffic/toString` must be a not-found card, not a
    // function treated as a metric definition.
    renderAt('/admin/analytics/traffic/toString');
    expect(screen.getByTestId('admin-analytics-detail-missing')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. A real metric, driven by the registry
// ═══════════════════════════════════════════════════════════════════════════

describe('AnalyticsDetailPage — a registry-driven metric', () => {
  it('reads ONE domain endpoint and projects the metric out of it', async () => {
    renderAt('/admin/analytics/traffic/requests');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const url = String(fetchMock.mock.calls[0]?.[0] ?? '');
    // There is no `/analytics/:domain/:metric` on the server, and there must not
    // be one: the detail page reuses the domain's single round trip.
    expect(url).toContain('/api/admin/analytics/traffic');
    expect(url).not.toContain('/requests');
  });

  it('titles itself from the registry and puts the way BACK in the subtitle', async () => {
    renderAt('/admin/analytics/traffic/requests');

    expect(await screen.findByRole('heading', { level: 1, name: 'Requests' })).toBeInTheDocument();

    const back = screen.getByTestId('analytics-detail-back');
    expect(back).toHaveAttribute('href', '/admin/analytics/traffic');
    expect(back).toHaveTextContent('Traffic');
  });

  it('renders the registry’s columns as the table headers', async () => {
    renderAt('/admin/analytics/traffic/requests');

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Bucket')).toBeInTheDocument();
    expect(within(table).getByText('Requests')).toBeInTheDocument();
  });

  it('renders the bucket rows NEWEST first', async () => {
    renderAt('/admin/analytics/traffic/requests');

    const table = await screen.findByRole('table');
    await waitFor(() => {
      expect(within(table).getByText('20')).toBeInTheDocument();
    });
    const cells = within(table)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    // 20 (Aug 2) before 10 (Aug 1).
    expect(cells.indexOf('20')).toBeLessThan(cells.indexOf('10'));
  });

  it('draws the chart section for a metric that HAS a series', async () => {
    renderAt('/admin/analytics/traffic/requests');
    expect(await screen.findByTestId('analytics-detail-chart')).toBeInTheDocument();
  });

  it('offers a CSV export for a metric that declares one', async () => {
    renderAt('/admin/analytics/traffic/requests');
    expect(await screen.findByTestId('analytics-detail-export')).toBeEnabled();
  });

  it('offers NO export for the latency ladder — five rows are not a file', async () => {
    renderAt('/admin/analytics/traffic/latency');
    await screen.findByRole('table');
    expect(screen.queryByTestId('analytics-detail-export')).not.toBeInTheDocument();
  });

  it('renders the percentile ladder in READING order, unsortable', async () => {
    renderAt('/admin/analytics/traffic/latency');

    const table = await screen.findByRole('table');
    const cells = within(table)
      .getAllByRole('cell')
      .map((cell) => cell.textContent ?? '');
    expect(cells.filter((text) => /^p\d+$|^max$/u.test(text))).toEqual([
      'p50',
      'p90',
      'p95',
      'p99',
      'max',
    ]);
    // No accessor ⇒ no sort button in any header.
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Facets
// ═══════════════════════════════════════════════════════════════════════════

describe('AnalyticsDetailPage — facets', () => {
  it('renders one facet per registry filter, using the shared grid contract', async () => {
    renderAt('/admin/analytics/traffic/top-endpoints');

    // `table-facet-<id>` is `DataTable`'s own testid, so an e2e spec that knows
    // one grid knows this one.
    expect(await screen.findByTestId('table-facet-method')).toBeInTheDocument();
  });

  it('filters the rows CLIENT-side without a second request', async () => {
    const user = userEvent.setup();
    renderAt('/admin/analytics/traffic/top-endpoints');

    const table = await screen.findByRole('table');
    // Both endpoints share a path and differ only by method — which is exactly
    // the pair a method facet exists to separate.
    await waitFor(() => {
      expect(within(table).getAllByText('/api/tasks')).toHaveLength(2);
    });
    const before = fetchMock.mock.calls.length;

    await user.click(screen.getByTestId('table-facet-method'));
    await user.click(await screen.findByTestId('table-facet-method-POST'));

    // Scoped to the TABLE: the facet popover is still open and lists every
    // method as a checkbox label, so an unscoped query would find "GET" there.
    await waitFor(() => {
      expect(within(table).getAllByText('/api/tasks')).toHaveLength(1);
    });
    expect(within(table).getByText('POST')).toBeInTheDocument();
    expect(within(table).queryByText('GET')).not.toBeInTheDocument();
    // The endpoints carry no facets — filtering is a predicate over rows we
    // already hold, so the payload is re-projected, never re-requested.
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('offers only the methods that actually appear, via the registry’s options', async () => {
    const user = userEvent.setup();
    renderAt('/admin/analytics/traffic/top-endpoints');

    await user.click(await screen.findByTestId('table-facet-method'));
    // The method list is a closed vocabulary, so every verb is offered.
    expect(await screen.findByTestId('table-facet-method-GET')).toBeInTheDocument();
    expect(screen.getByTestId('table-facet-method-DELETE')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Failure
// ═══════════════════════════════════════════════════════════════════════════

describe('AnalyticsDetailPage — failure', () => {
  it('renders one retryable error rather than an empty table', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('down')));
    renderAt('/admin/analytics/traffic/requests');

    expect(await screen.findByText('This breakdown could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Out-of-order responses
// ═══════════════════════════════════════════════════════════════════════════

/**
 * THE LAST REQUEST WINS, WHATEVER ORDER THE ANSWERS ARRIVE IN.
 *
 * Every control on this page re-fires the loader, and the registry's per-domain
 * cache is keyed on the WINDOW — so widening the range twice quickly puts two
 * real requests in flight against a `generate_series` aggregate whose latency
 * varies with the window it was asked for. Without the monotonic token in
 * `load()` the slowest answer paints last and the table shows one window's rows
 * under another window's pill.
 *
 * The transport is held open by hand rather than delayed with timers: "resolve
 * the second one first" is the ONLY arrangement that reproduces the bug, and a
 * sleep long enough to make it likely is a flake waiting to happen.
 */
describe('AnalyticsDetailPage — an out-of-order response never wins', () => {
  /** One number per payload, so a row is unambiguous about which answer it is. */
  function trafficWith(value: number) {
    return {
      ...TRAFFIC,
      requestsSeries: [{ t: '2026-08-02T00:00:00.000Z', value }],
    };
  }

  it('keeps the LAST-REQUESTED window when a slower earlier one lands after it', async () => {
    const user = userEvent.setup();
    const pending: ((response: Response) => void)[] = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    );

    renderAt('/admin/analytics/traffic/requests');

    // ── the first (default 30d) load, answered normally ──────────────────────
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    pending[0]?.(ok(trafficWith(10)));
    const table = await screen.findByRole('table');
    await waitFor(() => {
      expect(within(table).getByText('10')).toBeInTheDocument();
    });

    // ── two more windows, in flight together ─────────────────────────────────
    await user.click(screen.getByTestId('range-pill-90d'));
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    await user.click(screen.getByTestId('range-pill-7d'));
    await waitFor(() => {
      expect(pending).toHaveLength(3);
    });

    // The LAST one answers FIRST…
    pending[2]?.(ok(trafficWith(777)));
    await waitFor(() => {
      expect(within(table).getByText('777')).toBeInTheDocument();
    });

    // …and the superseded 90d request answers afterwards. It must be dropped.
    pending[1]?.(ok(trafficWith(111)));

    await waitFor(() => {
      expect(within(table).getByText('777')).toBeInTheDocument();
    });
    expect(within(table).queryByText('111')).not.toBeInTheDocument();
    // Still `ready`, not stuck in the loading state the dropped answer left.
    expect(screen.queryByTestId('panel-skeleton-table')).not.toBeInTheDocument();
  });

  it('drops a superseded FAILURE instead of replacing a good table with a retry card', async () => {
    const user = userEvent.setup();
    const settle: { resolve: (r: Response) => void; reject: (e: unknown) => void }[] = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve, reject) => {
          settle.push({ resolve, reject });
        }),
    );

    renderAt('/admin/analytics/traffic/requests');
    await waitFor(() => {
      expect(settle).toHaveLength(1);
    });
    settle[0]?.resolve(ok(trafficWith(10)));
    const table = await screen.findByRole('table');
    await waitFor(() => {
      expect(within(table).getByText('10')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('range-pill-90d'));
    await waitFor(() => {
      expect(settle).toHaveLength(2);
    });
    await user.click(screen.getByTestId('range-pill-7d'));
    await waitFor(() => {
      expect(settle).toHaveLength(3);
    });

    settle[2]?.resolve(ok(trafficWith(777)));
    await waitFor(() => {
      expect(within(table).getByText('777')).toBeInTheDocument();
    });

    settle[1]?.reject(new Error('the window nobody is looking at any more'));
    await waitFor(() => {
      expect(within(table).getByText('777')).toBeInTheDocument();
    });
    expect(screen.queryByText('This breakdown could not be loaded.')).not.toBeInTheDocument();
  });
});
