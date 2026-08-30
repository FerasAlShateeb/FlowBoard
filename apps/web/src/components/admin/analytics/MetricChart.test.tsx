// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Registers the English catalog on the default i18next instance. Must be
// imported before anything calls `useTranslation`.
import '@/i18n';
import { setMotionPref } from '@/lib/motion-policy';
import MetricChart, {
  hasSignal,
  pointRows,
  pointSeries,
  type MetricChartRow,
} from '@/components/admin/analytics/MetricChart';

/**
 * The chart body's three states, and the one rule that separates two of them.
 *
 * Recharts is not exercised here beyond "it mounted": `ResponsiveContainer`
 * measures its parent, and jsdom reports every box as 0×0, so a plot renders no
 * paths whatever the data says. What IS worth asserting is the branch — which
 * of skeleton / empty / plot the component chose — because that decision is
 * this file's entire job and it is where the "flat line at zero" bug lives.
 */

const SERIES = pointSeries('Requests', 2);

const ROWS: MetricChartRow[] = [
  { label: 'Jul 1', value: 4 },
  { label: 'Jul 2', value: 9 },
];

/** Gap-filled, and completely quiet — real points, all of them zero. */
const SILENT_ROWS: MetricChartRow[] = [
  { label: 'Jul 1', value: 0 },
  { label: 'Jul 2', value: 0 },
];

beforeAll(() => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  setMotionPref('full');
});

function renderChart(props: Partial<React.ComponentProps<typeof MetricChart>> = {}) {
  return render(
    <MetricChart
      rows={ROWS}
      series={SERIES}
      title="Requests"
      emptyTitle="Nothing in this window"
      emptyMessage="Every bucket is zero."
      testId="chart"
      {...props}
    />,
  );
}

describe('MetricChart — the three states', () => {
  it('draws a SKELETON while cold, at the exact height the plot will occupy', () => {
    renderChart({ loading: true, height: 260 });

    const skeleton = screen.getByTestId('metric-chart-skeleton');
    expect(skeleton).toBeInTheDocument();
    // Reserving the height is what stops the card jumping when data lands.
    expect(skeleton).toHaveStyle({ blockSize: '260px' });

    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('metric-chart-empty')).not.toBeInTheDocument();
  });

  it('treats an ALL-ZERO gap-filled series as EMPTY, not as a flat line', () => {
    // The rule this component exists to hold: series are gap-filled server-side,
    // so "nothing happened" arrives as real zeroes — and a line pinned to the
    // x-axis reads as a broken chart rather than as an answer.
    renderChart({ rows: SILENT_ROWS });

    expect(screen.getByTestId('metric-chart-empty')).toBeInTheDocument();
    expect(screen.getByText('Nothing in this window')).toBeInTheDocument();
    expect(screen.getByText('Every bucket is zero.')).toBeInTheDocument();
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  });

  it('treats an EMPTY array as empty too', () => {
    renderChart({ rows: [] });
    expect(screen.getByTestId('metric-chart-empty')).toBeInTheDocument();
  });

  it('draws the PLOT as soon as one bucket has signal', () => {
    renderChart();

    expect(screen.getByTestId('chart')).toBeInTheDocument();
    expect(screen.queryByTestId('metric-chart-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('metric-chart-skeleton')).not.toBeInTheDocument();
  });

  it('does NOT swap a drawn plot for a skeleton — a warm refresh keeps the chart', () => {
    const { rerender } = renderChart();
    expect(screen.getByTestId('chart')).toBeInTheDocument();

    // `loading` is only ever true on a cold slot (see the store), so this is the
    // contract the page relies on rather than a state this component invents.
    rerender(
      <MetricChart
        rows={ROWS}
        series={SERIES}
        title="Requests"
        emptyTitle="Nothing in this window"
        testId="chart"
        loading={false}
      />,
    );
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });
});

describe('MetricChart — the accessible sentence', () => {
  it('names the plot with the NUMBERS, not with the word "chart"', () => {
    renderChart();

    // `ChartFrame` renders `role="img"` + `aria-label`; without it the SVG is
    // announced as a bag of paths, or skipped entirely.
    const plot = screen.getByRole('img');
    const label = plot.getAttribute('aria-label') ?? '';
    expect(label).toContain('Requests');
    expect(label).toContain('2 buckets');
    // Latest and peak, through the series' own formatter.
    expect(label).toContain('latest 9');
    expect(label).toContain('peak 9');
  });

  it('uses the series formatter in the sentence, so a rate is not read as a count', () => {
    render(
      <MetricChart
        rows={[
          { label: 'a', value: 0.25 },
          { label: 'b', value: 0.5 },
        ]}
        series={pointSeries('Error rate', 5, (value) => `${(value * 100).toFixed(0)}%`)}
        title="Error rate"
        emptyTitle="empty"
        testId="rate"
      />,
    );

    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('latest 50%');
  });

  it('is a plain LTR island, whatever the page direction', () => {
    renderChart();
    // Recharts computes pixel positions from a left origin and does not mirror;
    // the plot's coordinate space stays LTR in every language.
    expect(screen.getByRole('img')).toHaveAttribute('dir', 'ltr');
  });
});

describe('MetricChart — motion', () => {
  it('renders statically under a REDUCED preference', () => {
    setMotionPref('reduced');
    // The assertion a jsdom test can honestly make: the branch still renders and
    // nothing throws. The animation flag itself is a Recharts prop on an element
    // jsdom never lays out — `motion-policy.test.ts` owns the predicate, and the
    // e2e suite owns "does it actually move".
    renderChart();
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });
});

describe('hasSignal', () => {
  it('is false for an empty set and for all-zero buckets alike', () => {
    expect(hasSignal([], SERIES)).toBe(false);
    expect(hasSignal(SILENT_ROWS, SERIES)).toBe(false);
  });

  it('is true as soon as ONE bucket of ONE series is positive', () => {
    expect(hasSignal(ROWS, SERIES)).toBe(true);
    expect(
      hasSignal([{ label: 'a', sent: 0, accepted: 3 }], [
        { key: 'sent', label: 'Sent', color: 4 },
        { key: 'accepted', label: 'Accepted', color: 2 },
      ]),
    ).toBe(true);
  });

  it('ignores a series the rows do not carry', () => {
    expect(hasSignal(ROWS, [{ key: 'missing', label: 'Missing', color: 1 }])).toBe(false);
  });

  it('does not count a NEGATIVE value as signal', () => {
    // No metric in the registry can go negative, so a negative bucket is a bug
    // upstream — and drawing it as if it were data hides that.
    expect(hasSignal([{ label: 'a', value: -5 }], SERIES)).toBe(false);
  });
});

describe('pointRows / pointSeries', () => {
  it('turns registry points into single-series rows keyed `value`', () => {
    expect(pointRows([{ label: 'Jul 1', value: 3 }])).toEqual([{ label: 'Jul 1', value: 3 }]);
    expect(pointSeries('Requests', 2)).toEqual([
      { key: 'value', label: 'Requests', color: 2, format: undefined },
    ]);
  });
});
