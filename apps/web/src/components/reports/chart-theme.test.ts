import { afterEach, describe, expect, it } from 'vitest';

import {
  AREA_FILL_OPACITY,
  CHART_ANIMATION_MS,
  PLANNED_FILL_OPACITY,
  chartAnimation,
  fillOpacityFor,
} from '@/components/reports/chart-theme';
import { setMotionPref } from '@/lib/motion-policy';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * The Theme Studio's Chart-style switch, end to end — as far as it can be
 * asserted without rendering Recharts into a zero-sized jsdom container.
 *
 * The switch has existed since WP4.5 and, until WP5.6, nothing read the token
 * it wrote: `chartStyle` was set, persisted, exported and ignored. A control
 * that describes itself as "Filled areas or plain lines on the reports
 * dashboard" and changes nothing is worse than a missing one — it teaches the
 * reader that the studio's settings are decorative.
 *
 * Two things have to hold, and an inverted implementation would satisfy
 * neither: the token round-trips through the store, and `line` is the value
 * that removes the fill.
 */
describe('fillOpacityFor', () => {
  it('keeps the series fill under the FILLED style', () => {
    expect(fillOpacityFor('filled', AREA_FILL_OPACITY)).toBe(AREA_FILL_OPACITY);
    expect(fillOpacityFor('filled', PLANNED_FILL_OPACITY)).toBe(PLANNED_FILL_OPACITY);
  });

  it('drops the fill to zero under the LINE style, leaving the stroke', () => {
    expect(fillOpacityFor('line', AREA_FILL_OPACITY)).toBe(0);
    expect(fillOpacityFor('line', PLANNED_FILL_OPACITY)).toBe(0);
  });

  it('is the store token that decides, so the studio switch actually reaches it', () => {
    useThemeStore.getState().patchShared({ chartStyle: 'line' });
    expect(fillOpacityFor(useThemeStore.getState().chartStyle(), AREA_FILL_OPACITY)).toBe(0);

    useThemeStore.getState().patchShared({ chartStyle: 'filled' });
    expect(fillOpacityFor(useThemeStore.getState().chartStyle(), AREA_FILL_OPACITY)).toBe(
      AREA_FILL_OPACITY,
    );
  });
});

/**
 * `chartAnimation` — motion registry entry #6, as a truth table.
 *
 * The whole helper is a two-input AND, and both inputs are things that used to
 * be wrong in opposite directions: the charts hardcoded `false` (so a first
 * draw never told the reader which way the line ran), and the naive fix is
 * `true` (so a dashboard being scanned redraws itself on every refetch and every
 * sprint change). Four rows, and each one is a distinct product decision:
 *
 *   cold × full     → animate. The one case that earns it.
 *   warm × full     → still. A refetch is not a first read.
 *   cold × reduced  → still. Reduced motion outranks a nice first impression.
 *   warm × reduced  → still.
 *
 * Node environment, no render: this is the reason the helper is a plain function
 * and not a hook — `useColdChart` needs a DOM, and this does not.
 *
 * The policy caches its preference in module state, so it is restored after each
 * test rather than merely at the start of one.
 */
describe('chartAnimation', () => {
  afterEach(() => {
    setMotionPref('full');
  });

  it('animates a COLD chart under full motion — the only row that moves', () => {
    setMotionPref('full');
    expect(chartAnimation(true)).toEqual({
      isAnimationActive: true,
      animationDuration: CHART_ANIMATION_MS,
    });
  });

  it('never re-animates a WARM refresh', () => {
    setMotionPref('full');
    expect(chartAnimation(false)).toEqual({ isAnimationActive: false });
  });

  it('is silent under reduced motion, cold or not', () => {
    setMotionPref('reduced');
    expect(chartAnimation(true)).toEqual({ isAnimationActive: false });
    expect(chartAnimation(false)).toEqual({ isAnimationActive: false });
  });

  it('omits the duration entirely when inactive rather than setting it to zero', () => {
    setMotionPref('reduced');
    // Two props that could disagree are worse than one that cannot: an inactive
    // series never reads `animationDuration`, so it must not be there to read.
    expect(chartAnimation(true)).not.toHaveProperty('animationDuration');
  });

  it('reads the policy on EVERY call, so a live change reaches the next chart', () => {
    setMotionPref('full');
    expect(chartAnimation(true).isAnimationActive).toBe(true);

    // `chartAnimation` is not a hook and holds no cached answer — the Motion
    // card on `/me` must not need a reload to quiet the reports dashboard.
    setMotionPref('reduced');
    expect(chartAnimation(true).isAnimationActive).toBe(false);
  });

  it('keeps the cold draw well under a second', () => {
    // Recharts' own default is 1500ms, which is long enough to be in the way of
    // a dashboard you are scanning. This number is a product decision, not an
    // implementation detail, so it is pinned.
    expect(CHART_ANIMATION_MS).toBeLessThanOrEqual(800);
    expect(CHART_ANIMATION_MS).toBeGreaterThan(200);
  });
});
