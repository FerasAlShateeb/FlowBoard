// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Registers the English catalog on the default i18next instance. Must be
// imported before anything calls `useTranslation`.
import '@/i18n';
import { useAuthStore } from '@/stores/useAuthStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BurndownCard } from '@/components/reports/BurndownChart';
import { BurnupCard } from '@/components/reports/BurnupChart';
import { VelocityCard } from '@/components/reports/VelocityChart';
import { WorkloadCard } from '@/components/reports/WorkloadBars';

/**
 * PER-TILE DEGRADATION — the property the whole dashboard is built around.
 *
 * Four cards are rendered side by side against ONE mocked transport that
 * answers each endpoint differently: burndown fails, burnup and velocity
 * succeed, workload never resolves. The assertion is that each card lands in
 * its own state and none of them takes a sibling down with it — which is the
 * behaviour that makes six independent queries worth the extra round trips.
 *
 * The same render doubles as the screen-reader test: a chart's accessible name
 * is a full sentence with the headline numbers interpolated into it, and that
 * sentence is the ONLY thing a non-sighted user gets from an SVG.
 *
 * jsdom, per-file (`vitest.config.ts` keeps the package's default environment
 * DOM-free). Recharts measures its container through `ResizeObserver`, which
 * jsdom does not implement — the stub below is enough for it to render a
 * zero-sized plot, and nothing here asserts on plot geometry.
 */

const PROJECT = '11111111-1111-4111-8111-111111111111';
const SPRINT = '22222222-2222-4222-8222-222222222222';

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function boom(): Response {
  return new Response(
    JSON.stringify({ success: false, error: { code: 'internal_error', message: 'nope' } }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  );
}

const BURNUP = {
  days: [
    { date: '2026-08-01', completedPoints: 0, scopePoints: 20 },
    { date: '2026-08-02', completedPoints: 7, scopePoints: 22 },
  ],
};

const VELOCITY = {
  sprints: [{ sprintId: SPRINT, name: 'Sprint 1', committedPoints: 20, completedPoints: 17 }],
};

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

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/reports/burndown')) return Promise.resolve(boom());
      if (url.includes('/reports/burnup')) return Promise.resolve(ok(BURNUP));
      if (url.includes('/reports/velocity')) return Promise.resolve(ok(VELOCITY));
      // Workload never settles — the card must stay in its skeleton.
      return new Promise<Response>(() => {});
    }),
  );
});

afterEach(() => {
  // EXPLICIT, not automatic. Testing Library only registers its own cleanup
  // when the test framework exposes `afterEach` as a GLOBAL, and this package
  // runs Vitest without `globals: true` — so without this line every render
  // stays in the document and the next test's `getBy*` finds four cards
  // instead of one.
  cleanup();
  vi.unstubAllGlobals();
});

function renderDashboardCards() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <BurndownCard projectId={PROJECT} sprintId={SPRINT} />
        <BurnupCard projectId={PROJECT} sprintId={SPRINT} />
        <VelocityCard projectId={PROJECT} />
        <WorkloadCard projectId={PROJECT} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('dashboard card degradation', () => {
  it('renders every card frame regardless of its query state', async () => {
    renderDashboardCards();

    // All four titles are present immediately — a failing query must never
    // remove a card from the grid, only change what is inside it.
    for (const title of ['Burndown', 'Burnup', 'Velocity', 'Workload']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('shows a retry on the failing card ONLY', async () => {
    renderDashboardCards();

    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(retry).toBeInTheDocument();
    // Exactly one card failed, so exactly one retry button exists.
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
  });

  it('draws the succeeding cards while a sibling is broken', async () => {
    renderDashboardCards();

    // The burnup and velocity plots both reach their success branch.
    await waitFor(() => {
      expect(screen.getByLabelText(/^Burnup across/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/^Velocity across/)).toBeInTheDocument();
  });

  it('keeps the never-resolving card in its own skeleton', async () => {
    renderDashboardCards();

    await screen.findByRole('button', { name: 'Try again' });
    // Burndown resolved (to an error) and the two successes drew; only the
    // pending workload query is still showing a placeholder.
    expect(screen.getAllByTestId('report-card-skeleton')).toHaveLength(1);
  });
});

describe('screen-reader summaries', () => {
  it('interpolates the headline numbers into the plot label', async () => {
    renderDashboardCards();

    const burnup = await screen.findByLabelText(/^Burnup across/);
    // Last day: 7 of 22 points, over 2 day buckets.
    expect(burnup).toHaveAttribute(
      'aria-label',
      'Burnup across 2 days. 7 of 22 points are complete.',
    );
    expect(burnup).toHaveAttribute('role', 'img');
  });

  it('averages the velocity sprints into its label', async () => {
    renderDashboardCards();

    const velocity = await screen.findByLabelText(/^Velocity across/);
    expect(velocity).toHaveAttribute(
      'aria-label',
      'Velocity across 1 completed sprints. Average 17 points completed; the most recent delivered 17.',
    );
  });

  it('keeps the plot an LTR island so Recharts geometry is never mirrored', async () => {
    renderDashboardCards();

    const burnup = await screen.findByLabelText(/^Burnup across/);
    expect(burnup).toHaveAttribute('dir', 'ltr');
  });

  it('repeats the sentence as sr-only text inside the plot frame', async () => {
    renderDashboardCards();

    const burnup = await screen.findByLabelText(/^Burnup across/);
    expect(burnup.querySelector('.sr-only')?.textContent).toBe(
      'Burnup across 2 days. 7 of 22 points are complete.',
    );
  });
});
