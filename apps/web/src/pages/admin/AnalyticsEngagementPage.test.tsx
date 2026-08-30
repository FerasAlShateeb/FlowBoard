// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import '@/i18n';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAnalyticsStore } from '@/stores/useAnalyticsStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import AnalyticsEngagementPage from '@/pages/admin/AnalyticsEngagementPage';
import AnalyticsGrowthPage from '@/pages/admin/AnalyticsGrowthPage';

/**
 * One domain dashboard, rendered — and the rhythm all four share.
 *
 * Engagement stands in for its three siblings: the pages are deliberately the
 * same shape (header → KPI grid → `silent` check → drill-card grid), so a test
 * that proves the rhythm here proves it everywhere, and the per-domain
 * differences are covered by the registry suite instead of by four near-
 * identical render tests.
 *
 * Growth gets one case of its own, because it is the domain whose table
 * deliberately IGNORES the range picker above it.
 */

const ENGAGEMENT = {
  mau: 42,
  dauSeries: [
    { t: '2026-08-01T00:00:00.000Z', value: 8 },
    { t: '2026-08-02T00:00:00.000Z', value: 12 },
  ],
  signupsSeries: [
    { t: '2026-08-01T00:00:00.000Z', value: 2 },
    { t: '2026-08-02T00:00:00.000Z', value: 3 },
  ],
  stickinessSeries: [
    { t: '2026-08-01T00:00:00.000Z', value: 0.2 },
    { t: '2026-08-02T00:00:00.000Z', value: 0.2857 },
  ],
  activityByHour: Array.from({ length: 24 }, (_, hour) => ({ hour, value: hour })),
  eventsByType: [
    { type: 'auth_login', count: 9 },
    { type: 'page_view', count: 30 },
  ],
};

/** Gap-filled and completely quiet — the `silent` case. */
const QUIET = {
  ...ENGAGEMENT,
  mau: 0,
  dauSeries: ENGAGEMENT.dauSeries.map((p) => ({ ...p, value: 0 })),
  signupsSeries: ENGAGEMENT.signupsSeries.map((p) => ({ ...p, value: 0 })),
  stickinessSeries: ENGAGEMENT.stickinessSeries.map((p) => ({ ...p, value: 0 })),
  activityByHour: Array.from({ length: 24 }, (_, hour) => ({ hour, value: 0 })),
  eventsByType: [],
};

const GROWTH = {
  orgsCreatedSeries: [{ t: '2026-08-01T00:00:00.000Z', value: 0 }],
  invitesSentSeries: [{ t: '2026-08-01T00:00:00.000Z', value: 0 }],
  invitesAcceptedSeries: [{ t: '2026-08-01T00:00:00.000Z', value: 0 }],
  acceptanceRate: 0,
  byOrg: [
    {
      orgId: '11111111-1111-4111-8111-111111111111',
      orgName: 'Acme',
      orgSlug: 'acme',
      memberCount: 4,
      projectCount: 2,
      taskCount: 30,
      lastActivityAt: null,
    },
  ],
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
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
  useAnalyticsStore.getState().reset();
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(ok(ENGAGEMENT)));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <TooltipProvider>{ui}</TooltipProvider>
    </MemoryRouter>,
  );
}

describe('AnalyticsEngagementPage', () => {
  it('reads its domain in ONE round trip', async () => {
    renderPage(<AnalyticsEngagementPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/admin/analytics/engagement');
  });

  it('draws KPI skeletons while COLD and swaps them for tiles', async () => {
    renderPage(<AnalyticsEngagementPage />);

    expect(screen.getAllByTestId('analytics-kpi-skeleton')).toHaveLength(4);
    expect(await screen.findByTestId('analytics-kpi-dau')).toBeInTheDocument();
    expect(screen.queryByTestId('analytics-kpi-skeleton')).not.toBeInTheDocument();
  });

  it('reads DAU off the LAST bucket and sign-ups as the window TOTAL', async () => {
    renderPage(<AnalyticsEngagementPage />);

    const dau = await screen.findByTestId('analytics-kpi-dau');
    // A level is the newest bucket…
    expect(within(dau).getByTestId('stat-value')).toHaveTextContent('12');

    // …a volume is the sum over the window.
    const signups = screen.getByTestId('analytics-kpi-signups');
    expect(within(signups).getByTestId('stat-value')).toHaveTextContent('5');
  });

  it('formats stickiness as a PERCENT, because it is a 0–1 ratio', async () => {
    renderPage(<AnalyticsEngagementPage />);

    const tile = await screen.findByTestId('analytics-kpi-stickiness');
    // 0.2857 → "28.6%", never "0.3".
    expect(within(tile).getByTestId('stat-value')).toHaveTextContent('28.6%');
  });

  it('shows a trend on the series tiles and NONE on the scalar one', async () => {
    renderPage(<AnalyticsEngagementPage />);

    const dau = await screen.findByTestId('analytics-kpi-dau');
    // 8 → 12 is +50%.
    expect(within(dau).getByTestId('stat-delta')).toHaveTextContent('+50.0%');

    // `mau` is a scalar for the window's end: there is no previous bucket, so
    // absence is the truth and a zero would be a claim.
    const mau = screen.getByTestId('analytics-kpi-mau');
    expect(within(mau).queryByTestId('stat-delta')).not.toBeInTheDocument();
  });

  it('links every tile into its own drill-down', async () => {
    renderPage(<AnalyticsEngagementPage />);

    const dau = await screen.findByTestId('analytics-kpi-dau');
    expect(within(dau).getByRole('link')).toHaveAttribute(
      'href',
      '/admin/analytics/engagement/dau',
    );
    expect(
      within(screen.getByTestId('analytics-kpi-stickiness')).getByRole('link'),
    ).toHaveAttribute('href', '/admin/analytics/engagement/stickiness');
  });

  it('puts the Details link — and only that — in each chart card header', async () => {
    renderPage(<AnalyticsEngagementPage />);

    const details = await screen.findByTestId('analytics-chart-dau-details');
    expect(details).toHaveAttribute('href', '/admin/analytics/engagement/dau');
    // The card is not itself a link: a chart is interactive, and a card-wide
    // anchor would swallow its tooltips.
    expect(screen.getByTestId('analytics-chart-dau').tagName).not.toBe('A');
  });

  it('renders the shared range picker, not a per-page one', async () => {
    renderPage(<AnalyticsEngagementPage />);
    expect(await screen.findByTestId('analytics-range')).toBeInTheDocument();
  });

  it('re-reads the domain when the range moves', async () => {
    const user = userEvent.setup();
    renderPage(<AnalyticsEngagementPage />);
    await screen.findByTestId('analytics-kpi-dau');

    await user.click(screen.getByTestId('range-pill-7d'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    // The range is the store's, so it survives a move to any other domain.
    expect(useAnalyticsStore.getState().range).toEqual({ preset: '7d' });
  });

  it('replaces the card grid with ONE empty state when the window is silent', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok(QUIET)));
    renderPage(<AnalyticsEngagementPage />);

    // Gap-filled zeroes are "nothing happened", not four flat charts.
    expect(await screen.findByText('No activity in this window')).toBeInTheDocument();
    expect(screen.queryByTestId('analytics-chart-dau')).not.toBeInTheDocument();
    // The KPI row stays: zero IS the answer, and it is worth reading.
    expect(screen.getByTestId('analytics-kpi-dau')).toBeInTheDocument();
  });

  it('renders one retryable error instead of a grid of broken cards', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('down')));
    renderPage(<AnalyticsEngagementPage />);

    expect(
      await screen.findByText('The engagement figures could not be loaded.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('analytics-kpi-dau')).not.toBeInTheDocument();
  });
});

describe('AnalyticsGrowthPage', () => {
  it('is NOT silent when a quiet window still has organizations to show', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok(GROWTH)));
    renderPage(<AnalyticsGrowthPage />);

    // `byOrg` is all-time inventory, not a windowed series — hiding it behind
    // "nothing happened in the last 30 days" would answer a question nobody
    // asked.
    expect(await screen.findByTestId('analytics-chart-by-org')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to show yet')).not.toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('renders a never-touched org as an em dash rather than an epoch', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok(GROWTH)));
    renderPage(<AnalyticsGrowthPage />);

    const card = await screen.findByTestId('analytics-chart-by-org');
    // That row is precisely what this table exists to surface.
    expect(within(card).getAllByText('—').length).toBeGreaterThan(0);
  });
});
