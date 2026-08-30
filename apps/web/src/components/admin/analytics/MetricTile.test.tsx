// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import '@/i18n';
import MetricTile, { KpiSkeleton } from '@/components/admin/analytics/MetricTile';
import DrillChartCard from '@/components/admin/analytics/DrillChartCard';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * The two link affordances of the console, and the doctrine that separates
 * them: a NUMBER's whole card is the link; a CHART's link is one control in its
 * header, because a card-wide anchor would swallow the plot's own hover.
 */

afterEach(cleanup);

const renderInRouter = (ui: ReactElement) =>
  render(
    <MemoryRouter>
      <TooltipProvider>{ui}</TooltipProvider>
    </MemoryRouter>,
  );

describe('MetricTile', () => {
  it('wraps the whole card in the link — the tile IS the affordance', () => {
    renderInRouter(
      <MetricTile
        metric="dau"
        label="Daily active users"
        value="1,234"
        caption="The most recent bucket."
        to="/admin/analytics/engagement/dau"
      />,
    );

    const link = screen.getByRole('link', {
      name: 'Open the Daily active users breakdown',
    });
    expect(link).toHaveAttribute('href', '/admin/analytics/engagement/dau');
    // The card is INSIDE the link, not beside it.
    expect(within(link).getByRole('region', { name: 'Daily active users' })).toBeInTheDocument();
    expect(within(link).getByTestId('stat-value')).toHaveTextContent('1,234');
    expect(within(link).getByText('The most recent bucket.')).toBeInTheDocument();
  });

  it('resolves BOTH testid contracts — the console’s and the kit’s', () => {
    renderInRouter(<MetricTile metric="dau" label="Daily active users" value={7} to="/x" />);

    // A spec can address either and get the same pixels: `analytics-kpi-*` is
    // the console's, `stat-tile-*` is `StatTile`'s own.
    const wrapper = screen.getByTestId('analytics-kpi-dau');
    expect(within(wrapper).getByTestId('stat-tile-dau')).toBeInTheDocument();
  });

  it('renders the trend pill when a delta is supplied', () => {
    renderInRouter(
      <MetricTile metric="signups" label="Sign-ups" value={12} delta={-4.25} to="/x" />,
    );
    expect(screen.getByTestId('stat-delta')).toHaveTextContent('-4.3%');
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-direction', 'down');
  });

  it('renders a ZERO delta, because flat is a statement', () => {
    renderInRouter(<MetricTile metric="signups" label="Sign-ups" value={12} delta={0} to="/x" />);
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-direction', 'flat');
  });

  it('omits the pill entirely when there is no trend to show', () => {
    // Absence is the truth; a zero would be a claim. `mau` is the live case —
    // a scalar with no previous bucket to compare against.
    renderInRouter(<MetricTile metric="mau" label="Monthly active users" value={90} to="/x" />);
    expect(screen.queryByTestId('stat-delta')).not.toBeInTheDocument();
  });

  it('emits NO heading — a KPI grid must not become a document outline', () => {
    renderInRouter(<MetricTile metric="dau" label="Daily active users" value={7} to="/x" />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  /**
   * POLARITY COMES FROM THE REGISTRY (R2 W3.5).
   *
   * The tile does not decide whether a falling number is good news, and neither
   * does the page rendering it: `MetricDefinition.deltaDirection` does, one
   * declaration per metric. These assertions go through the REAL registry rather
   * than a stub, because the thing worth guarding is that the two are actually
   * wired together — a stub would keep passing after the lookup was dropped.
   */
  it('paints a FALLING error rate green — the registry says down is good', () => {
    renderInRouter(
      <MetricTile
        metric="error-rate"
        domain="traffic"
        label="Error rate"
        value="0.4%"
        delta={-30}
        to="/x"
      />,
    );

    const pill = screen.getByTestId('stat-delta');
    // The arrow still states the fact; only the tone is the judgement.
    expect(pill).toHaveAttribute('data-direction', 'down');
    expect(pill).toHaveAttribute('data-tone', 'good');
  });

  it('paints a RISING error count red', () => {
    renderInRouter(
      <MetricTile metric="errors" domain="traffic" label="Errors" value={42} delta={30} to="/x" />,
    );

    const pill = screen.getByTestId('stat-delta');
    expect(pill).toHaveAttribute('data-direction', 'up');
    expect(pill).toHaveAttribute('data-tone', 'bad');
  });

  it('leaves an ordinary count alone — a rising request total is still good', () => {
    renderInRouter(
      <MetricTile
        metric="requests"
        domain="traffic"
        label="Requests"
        value={1000}
        delta={30}
        to="/x"
      />,
    );
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-tone', 'good');
  });

  it('defaults to up for a tile with no domain — the overview row', () => {
    renderInRouter(<MetricTile metric="eventsToday" label="Events" value={9} delta={12} to="/x" />);
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-tone', 'good');
  });

  /** The one shape the lookup cannot serve: a tile id that is not a metric id. */
  it('honours an explicit override for a tile whose id is not a registry id', () => {
    renderInRouter(
      <MetricTile
        metric="p95"
        domain="traffic"
        label="p95 latency"
        value="88 ms"
        delta={20}
        goodDirection="down"
        to="/x"
      />,
    );
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-tone', 'bad');
  });
});

describe('KpiSkeleton', () => {
  it('is hidden from assistive tech and announces no number of its own', () => {
    render(<KpiSkeleton />);
    const skeleton = screen.getByTestId('analytics-kpi-skeleton');
    // A placeholder that a screen reader walks is a placeholder that reads as
    // content; the row's real `aria-busy` story belongs to whatever renders it.
    expect(skeleton).toHaveAttribute('aria-hidden');
    expect(skeleton).toHaveTextContent('');
  });
});

describe('DrillChartCard', () => {
  it('puts the ONLY link in the header, never around the card', () => {
    renderInRouter(
      <DrillChartCard title="Requests" to="/admin/analytics/traffic/requests" testId="chart-req">
        <div data-testid="plot">plot</div>
      </DrillChartCard>,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/admin/analytics/traffic/requests');
    expect(links[0]).toHaveAccessibleName('Open the Requests breakdown');
    expect(links[0]).toHaveAttribute('data-testid', 'chart-req-details');

    // The body is a sibling of the link, not a descendant — which is what keeps
    // a tooltip hover from becoming a navigation.
    expect(within(links[0] as HTMLElement).queryByTestId('plot')).not.toBeInTheDocument();
    expect(screen.getByTestId('plot')).toBeInTheDocument();
  });

  it('addresses the CARD by testid, so it resolves in every state', () => {
    renderInRouter(
      <DrillChartCard title="Requests" to="/x" testId="chart-req">
        <div>plot</div>
      </DrillChartCard>,
    );
    expect(screen.getByTestId('chart-req')).toBeInTheDocument();
  });

  it('renders the panel title as an h2, under the page’s single h1', () => {
    renderInRouter(
      <DrillChartCard title="Requests" to="/x">
        <div>plot</div>
      </DrillChartCard>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Requests' })).toBeInTheDocument();
  });

  it('shows the error branch INSTEAD of its children when one is handed down', () => {
    renderInRouter(
      <DrillChartCard title="Requests" to="/x" error={new Error('nope')}>
        <div data-testid="plot">plot</div>
      </DrillChartCard>,
    );
    expect(screen.queryByTestId('plot')).not.toBeInTheDocument();
    expect(screen.getByText('That did not load')).toBeInTheDocument();
  });
});
