// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Registers the English catalog on the default i18next instance. Must be
// imported before anything calls `useTranslation`.
import '@/i18n';
import { useAuthStore } from '@/stores/useAuthStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import TelemetryStatRow from '@/components/admin/TelemetryStatRow';
import TelemetryEventsTable from '@/components/admin/TelemetryEventsTable';
import { TopEndpointsTable } from '@/components/admin/TopEndpointsTable';
import AdminTelemetryEventsPage from '@/pages/admin/AdminTelemetryEventsPage';

/**
 * The telemetry UI, rendered.
 *
 * Three questions, and nothing else:
 *
 *  1. **Does the KPI row show the five numbers a reader came for**, formatted
 *     and labelled — the one thing on the overview page that is not a chart.
 *  2. **Do the filters reach the wire?** The event feed's whole value is
 *     narrowing, so a chip that changes local state but not the request is a
 *     silent failure. The assertion is on the URL `fetch` was called with, not
 *     on a spy over the hook — a hook that builds the wrong query string would
 *     pass the second and fail users.
 *  3. **Does the error-rate column actually distinguish a bad endpoint?**
 *     The colour IS the information in that column.
 *
 * jsdom, per-file (`vitest.config.ts` keeps the package's default environment
 * DOM-free).
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

function renderWithProviders(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
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
  fetchMock = vi
    .fn()
    .mockResolvedValue(ok(EVENT_ROWS, { page: 1, pageSize: 25, total: 2, totalPages: 1 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

describe('AdminTelemetryEventsPage', () => {
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
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The events table itself
// ═══════════════════════════════════════════════════════════════════════════

describe('TelemetryEventsTable', () => {
  it('hides the payload behind an expander and reveals it as JSON', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TelemetryEventsTable rows={EVENT_ROWS} />);

    expect(screen.queryByTestId('telemetry-event-payload')).not.toBeInTheDocument();

    // Only the row that HAS a payload gets a toggle — the other would be a
    // button that opens an empty box.
    const toggles = screen.getAllByRole('button', { name: 'Show payload' });
    expect(toggles).toHaveLength(1);

    await user.click(toggles[0] as HTMLElement);

    const payload = screen.getByTestId('telemetry-event-payload');
    expect(within(payload).getByText(/o\/:orgSlug\/p\/:projectKey\/board/u)).toBeInTheDocument();
  });

  it('labels an actor-less event as system rather than blank', () => {
    renderWithProviders(
      <TelemetryEventsTable
        rows={[{ ...EVENT_ROWS[0]!, id: '9', userId: null, userName: null }]}
      />,
    );

    expect(screen.getByText('System')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Error-rate colouring
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
