// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import '@/i18n';
import { installJsdomStubs } from '@/components/tasks/__tests__/test-utils';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PanelCard } from '@/components/dashboard/PanelCard';
import { usePanelChromeCopy, type PanelChromeCopy } from '@/components/dashboard/chrome-copy';

/**
 * The state ladder, in order, and the three skeleton shapes.
 *
 * The ORDER is the whole point of this component, so every rung is asserted
 * against the rung above it being simultaneously true — "error while also
 * pending" is not a contrived input, it is what a failed query looks like
 * during its background refetch.
 */

installJsdomStubs();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderPanel = (ui: React.ComponentProps<typeof PanelCard>) =>
  render(
    <TooltipProvider>
      <PanelCard {...ui} />
    </TooltipProvider>,
  );

const CONTENT = <p>the chart</p>;

describe('PanelCard — the state ladder', () => {
  it('renders content when nothing else is true', () => {
    renderPanel({ title: 'Requests', children: CONTENT });
    expect(screen.getByText('the chart')).toBeInTheDocument();
  });

  it('ERROR beats pending — a failed query keeps its retry button through a refetch', async () => {
    const onRetry = vi.fn();
    renderPanel({
      title: 'Requests',
      error: new Error('boom'),
      isPending: true,
      onRetry,
      children: CONTENT,
    });

    expect(screen.queryByTestId('panel-skeleton-chart')).not.toBeInTheDocument();
    expect(screen.queryByText('the chart')).not.toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /try again/i });
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('PENDING beats empty — an in-flight query has not proved anything empty yet', () => {
    renderPanel({ title: 'Requests', isPending: true, isEmpty: true, children: CONTENT });

    expect(screen.getByTestId('panel-skeleton-chart')).toBeInTheDocument();
    expect(screen.queryByText('the chart')).not.toBeInTheDocument();
  });

  it('EMPTY beats content — an axis pair with nothing between it reads as a bug', () => {
    renderPanel({
      title: 'Requests',
      isEmpty: true,
      emptyTitle: 'No traffic in this window',
      emptyMessage: 'Try a wider range.',
      children: CONTENT,
    });

    expect(screen.getByText('No traffic in this window')).toBeInTheDocument();
    expect(screen.getByText('Try a wider range.')).toBeInTheDocument();
    expect(screen.queryByText('the chart')).not.toBeInTheDocument();
  });

  it('draws the caption only above content that actually exists', () => {
    const caption = <span>legend</span>;
    const { rerender } = renderPanel({ title: 'Requests', caption, children: CONTENT });
    expect(screen.getByText('legend')).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <PanelCard title="Requests" caption={caption} isPending>
          {CONTENT}
        </PanelCard>
      </TooltipProvider>,
    );
    expect(screen.queryByText('legend')).not.toBeInTheDocument();
  });
});

describe('PanelCard — skeletons', () => {
  it('defaults to the chart shape at the standard plot height', () => {
    renderPanel({ title: 'Requests', isPending: true, children: CONTENT });
    expect(screen.getByTestId('panel-skeleton-chart')).toHaveStyle({ blockSize: '240px' });
  });

  it('reserves the height a chart will occupy, so the panel does not jump', () => {
    renderPanel({
      title: 'Requests',
      isPending: true,
      skeleton: { kind: 'chart', height: 320 },
      children: CONTENT,
    });
    expect(screen.getByTestId('panel-skeleton-chart')).toHaveStyle({ blockSize: '320px' });
  });

  it('draws a KPI stack for a headline panel', () => {
    renderPanel({
      title: 'Active users',
      isPending: true,
      skeleton: { kind: 'kpi' },
      children: CONTENT,
    });
    expect(screen.getByTestId('panel-skeleton-kpi')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-skeleton-chart')).not.toBeInTheDocument();
  });

  it('draws exactly the number of table rows it was asked for', () => {
    renderPanel({
      title: 'Top endpoints',
      isPending: true,
      skeleton: { kind: 'table', rows: 8 },
      children: CONTENT,
    });
    expect(screen.getByTestId('panel-skeleton-table').children).toHaveLength(8);
  });

  it('never draws zero rows — a table skeleton of nothing reserves nothing', () => {
    renderPanel({
      title: 'Top endpoints',
      isPending: true,
      skeleton: { kind: 'table', rows: 0 },
      children: CONTENT,
    });
    expect(screen.getByTestId('panel-skeleton-table').children).toHaveLength(1);
  });

  it('does NOT pin a fixed aspect ratio — the height comes from the content', () => {
    const { container } = renderPanel({ title: 'Requests', children: CONTENT });
    expect(container.querySelector('[class*="aspect-"]')).toBeNull();
  });
});

describe('PanelCard — header', () => {
  it('titles itself with a level-two heading', () => {
    renderPanel({ title: 'Requests over time', children: CONTENT });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Requests over time' }),
    ).toBeInTheDocument();
  });

  it('offers the explanation on a real focusable button, not an icon on a div', async () => {
    renderPanel({
      title: 'Requests',
      info: 'How many requests the API served.',
      children: CONTENT,
    });

    const trigger = screen.getByTestId('panel-info');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAccessibleName('What this chart shows');

    await userEvent.hover(trigger);
    expect(await screen.findAllByText('How many requests the API served.')).not.toHaveLength(0);
  });

  it('renders no info control when there is nothing to explain', () => {
    renderPanel({ title: 'Requests', children: CONTENT });
    expect(screen.queryByTestId('panel-info')).not.toBeInTheDocument();
  });

  it('keeps the toolbar out of a printed page', () => {
    renderPanel({
      title: 'Requests',
      toolbar: <button type="button">Export</button>,
      children: CONTENT,
    });
    expect(
      screen.getByRole('button', { name: 'Export' }).closest('[data-print-hide]'),
    ).not.toBeNull();
  });
});

/**
 * THE KIT READS THE CATALOG IN EXACTLY ONE PLACE (R2 W3.5).
 *
 * `chrome-copy.ts` opens by claiming no component in the dashboard kit calls
 * `t()` itself — the exported SHAPES are the contract, and the keys behind them
 * are an implementation detail that can move. `PanelCard` was the one component
 * breaking that: it held its own `useTranslation(['reports','common'])`, which
 * left two of the kit's strings outside the KEPT/MINTED table a reviewer checks
 * against and tied the analytics console to the reports namespace's layout.
 *
 * Both assertions compare the RENDERED string to what `usePanelChromeCopy()`
 * resolves, rather than to an English literal. A hard-coded expectation would
 * still pass if the component went back to reading a key directly, as long as
 * that key happened to hold the same words — which is exactly the regression.
 */
describe('PanelCard — its copy comes from chrome-copy', () => {
  /** Reads the shared shape through the same i18n instance the panel uses. */
  function panelCopy(): PanelChromeCopy {
    let resolved: PanelChromeCopy | null = null;
    function Probe() {
      resolved = usePanelChromeCopy();
      return null;
    }
    const view = render(<Probe />);
    view.unmount();
    if (!resolved) throw new Error('the copy probe rendered nothing');
    return resolved;
  }

  it('names the info button with the shared `infoLabel`', () => {
    const copy = panelCopy();
    renderPanel({ title: 'Requests', info: 'What it measures.', children: CONTENT });

    expect(screen.getByTestId('panel-info')).toHaveAccessibleName(copy.infoLabel);
    expect(copy.infoLabel.length).toBeGreaterThan(0);
  });

  it('falls back to the shared `emptyTitle` when the caller names none', () => {
    const copy = panelCopy();
    renderPanel({ title: 'Requests', isEmpty: true, children: CONTENT });

    expect(screen.getByText(copy.emptyTitle)).toBeInTheDocument();
    expect(copy.emptyTitle.length).toBeGreaterThan(0);
  });

  it("still prefers the caller's own empty title", () => {
    const copy = panelCopy();
    renderPanel({
      title: 'Requests',
      isEmpty: true,
      emptyTitle: 'No traffic in this window',
      children: CONTENT,
    });

    expect(screen.getByText('No traffic in this window')).toBeInTheDocument();
    expect(screen.queryByText(copy.emptyTitle)).not.toBeInTheDocument();
  });
});
