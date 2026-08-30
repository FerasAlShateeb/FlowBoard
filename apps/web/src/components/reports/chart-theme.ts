import { useEffect, useRef } from 'react';

import { prefersReducedMotion } from '@/lib/motion-policy';

/**
 * The chart palette and the axis/grid furniture, as tokens.
 *
 * ZERO COLOUR LITERALS (project checklist §B). Every value below is a
 * `var(--…)` STRING handed straight to an SVG attribute — which works because
 * SVG presentation attributes resolve custom properties exactly like CSS
 * declarations do, so `stroke="var(--chart-1)"` follows the Theme Studio, both
 * palettes, and a live preset swap without the chart re-rendering. Reaching for
 * `getComputedStyle` to resolve the colours into hex would break all three.
 *
 * SERIES ASSIGNMENT — fixed here, once, so the six charts read as one system:
 *
 *   | series                          | token       | why                      |
 *   |---------------------------------|-------------|--------------------------|
 *   | burndown remaining              | `--chart-1` | the primary accent: the  |
 *   |                                 |             | line the reader came for |
 *   | burndown ideal                  | `--text-muted` | furniture, not data   |
 *   | burnup completed                | `--chart-2` | "delivered" hue, shared  |
 *   |                                 |             | with velocity completed  |
 *   | burnup scope                    | `--chart-4` | "planned/committed" hue  |
 *   | CFD to-do                       | `--chart-5` | at low alpha: the calm   |
 *   |                                 |             | base of the stack        |
 *   | CFD in progress                 | `--chart-1` | the band that matters    |
 *   | CFD done                        | `--chart-2` | same "delivered" hue     |
 *   | velocity committed              | `--chart-4` | low alpha = the plan     |
 *   | velocity completed              | `--chart-2` | full strength = the fact |
 *   | cycle-time dots                 | `--chart-1` |                          |
 *   | workload open points            | `--chart-1` |                          |
 *
 * The pairing is the point: "committed / scope" is always `--chart-4` and
 * "completed / done" is always `--chart-2`, on every chart that shows both, so
 * a reader learns the code once.
 */

/** Semantic chrome — grid lines, axes and tick labels. */
export const CHART_CHROME = {
  grid: 'var(--border)',
  axis: 'var(--border)',
  text: 'var(--text-muted)',
  /** The dashed "ideal" guide and the percentile reference lines. */
  guide: 'var(--text-muted)',
} as const;

/** The five data slots, by role rather than by number. */
export const CHART_SERIES = {
  primary: 'var(--chart-1)',
  delivered: 'var(--chart-2)',
  warning: 'var(--chart-3)',
  planned: 'var(--chart-4)',
  quiet: 'var(--chart-5)',
} as const;

/** Tick label typography. 11px is the smallest size that stays legible dense. */
export const TICK_FONT_SIZE = 11;

/** Shared `tick` styling for both axes. */
export const AXIS_TICK = {
  fill: CHART_CHROME.text,
  fontSize: TICK_FONT_SIZE,
} as const;

/**
 * The plot margins.
 *
 * Asymmetric on purpose: the left gutter holds the y tick labels, the bottom
 * one holds the rotated-free day labels, and the top 8px keeps the highest data
 * point from being clipped by the container edge. These are PLOT coordinates,
 * not page ones — they are not mirrored under RTL, which is correct, because
 * the plot is an LTR island (see `ChartFrame`).
 *
 * `right` IS SIZED FOR THE LONGEST LOCALE, NOT FOR ENGLISH (WP5.1). Recharts
 * centres each x tick on its data point, so the LAST tick spills half its width
 * past the end of the x range, and whatever `right` leaves is the only
 * clearance it gets — Recharts' own `<svg>` is `overflow: hidden`, so the
 * excess is not merely tight, it is CUT.
 *
 * At 12px English fitted by a hair and Arabic did not: `Intl` gives Arabic no
 * abbreviated month, so "6 سبتمبر" is 38px against "Sep 6"'s 24 and "28 أغسطس"
 * is 55px. WP3.8 saw the dashboard shave its final tick; measured, three charts
 * clipped. 28px clears the widest of them — the cycle-time scatter's `scale=
 * "time"` axis, whose last tick can land a whole "28 أغسطس" from the edge — in
 * every chart on both dashboards, verified by measuring every tick against the
 * clipping `<svg>` rather than by eye.
 *
 * The alternative — a shorter Arabic date — was rejected: a truncated month
 * name is a worse answer than twelve pixels of plot, and it would have to be
 * re-decided for every language added after Arabic.
 */
export const PLOT_MARGIN = { top: 8, right: 28, bottom: 4, left: 4 } as const;

/**
 * Series stroke widths. The "data" line is deliberately thicker than the
 * "guide" line, so the two read as foreground and background at a glance rather
 * than as two equal claims.
 */
export const STROKE = { data: 2, guide: 1.5 } as const;

/** The dash pattern shared by the ideal line, the average line and the grid. */
export const DASH = { guide: '4 4', grid: '3 3' } as const;

/**
 * Fill opacity for the two "this was the plan" series (velocity committed, CFD
 * to-do). Low enough to sit behind the fact, high enough to have an edge.
 */
export const PLANNED_FILL_OPACITY = 0.32;

/** Stacked-area fill opacity — three bands have to remain distinguishable. */
export const AREA_FILL_OPACITY = 0.55;

/**
 * The theme's `chartStyle` token applied to one series' fill (WP5.6).
 *
 * The Theme Studio's Chart-style switch promises "Filled areas or plain lines
 * on the reports dashboard", and until WP5.6 nothing read the token it wrote.
 * `line` zeroes the FILL and leaves the stroke, which turns a stacked-area band
 * into a cumulative line — the honest reading of the setting, and the reason it
 * is expressed as an opacity rather than as a different chart component: the
 * axes, the stack order, the tooltip and the legend are all unchanged, so
 * flipping the switch cannot move the data.
 *
 * A function rather than a ternary at the call site because it is the one piece
 * of the wiring that can be WRONG (an inverted test would leave the switch
 * doing the opposite of what it says) and the one piece that can be asserted
 * without rendering Recharts into a zero-sized jsdom container.
 */
export function fillOpacityFor(style: 'filled' | 'line', base: number): number {
  return style === 'line' ? 0 : base;
}

/* ══ MOTION ═══════════════════════════════════════════════════════════════════
 *
 * Registry entry #6 (`lib/motion-registry.ts`). Recharts draws its series with a
 * JS-driven `react-smooth` animation, which is immune to `index.css`'s
 * `data-motion` gate the same way the `motion` library is — so the policy has to
 * be read in JavaScript, here, and handed to Recharts as a prop.
 *
 * ── THE RULE: COLD LOADS ANIMATE, WARM REFRESHES DO NOT ────────────────────
 *
 * The six report charts previously hardcoded `isAnimationActive={false}`, which
 * was the right call for the wrong reason: what makes a chart animation
 * obnoxious is not the animation, it is REPLAYING it. The reports dashboard
 * refetches on window focus and re-renders on every sprint-picker and
 * range-picker change; a chart that redraws itself from zero each time turns a
 * comparison into a wait.
 *
 * A first draw is different. It is the moment the reader has nothing to compare
 * against yet, and 600ms of a line writing itself in is what tells them which
 * direction the series runs before they have read a single tick label.
 *
 * So the flag is COLD, not "animation on" — see {@link useColdChart} for how a
 * chart knows which one it is.
 *
 * ── THE ANALYTICS CONSOLE SHARES THIS PAIR ─────────────────────────────────
 *
 * `components/admin/analytics/MetricChart.tsx` hand-rolled the same firstRender
 * ref against `prefersReducedMotion()` while W2.2 and W2.4 ran in parallel; W3.1
 * pointed it here. That matters more on the console than on the reports
 * dashboard, because the console has an opt-in 30-second auto-refresh — the
 * exact case where "cold, not on" is the difference between a chart and a
 * metronome.
 */

/**
 * How long a cold chart takes to draw itself in.
 *
 * Deliberately NOT `--speed`. `--speed` (130ms) is the chrome-transition token:
 * it paces hovers, colour changes and other movements the reader did not ask to
 * watch. This one they did — it is the drawing of the data — and at 130ms a
 * line chart's sweep is a flicker. Recharts' own default is 1500ms, which is
 * long enough to be in the way of a dashboard you are scanning; 600ms is the
 * span where the sweep still reads as direction rather than as a delay.
 */
export const CHART_ANIMATION_MS = 600;

/**
 * The animation props for one Recharts series.
 *
 * Spread onto every `<Line>` / `<Area>` / `<Bar>` / `<Scatter>`:
 *
 *     <Line {...chartAnimation(cold)} … />
 *
 * A plain function, not a hook, so it can be called once per chart and spread
 * across three series without three subscriptions — and so it is assertable in
 * a node-environment test without rendering Recharts into a zero-sized jsdom
 * box. The reduced-motion branch is the `false` return: Recharts then paints the
 * final geometry on the first frame, which is byte-for-byte the pre-Round-2
 * behaviour.
 *
 * `animationDuration` is omitted entirely when inactive rather than set to 0 —
 * an inactive series never reads it, and leaving it out keeps "we are not
 * animating" a single unambiguous fact in the props rather than two that could
 * disagree.
 */
export function chartAnimation(cold: boolean): {
  isAnimationActive: boolean;
  animationDuration?: number;
} {
  const active = cold && !prefersReducedMotion();
  return active
    ? { isAnimationActive: true, animationDuration: CHART_ANIMATION_MS }
    : { isAnimationActive: false };
}

/**
 * True on a chart's FIRST render, false on every render after it.
 *
 * "Cold" is defined as *this component instance has not painted yet*, and that
 * is the honest definition on this dashboard: `ReportCard` only mounts its child
 * once the query has data, so a mount IS a cold load, and every subsequent
 * render of that instance is a refetch, a sprint change or a theme flip — all
 * warm.
 *
 * The flip happens in an effect, which is load-bearing timing: the effect runs
 * AFTER the commit that started Recharts' animation, and flipping a ref triggers
 * no re-render of its own, so the cold animation is never interrupted by its own
 * bookkeeping. The next render — the one caused by new data — is the first to
 * see `false`, which is exactly the render that must not re-animate.
 */
export function useColdChart(): boolean {
  const warm = useRef(false);
  const cold = !warm.current;

  useEffect(() => {
    warm.current = true;
  }, []);

  return cold;
}
