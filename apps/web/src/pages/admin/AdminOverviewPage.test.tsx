// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsOverview } from '@flowboard/shared';

import '@/i18n';
import { useAuthStore } from '@/stores/useAuthStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import AdminOverviewPage from '@/pages/admin/AdminOverviewPage';

/**
 * `/admin/overview` — the admin landing page.
 *
 * `fetch` IS MOCKED, NOT THE HOOK. What is interesting here is what the page
 * DOES with one payload: which number goes on which tile, which caption states
 * which window, and — the one that has actually been wrong in this product —
 * whether the error rate is read as a 0–1 share or as a percent level.
 *
 * THE TILES ARE LINKS, and the link targets are asserted rather than the
 * labels: a KPI grid whose numbers do not drill anywhere is a page that makes
 * the reader go find the navigation.
 */

const OVERVIEW: AnalyticsOverview = {
  users: { total: 1240, active30d: 318 },
  orgs: 7,
  projects: 23,
  tasks: { total: 4810, completed30d: 265 },
  eventsSeries: Array.from({ length: 14 }, (_, index) => ({
    t: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    value: index === 3 ? 90 : 10,
  })),
  requestsSeries: Array.from({ length: 24 }, (_, index) => ({
    t: `2026-08-20T${String(index).padStart(2, '0')}:00:00.000Z`,
    value: 5,
  })),
  // 7.32% — deliberately not a round number, so a `formatPercent`/`formatShare`
  // mix-up cannot pass by coincidence.
  errorRate24h: 0.0732,
};

/** A response FACTORY: a `Response` body can be read exactly once. */
function ok(data: unknown): () => Response {
  return () =>
    new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
}

function boom(): () => Response {
  return () =>
    new Response(JSON.stringify({ success: false, error: { code: 'server_error' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
}

let fetchMock: ReturnType<typeof vi.fn>;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AdminOverviewPage />
        </TooltipProvider>
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
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
  Element.prototype.scrollIntoView ??= function scrollIntoView(): void {};
  Element.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
    return false;
  };
  Element.prototype.setPointerCapture ??= function setPointerCapture(): void {};
  Element.prototype.releasePointerCapture ??= function releasePointerCapture(): void {};
});

beforeEach(() => {
  window.history.replaceState({}, '', '/admin/overview');
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
  fetchMock = vi.fn().mockImplementation(ok(OVERVIEW));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the KPI grid', () => {
  it('renders every headline number from one payload', async () => {
    renderPage();

    // The tiles render immediately (cold, with skeletons); the NUMBERS arrive
    // with the payload, so the first assertion has to be the awaited one.
    await screen.findByText('1,240');

    const users = screen.getByTestId('stat-tile-users');
    expect(within(users).getByTestId('stat-value')).toHaveTextContent('1,240');
    expect(within(users).getByText('318 active in the last 30 days')).toBeInTheDocument();

    expect(
      within(screen.getByTestId('stat-tile-orgs')).getByTestId('stat-value'),
    ).toHaveTextContent('7');
    expect(
      within(screen.getByTestId('stat-tile-projects')).getByTestId('stat-value'),
    ).toHaveTextContent('23');

    const tasks = screen.getByTestId('stat-tile-tasks');
    expect(within(tasks).getByTestId('stat-value')).toHaveTextContent('4,810');
    expect(within(tasks).getByText('265 completed in the last 30 days')).toBeInTheDocument();
  });

  /**
   * `errorRate24h` is a FRACTION OF ONE. Reading it with the percent-level
   * formatter renders "0.1%" for a 7% error rate — a dashboard that says the
   * platform is healthy while it is not.
   */
  it('reads the error rate as a 0–1 share, not as a percent level', async () => {
    renderPage();

    await screen.findByText('7.3%');
    const tile = screen.getByTestId('stat-tile-error-rate');
    expect(within(tile).getByTestId('stat-value')).toHaveTextContent('7.3%');
  });

  it('makes every tile a link to the surface that explains it', async () => {
    renderPage();

    expect(await screen.findByTestId('stat-tile-users')).toHaveAttribute('href', '/admin/users');
    expect(screen.getByTestId('stat-tile-orgs')).toHaveAttribute('href', '/admin/orgs');
    expect(screen.getByTestId('stat-tile-projects')).toHaveAttribute('href', '/admin/projects');
    expect(screen.getByTestId('stat-tile-tasks')).toHaveAttribute('href', '/admin/analytics/work');
    expect(screen.getByTestId('stat-tile-error-rate')).toHaveAttribute(
      'href',
      '/admin/analytics/traffic',
    );
  });

  it('names each link by what it opens, not by the metric beside it', async () => {
    renderPage();

    expect(
      await screen.findByRole('link', { name: 'Open the user directory' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the traffic analytics' })).toBeInTheDocument();
  });
});

describe('the trend panels', () => {
  it('describes each chart with a sentence carrying its headline numbers', async () => {
    renderPage();

    // 13 × 10 + 90 = 220 events, peaking at 90.
    expect(
      await screen.findByLabelText('220 events over the last 14 days, peaking at 90 in a day.'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('120 requests over the last 24 hours, peaking at 5 in an hour.'),
    ).toBeInTheDocument();
  });

  /**
   * The API never omits a quiet bucket, so `length > 0` is true even on a brand
   * new install. A flat line along the baseline is a chart that tells an
   * operator nothing while looking like it told them something.
   */
  it('shows the empty state for a gap-filled series of zeros', async () => {
    fetchMock.mockImplementation(
      ok({
        ...OVERVIEW,
        eventsSeries: OVERVIEW.eventsSeries.map((point) => ({ ...point, value: 0 })),
      }),
    );
    renderPage();

    await screen.findByText('No activity recorded yet');
    const panel = screen.getByTestId('overview-events-panel');
    expect(within(panel).getByText('No activity recorded yet')).toBeInTheDocument();
    // The other panel still has data and still draws.
    expect(
      within(screen.getByTestId('overview-requests-panel')).queryByText(
        'No traffic in the last 24 hours',
      ),
    ).not.toBeInTheDocument();
  });

  it('offers a retry inside the panel rather than blanking the page', async () => {
    fetchMock.mockImplementation(boom());
    renderPage();

    await screen.findAllByRole('button', { name: 'Try again' });
    const panel = screen.getByTestId('overview-events-panel');
    expect(within(panel).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // The page header survives a failed request.
    expect(screen.getByRole('heading', { name: 'Platform overview' })).toBeInTheDocument();
  });
});

describe('auto-refresh', () => {
  /**
   * Off by default. Polling a dashboard by default is a background load on
   * every deployment for a page usually open because somebody is reading it
   * once.
   */
  it('starts switched off', async () => {
    renderPage();

    const toggle = await screen.findByTestId('overview-auto-refresh');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleName('Refresh every 30s');
  });

  it('can be turned on', async () => {
    const user = userEvent.setup();
    renderPage();

    const toggle = await screen.findByTestId('overview-auto-refresh');
    await user.click(toggle);

    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
  });
});
