// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { StatDelta } from '@/components/dashboard/StatDelta';
import { StatTile } from '@/components/dashboard/StatTile';

/**
 * The KPI tile in both of its modes, and the trend pill's three directions.
 *
 * The interesting assertions are structural rather than visual: that the LINK
 * wraps the card (so the whole tile is the hit target), that the testid rides
 * the outermost element either way, and that the delta pill is absent — not
 * zeroed — when there is no trend.
 */

afterEach(cleanup);

const renderInRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('StatTile — static', () => {
  it('renders label, value and caption, with no link', () => {
    renderInRouter(
      <StatTile id="dau" label="Active users" value="1,234" caption="Last 24 hours" />,
    );

    const tile = screen.getByTestId('stat-tile-dau');
    expect(within(tile).getByTestId('stat-value')).toHaveTextContent('1,234');
    expect(within(tile).getByText('Last 24 hours')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('names itself as a region, so a KPI grid is navigable', () => {
    renderInRouter(<StatTile id="dau" label="Active users" value={7} />);
    expect(screen.getByRole('region', { name: 'Active users' })).toBeInTheDocument();
  });

  it('emits NO heading — a dozen tiles must not become a document outline', () => {
    renderInRouter(<StatTile id="dau" label="Active users" value={7} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('omits the delta pill entirely when there is no trend', () => {
    renderInRouter(<StatTile id="dau" label="Active users" value={7} />);
    expect(screen.queryByTestId('stat-delta')).not.toBeInTheDocument();
  });

  it('renders a ZERO delta, because flat is a statement', () => {
    renderInRouter(<StatTile id="dau" label="Active users" value={7} delta={0} />);
    expect(screen.getByTestId('stat-delta')).toHaveTextContent('0.0%');
  });
});

describe('StatTile — linked', () => {
  it('wraps the whole card in the link, so the tile IS the affordance', () => {
    renderInRouter(
      <StatTile
        id="dau"
        label="Active users"
        value="1,234"
        to="/admin/analytics/engagement/dau"
        linkLabel="Open the active users breakdown"
      />,
    );

    const link = screen.getByRole('link', { name: 'Open the active users breakdown' });
    expect(link).toHaveAttribute('href', '/admin/analytics/engagement/dau');
    // The card is INSIDE the link, not beside it.
    expect(within(link).getByRole('region', { name: 'Active users' })).toBeInTheDocument();
  });

  it('puts the testid on the outermost element in BOTH modes', () => {
    const { unmount } = renderInRouter(<StatTile id="dau" label="Active users" value={1} />);
    expect(screen.getByTestId('stat-tile-dau').tagName).toBe('SECTION');
    unmount();

    renderInRouter(<StatTile id="dau" label="Active users" value={1} to="/x" linkLabel="Open" />);
    expect(screen.getByTestId('stat-tile-dau').tagName).toBe('A');
  });

  it('falls back to the label when no link label is supplied', () => {
    renderInRouter(<StatTile id="dau" label="Active users" value={1} to="/x" />);
    expect(screen.getByRole('link', { name: 'Active users' })).toBeInTheDocument();
  });

  it('still shows the trend pill inside the link', () => {
    renderInRouter(
      <StatTile id="dau" label="Active users" value={1} delta={-4.25} to="/x" linkLabel="Open" />,
    );
    const link = screen.getByRole('link', { name: 'Open' });
    expect(within(link).getByTestId('stat-delta')).toHaveTextContent('-4.3%');
  });
});

describe('StatDelta', () => {
  it('marks the three directions distinctly', () => {
    const { unmount } = render(<StatDelta value={12.5} />);
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-direction', 'up');
    expect(screen.getByTestId('stat-delta')).toHaveTextContent('+12.5%');
    unmount();

    const second = render(<StatDelta value={-12.5} />);
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-direction', 'down');
    expect(screen.getByTestId('stat-delta')).toHaveTextContent('-12.5%');
    second.unmount();

    render(<StatDelta value={0} />);
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-direction', 'flat');
  });

  it('tints from a TOKEN, never a literal colour', () => {
    render(<StatDelta value={5} />);
    const pill = screen.getByTestId('stat-delta');

    expect(pill.style.color).toContain('var(--success)');
    expect(pill.style.background).toContain('color-mix(in oklab, var(--success) 12%, transparent)');
  });

  it('uses the danger token when the number falls', () => {
    render(<StatDelta value={-5} />);
    expect(screen.getByTestId('stat-delta').style.color).toContain('var(--danger)');
  });

  it('hides its arrow from assistive tech — the sign is already in the text', () => {
    const { container } = render(<StatDelta value={5} />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden');
  });
});

/**
 * POLARITY (R2 W3.5) — the fix for the "no lower-is-better mode" gap.
 *
 * The whole design is the SPLIT: the arrow and `data-direction` follow the SIGN
 * (what the number did, always true), and only the colour and `data-tone` follow
 * the JUDGEMENT (whether that was good, which is a fact about the metric). The
 * matrix below is the contract, and it is written as a table on purpose: the way
 * this goes wrong is one of the four cells quietly flipping.
 */
describe('StatDelta — goodDirection', () => {
  const CASES = [
    { value: 12.5, good: 'up', direction: 'up', tone: 'good', token: '--success' },
    { value: -12.5, good: 'up', direction: 'down', tone: 'bad', token: '--danger' },
    { value: 12.5, good: 'down', direction: 'up', tone: 'bad', token: '--danger' },
    { value: -12.5, good: 'down', direction: 'down', tone: 'good', token: '--success' },
  ] as const;

  it.each(CASES)(
    'value $value with goodDirection $good is a $direction arrow tinted $tone',
    ({ value, good, direction, tone, token }) => {
      render(<StatDelta value={value} goodDirection={good} />);
      const pill = screen.getByTestId('stat-delta');

      // The ARROW never lies about the number, whichever polarity is in play.
      expect(pill).toHaveAttribute('data-direction', direction);
      expect(pill).toHaveAttribute('data-tone', tone);
      expect(pill.style.color).toContain(`var(${token})`);
    },
  );

  it('defaults to `up`, so every existing caller is unchanged', () => {
    render(<StatDelta value={-4} />);
    const pill = screen.getByTestId('stat-delta');
    expect(pill).toHaveAttribute('data-tone', 'bad');
    expect(pill.style.color).toContain('var(--danger)');
  });

  it('is FLAT and muted at zero under either polarity', () => {
    const { unmount } = render(<StatDelta value={0} goodDirection="down" />);
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-tone', 'flat');
    expect(screen.getByTestId('stat-delta').style.color).toContain('var(--text-muted)');
    unmount();

    render(<StatDelta value={0} goodDirection="up" />);
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-tone', 'flat');
  });

  it('is forwarded by StatTile', () => {
    render(
      <StatTile id="error-rate" label="Error rate" value="1.2%" delta={-30} goodDirection="down" />,
    );
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-tone', 'good');
  });
});
