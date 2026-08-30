// @vitest-environment jsdom
import type { ReactNode } from 'react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';

// Registers the English catalog on the default i18next instance. Must be
// imported before anything calls `useTranslation`.
import '@/i18n';
import { useAuthStore } from '@/stores/useAuthStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import TelemetryStatRow from '@/components/admin/TelemetryStatRow';
import { TopEndpointsTable } from '@/components/admin/TopEndpointsTable';
import AdminTelemetryEventsPage from '@/pages/admin/AdminTelemetryEventsPage';

/**
 * The ops surfaces after the Round 2 upgrade.
 *
 * Four questions, and nothing else:
 *
 *  1. **Does the KPI row still show the five numbers a reader came for**, and
 *     does each one now LEAD somewhere? The tiles were a dead end before this
 *     wave; a tile that renders but does not link is the regression.
 *  2. **Do the filters reach the wire?** The event feed's whole value is
 *     narrowing, so a facet that changes local state but not the request is a
 *     silent failure. The assertion is on the URL `fetch` was called with, not
 *     on a spy over the hook — a hook that builds the wrong query string would
 *     pass the second and fail users.
 *  3. **Does the grid state reach the URL?** A filtered feed that cannot be
 *     pasted into an incident channel is a feed people rebuild from memory.
 *  4. **Does the error-rate column actually distinguish a bad endpoint?** The
 *     colour IS the information in that column.
 *
 * jsdom, per-file (`vitest.config.ts` keeps the package's default environment
 * DOM-free). Everything renders inside a router now: the stat row's tiles are
 * links, and the events page keeps its state in the query string.
 */

const USER = '44444444-4444-4444-8444-444444444444';
const OTHER_USER = '55555555-5555-4555-8555-555555555555';
const PROJECT = '11111111-1111-4111-8111-111111111111';

const OVERVIEW = {
  dau: 12,
  eventsToday: 1340,
  tasksCreated7d: 58,
  tasksCompleted7d: 41,
  activeProjects: 6,
};

const EVENT_ROWS = [
  {
    id: '1042',
    type: 'page_view' as const,
    userId: USER,
    orgId: null,
    projectId: PROJECT,
    payload: { path: '/o/:orgSlug/p/:projectKey/board' },
    createdAt: '2026-08-27T11:59:00.000Z',
    userName: 'Ada Lovelace',
    projectName: 'FlowBoard Web',
  },
  {
    id: '1041',
    type: 'task_completed' as const,
    userId: OTHER_USER,
    orgId: null,
    projectId: PROJECT,
    payload: null,
    createdAt: '2026-08-27T11:58:00.000Z',
    userName: 'Grace Hopper',
    projectName: 'FlowBoard Web',
  },
];

function ok(data: unknown, meta?: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, meta }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Every URL `fetch` has been called with so far, oldest first. */
function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

/**
 * A HISTORY-BACKED router, not `MemoryRouter`.
 *
 * `useGridUrlState` diffs against `window.location.search` on purpose — React
 * Router runs navigations inside `startTransition`, so the RENDERED params are
 * occasionally one navigation behind, which is precisely the wrong thing to
 * compare a URL against (that hook's header spells it out). `MemoryRouter`
 * keeps its entries in memory and never touches `window.location`, so under it
 * the hook reads a permanently-empty query string, decides the grid has drifted
 * and re-hydrates the defaults over every filter the user just set — a
 * harness artefact that looks exactly like a state bug.
 *
 * `BrowserRouter` over jsdom's real `history` is what the app actually ships,
 * so the tests exercise the same code path production does.
 */
function renderWithProviders(ui: ReactNode, route = '/admin/telemetry/events') {
  window.history.replaceState(null, '', route);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{ui}</TooltipProvider>
      </QueryClientProvider>
    </BrowserRouter>,
  );
}

beforeAll(() => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
  // A FRESH `Response` per call: a body can only be read once, so a single
  // shared instance makes every request after the first fail as "body already
  // read" — and every assertion about a second fetch silently measures the
  // wrong branch.
  fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(ok(EVENT_ROWS, { page: 1, pageSize: 20, total: 2, totalPages: 1 })),
    );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The URL is real now, so one case's filters would hydrate the next one.
  window.history.replaceState(null, '', '/');
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. The KPI row
// ═══════════════════════════════════════════════════════════════════════════

describe('TelemetryStatRow', () => {
  it('renders all five figures, formatted, each with its definition', () => {
    renderWithProviders(<TelemetryStatRow overview={OVERVIEW} isPending={false} error={null} />);

    expect(screen.getByText('Active users')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    // Grouped, and in Latin digits in every language (`lib/lang-policy`).
    expect(screen.getByText('1,340')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();

    // The hint is the point: "DAU: 12" is a number two people quote to mean two
    // different things; the window makes it a measurement.
    expect(screen.getByText('Distinct users with any event today (UTC).')).toBeInTheDocument();
  });

  it('makes every tile a LINK into the metric that explains it', () => {
    renderWithProviders(<TelemetryStatRow overview={OVERVIEW} isPending={false} error={null} />);

    // Per-METRIC destinations, not five links to one dashboard: a tile that
    // drilled into a domain which does not measure it would be a link that lies.
    expect(screen.getByTestId('analytics-kpi-dau').querySelector('a')).toHaveAttribute(
      'href',
      '/admin/analytics/engagement/dau',
    );
    expect(screen.getByTestId('analytics-kpi-eventsToday').querySelector('a')).toHaveAttribute(
      'href',
      '/admin/analytics/engagement/events-by-type',
    );
    expect(screen.getByTestId('analytics-kpi-tasksCreated7d').querySelector('a')).toHaveAttribute(
      'href',
      '/admin/analytics/work/tasks-created',
    );
    expect(screen.getByTestId('analytics-kpi-activeProjects').querySelector('a')).toHaveAttribute(
      'href',
      '/admin/analytics/work/by-project',
    );
  });

  it('draws tile-shaped skeletons while pending, so the charts do not shift', () => {
    renderWithProviders(<TelemetryStatRow overview={undefined} isPending error={null} />);
    expect(screen.getAllByTestId('analytics-kpi-skeleton')).toHaveLength(5);
  });

  it('replaces the whole row with ONE error, not five, and offers a retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    // The five numbers come from one request; five identical error boxes would
    // be five times the noise for one piece of information.
    renderWithProviders(
      <TelemetryStatRow
        overview={undefined}
        isPending={false}
        error={new Error('nope')}
        onRetry={onRetry}
      />,
    );

    expect(screen.queryByTestId('telemetry-stat-row')).not.toBeInTheDocument();
    // `ErrorState`'s own heading — the shared one every surface uses, so the
    // failure looks the same here as on a board or a report.
    expect(screen.getByText('That did not load')).toBeInTheDocument();

    await user.click(screen.getByRole('button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The event feed: filters → query parameters
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminTelemetryEventsPage — filters reach the wire', () => {
  it('opens on ALL TIME — the feed is the one endpoint with no implicit window', async () => {
    renderWithProviders(<AdminTelemetryEventsPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const url = requestedUrls()[0] ?? '';
    expect(url).toContain('/api/admin/telemetry/events');
    // A hidden 24-hour default is how "I cannot find last month's login"
    // becomes a support ticket.
    expect(url).not.toContain('from=');
    expect(url).not.toContain('type=');
  });

  it('sends the window when a range chip is pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminTelemetryEventsPage />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: 'Last 7 days' }));

    await waitFor(() => {
      const latest = requestedUrls().at(-1) ?? '';
      expect(latest).toContain('from=');
      expect(latest).toContain('to=');
    });
  });

  it('sends MULTIPLE event types — the endpoint always accepted a list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminTelemetryEventsPage />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    await user.click(screen.getByTestId('table-facet-type'));
    await user.click(await screen.findByTestId('table-facet-type-auth_login'));
    await user.click(await screen.findByTestId('table-facet-type-page_view'));

    await waitFor(() => {
      const latest = decodeURIComponent(requestedUrls().at(-1) ?? '');
      // The old control offered one type at a time while the API had always
      // taken a comma-separated list.
      expect(latest).toContain('type=auth_login,page_view');
    });
  });

  it('narrows to one actor when their name is clicked, and says whose', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminTelemetryEventsPage />);

    await user.click(await screen.findByRole('button', { name: 'Ada Lovelace' }));

    await waitFor(() => {
      expect(requestedUrls().at(-1)).toContain(`userId=${USER}`);
    });
    // The chip is the only way back out, so it has to name the person rather
    // than show a uuid.
    expect(screen.getByText('Ada Lovelace', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear the user filter' })).toBeInTheDocument();
  });

  it('clears the actor filter from the chip', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminTelemetryEventsPage />);

    await user.click(await screen.findByRole('button', { name: 'Ada Lovelace' }));
    await waitFor(() => {
      expect(requestedUrls().at(-1)).toContain('userId=');
    });

    await user.click(screen.getByTestId('telemetry-events-clear-user'));

    // The assertion is on the CHIP and the URL, not on a fresh request: going
    // back to the unfiltered query returns to a key TanStack already holds and
    // has no reason to re-fetch, which is the cache working rather than the
    // filter failing.
    await waitFor(() => {
      expect(screen.queryByTestId('telemetry-events-clear-user')).not.toBeInTheDocument();
    });
    expect(window.location.search).not.toContain('userId=');
  });

  it('sends `field:direction` when a sortable header is pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminTelemetryEventsPage />);
    const table = await screen.findByRole('table');
    await screen.findByRole('button', { name: 'Ada Lovelace' });

    // The grid is in manual mode (it has `meta`), so the SERVER sorts — the
    // header only reports intent. Scoped to the table: the facet trigger next
    // to it reads "Event type" and would match an unscoped name query.
    // (In jsdom the header's `sr-only` hint concatenates without a space — see
    // the note in `DataTable`.)
    await user.click(within(table).getByRole('button', { name: /^EventSort/u }));

    await waitFor(() => {
      expect(decodeURIComponent(requestedUrls().at(-1) ?? '')).toContain('sort=type:asc');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The event feed: grid state ⇄ URL
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminTelemetryEventsPage — the URL is the state', () => {
  it('writes a facet into the query string so a filtered feed is linkable', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminTelemetryEventsPage />);
    await screen.findByRole('table');

    await user.click(screen.getByTestId('table-facet-type'));
    await user.click(await screen.findByTestId('table-facet-type-auth_login'));

    await waitFor(() => {
      expect(window.location.search).toContain('type=auth_login');
    });
  });

  it('omits every param that is at its DEFAULT — the bare URL is the default state', async () => {
    renderWithProviders(<AdminTelemetryEventsPage />);
    await screen.findByRole('table');

    await waitFor(() => {
      // No `page=1`, no `pageSize=20`, no `range=all`: `/admin/telemetry/events`
      // and the fully-spelled-out URL mean the same thing, and only the short
      // one is ever produced.
      expect(window.location.search).not.toContain('page=');
      expect(window.location.search).not.toContain('range=');
    });
  });

  it('HYDRATES from a deep link rather than resetting it', async () => {
    renderWithProviders(
      <AdminTelemetryEventsPage />,
      '/admin/telemetry/events?type=auth_login&range=7d',
    );

    await waitFor(() => {
      const first = decodeURIComponent(requestedUrls()[0] ?? '');
      // The very FIRST request already carries the pasted filters — a page that
      // fetched unfiltered and then corrected itself would double-query and
      // flash the wrong rows.
      expect(first).toContain('type=auth_login');
      expect(first).toContain('from=');
    });
  });

  it('drops an invalid value instead of 422-ing the page', async () => {
    renderWithProviders(
      <AdminTelemetryEventsPage />,
      '/admin/telemetry/events?type=not_a_type&range=nonsense',
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const first = decodeURIComponent(requestedUrls()[0] ?? '');
    expect(first).not.toContain('type=');
    expect(first).not.toContain('from=');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The event feed: rows
// ═══════════════════════════════════════════════════════════════════════════

describe('AdminTelemetryEventsPage — rows', () => {
  it('hides the payload behind an expander and reveals it as JSON', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminTelemetryEventsPage />);
    // The table element exists while the grid is still drawing skeleton rows,
    // so wait for real content rather than for the `<table>`.
    await screen.findByRole('button', { name: 'Ada Lovelace' });

    expect(screen.queryByTestId('telemetry-event-payload')).not.toBeInTheDocument();

    // Only the row that HAS a payload gets a toggle — the other would be a
    // button that opens an empty box.
    const toggles = screen.getAllByRole('button', { name: 'Show payload' });
    expect(toggles).toHaveLength(1);

    await user.click(toggles[0] as HTMLElement);

    const payload = await screen.findByTestId('telemetry-event-payload');
    expect(within(payload).getByText(/o\/:orgSlug\/p\/:projectKey\/board/u)).toBeInTheDocument();
  });

  it('labels an actor-less event as system rather than blank', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        ok([{ ...EVENT_ROWS[0], id: '9', userId: null, userName: null }], {
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        }),
      ),
    );

    renderWithProviders(<AdminTelemetryEventsPage />);
    expect(await screen.findByText('System')).toBeInTheDocument();
  });

  it('offers a CSV export once there are rows to write', async () => {
    renderWithProviders(<AdminTelemetryEventsPage />);
    await screen.findByRole('table');
    expect(await screen.findByTestId('telemetry-events-export')).toBeEnabled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Error-rate colouring
// ═══════════════════════════════════════════════════════════════════════════

describe('TopEndpointsTable', () => {
  it('paints a 5xx share above 1% as danger and a clean endpoint as neutral', () => {
    renderWithProviders(
      <TopEndpointsTable
        endpoints={[
          {
            method: 'GET',
            path: '/api/tasks/:taskId',
            count: 4,
            avgDurationMs: 250,
            errorRate: 0.25,
          },
          { method: 'POST', path: '/api/tasks', count: 2, avgDurationMs: 20, errorRate: 0 },
        ]}
      />,
    );

    // The share is formatted as a percentage HERE; the API sends `[0,1]`.
    const bad = screen.getByText('25%');
    const clean = screen.getByText('0%');

    expect(bad).toHaveClass('bg-danger/12');
    // Zero is the expected state: painting it green would make the healthy
    // majority the loudest thing in the table.
    expect(clean).not.toHaveClass('bg-danger/12');
    expect(clean).toHaveClass('bg-secondary');

    // The path is the stored route PATTERN, never an interpolated URL.
    expect(screen.getByText('/api/tasks/:taskId')).toBeInTheDocument();
  });
});
