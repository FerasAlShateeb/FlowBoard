// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { chartAnimation, useColdChart } from '@/components/reports/chart-theme';
import { setMotionPref } from '@/lib/motion-policy';

/**
 * `useColdChart` — the half of registry entry #6 that needs a commit.
 *
 * `chart-theme.test.ts` proves the truth table of `chartAnimation`. This file
 * proves the thing that decides which ROW of that table a chart lands on, and it
 * needs a DOM because "cold" is defined by an effect having run.
 *
 * ── WHY A PROBE RATHER THAN A REAL CHART ───────────────────────────────────
 *
 * Recharts renders into a `ResponsiveContainer` that jsdom measures as zero by
 * zero, and its animation lives inside `react-smooth`'s own timers. Asserting
 * "the line animated" there would be asserting on a library's internals through
 * a container with no size — a test that fails when Recharts refactors and
 * passes when we break the wiring, which is exactly backwards. The wiring is
 * what is ours, so the wiring is what is tested: the hook says cold once, then
 * never again, and the helper turns that into the prop.
 */

function Probe() {
  const cold = useColdChart();
  return (
    <output data-testid="probe">
      {String(cold)}:{String(chartAnimation(cold).isAnimationActive)}
    </output>
  );
}

/** `"<cold>:<isAnimationActive>"` as the probe currently reports it. */
function reading(): string {
  return screen.getByTestId('probe').textContent ?? '';
}

afterEach(() => {
  cleanup();
  setMotionPref('full');
  delete document.documentElement.dataset.motion;
});

describe('useColdChart', () => {
  it('reports COLD on the first render of an instance', () => {
    render(<Probe />);
    expect(reading()).toBe('true:true');
  });

  it('reports WARM on every render after the first — a refetch must not redraw', () => {
    const { rerender } = render(<Probe />);
    expect(reading()).toBe('true:true');

    // A refetch, a sprint change, a theme flip: same instance, new render.
    rerender(<Probe />);
    expect(reading()).toBe('false:false');

    rerender(<Probe />);
    expect(reading()).toBe('false:false');
  });

  it('is cold again for a NEW instance, because a mount is a new cold load', () => {
    const { rerender, unmount } = render(<Probe />);
    rerender(<Probe />);
    expect(reading()).toBe('false:false');
    unmount();

    // `ReportCard` mounts its child only once the query has data, so a fresh
    // mount genuinely is a first read — navigating back to the dashboard should
    // draw the plot in, not snap it in.
    render(<Probe />);
    expect(reading()).toBe('true:true');
  });

  it('does not trigger a re-render of its own when it goes warm', () => {
    // The flip lives in a ref written from an effect, which is load-bearing
    // timing: a state flip here would re-render mid-animation and hand Recharts
    // `isAnimationActive: false` while its own sweep was still running, cutting
    // the very animation this hook exists to allow.
    render(<Probe />);
    expect(reading()).toBe('true:true');
  });

  it('stays cold but SILENT under reduced motion', () => {
    setMotionPref('reduced');
    render(<Probe />);

    // The hook answers "has this painted yet", which is a fact about the
    // component and not about the user's preference; the policy is applied by
    // `chartAnimation`, one layer up. Keeping the two separate is what lets a
    // live preference change take effect without remounting every chart.
    expect(reading()).toBe('true:false');
  });
});
