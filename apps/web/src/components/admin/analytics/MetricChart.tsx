import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { formatCount } from '@/components/dashboard/format';
import ChartFrame from '@/components/reports/ChartFrame';
import { ChartTooltipContent } from '@/components/reports/ChartTooltip';
import {
  AXIS_TICK,
  CHART_CHROME,
  DASH,
  PLOT_MARGIN,
  STROKE,
  chartAnimation,
  useColdChart,
} from '@/components/reports/chart-theme';
import type { MetricPoint } from '@/components/admin/analytics/metric-registry';

/**
 * The ONE chart body every analytics surface renders.
 *
 * ═══ THREE STATES, AND ONLY THIS FILE OWNS THEM ══════════════════════════
 *
 *     cold  →  silent  →  plot
 *
 * **Cold** is a skeleton at the EXACT height the plot will occupy, so the card
 * does not jump when the data lands. **Silent** is an empty state, not a flat
 * line: series are gap-filled SERVER-side (see `admin-analytics.schema.ts`), so
 * a window with no activity arrives as twenty-four real zeroes rather than an
 * empty array — and a line pinned to the x-axis reads as a broken chart, not as
 * "nothing happened". {@link hasSignal} is that rule, in one predicate, shared
 * by the dashboards' own `silent` checks.
 *
 * A REFRESH KEEPS THE OLD PLOT. `loading` is only ever true on a cold slot (the
 * store keeps warm data on screen while it re-reads), so this never swaps a
 * drawn chart for a skeleton.
 *
 * ═══ ANIMATION IS COLD-LOAD-ONLY ═════════════════════════════════════════
 *
 * Recharts' entry animation is worth having exactly once: the first time a
 * reader sees the shape. On the 30-second auto-refresh it is a chart that
 * redraws itself from zero every half minute, which is why `firstRender` lives
 * in {@link Plot} — a component that MOUNTS when data first appears and stays
 * mounted across every refresh, so the ref is a true "have I ever drawn this".
 *
 * The switch is a PROP, not a CSS gate: an SVG path animation is JS-driven and
 * immune to `html[data-motion]`. W2.4 landed exactly that pair of helpers on the
 * reports dashboard, and W3.1 unified the two call sites — `useColdChart()` is
 * the "have I ever drawn this" ref this file used to hand-roll, and
 * `chartAnimation(cold)` folds in the reduced-motion branch and the 600ms
 * duration. Both are motion-registry entry #6 (`lib/motion-registry.ts`), so
 * every Recharts plot in FlowBoard now answers to one implementation.
 *
 * ═══ COLOURS ARE TOKENS ══════════════════════════════════════════════════
 *
 * `var(--chart-N)` strings handed straight to SVG attributes — SVG presentation
 * attributes resolve custom properties exactly like CSS declarations, so a
 * Theme Studio preset swap recolours the chart with no re-render and there is
 * no hex literal anywhere in this file (design-system §6).
 */

/** Chart colour slot → the token it resolves to. */
const SERIES_COLORS = {
  1: 'var(--chart-1)',
  2: 'var(--chart-2)',
  3: 'var(--chart-3)',
  4: 'var(--chart-4)',
  5: 'var(--chart-5)',
} as const;

export type MetricColor = keyof typeof SERIES_COLORS;

/** Default plot height. Matches `PanelCard`'s chart skeleton, deliberately. */
export const METRIC_CHART_HEIGHT = 240;

/**
 * A row of the plot: an x label plus one numeric field per series.
 *
 * `MetricPoint` is assignable to this, so a single-series caller hands its
 * registry points straight in with `key: 'value'`.
 */
export interface MetricChartRow {
  label: string;
  [key: string]: string | number;
}

export interface MetricChartSeries {
  /** The field to read off each row. */
  key: string;
  /** Already-translated legend/tooltip name. */
  label: string;
  color: MetricColor;
  /** Tooltip value formatter. Defaults to a thousands-separated integer. */
  format?: (value: number) => string;
}

export interface MetricChartProps {
  rows: readonly MetricChartRow[];
  series: readonly MetricChartSeries[];
  /**
   * `bar` for a categorical x-axis (hours of day, status classes, endpoints),
   * `line` for a time axis. A bar chart of ninety daily buckets is a comb; a
   * line chart of four status classes is a lie about continuity.
   */
  kind?: 'line' | 'bar';
  height?: number;
  /** True only while a COLD slot is in flight — see the header. */
  loading?: boolean;
  /** The panel's own title. Feeds the chart's accessible sentence. */
  title: string;
  emptyTitle: string;
  emptyMessage?: string;
  /** `data-testid` on the plot wrapper. */
  testId?: string;
}

/**
 * Whether a series is worth charting.
 *
 * Exported because the dashboards ask the same question of their whole payload
 * before deciding to render an empty state instead of a grid of empty cards.
 */
export function hasSignal(
  rows: readonly MetricChartRow[],
  series: readonly MetricChartSeries[],
): boolean {
  return rows.some((row) =>
    series.some((entry) => {
      const value = row[entry.key];
      return typeof value === 'number' && value > 0;
    }),
  );
}

/**
 * Whether every plotted number is a whole one — i.e. whether this is a COUNT.
 *
 * Exported for the same reason {@link hasSignal} is: it is a claim about the
 * data that a test can make without rendering Recharts into a zero-sized jsdom
 * box. See the `allowDecimals` note on the y-axis for what it decides.
 *
 * An empty or all-missing series answers `true`: an axis with nothing on it has
 * no fractions to show, and `false` would hand the empty case the looser rule.
 */
export function allIntegers(
  rows: readonly MetricChartRow[],
  series: readonly MetricChartSeries[],
): boolean {
  return rows.every((row) =>
    series.every((entry) => {
      const value = row[entry.key];
      return typeof value !== 'number' || Number.isInteger(value);
    }),
  );
}

/** `MetricPoint[]` → the single-series row shape, with no copying of intent. */
export function pointRows(points: readonly MetricPoint[]): MetricChartRow[] {
  return points.map((point) => ({ label: point.label, value: point.value }));
}

/** The single-series descriptor a registry entry implies. */
export function pointSeries(
  label: string,
  color: MetricColor,
  format?: (value: number) => string,
): MetricChartSeries[] {
  return [{ key: 'value', label, color, format }];
}

export function MetricChart({
  rows,
  series,
  kind = 'line',
  height = METRIC_CHART_HEIGHT,
  loading = false,
  title,
  emptyTitle,
  emptyMessage,
  testId,
}: MetricChartProps) {
  const { t } = useTranslation(['analytics']);

  if (loading) {
    return (
      <Skeleton
        data-testid="metric-chart-skeleton"
        className="w-full"
        style={{ blockSize: height }}
      />
    );
  }

  if (!hasSignal(rows, series)) {
    return (
      <div data-testid="metric-chart-empty">
        <EmptyState title={emptyTitle} message={emptyMessage} className="py-8" />
      </div>
    );
  }

  // One clause per series, so the sentence carries the numbers rather than
  // announcing "chart". `ChartFrame` renders it as the plot's accessible name.
  const clauses = series.map((entry) => {
    const values = rows
      .map((row) => row[entry.key])
      .filter((value): value is number => typeof value === 'number');
    const format = entry.format ?? ((value: number) => formatCount(value));
    return t('analytics:chart.summarySeries', {
      label: entry.label,
      latest: format(values[values.length - 1] ?? 0),
      peak: format(values.length > 0 ? Math.max(...values) : 0),
    });
  });

  const summary = t('analytics:chart.summary', {
    title,
    buckets: formatCount(rows.length),
    series: clauses.join(' '),
  });

  return (
    <div data-testid={testId} style={{ blockSize: height }}>
      <ChartFrame summary={summary}>
        <Plot rows={rows} series={series} kind={kind} />
      </ChartFrame>
    </div>
  );
}

/**
 * The Recharts plot itself.
 *
 * Its own component so that {@link useColdChart}'s ref means "the first time
 * this chart was ever drawn" rather than "the first time the card rendered":
 * `MetricChart` returns a skeleton before this mounts, and a hook living up
 * there would burn the animation on a frame that had no data in it.
 */
function Plot({
  rows,
  series,
  kind,
}: {
  rows: readonly MetricChartRow[];
  series: readonly MetricChartSeries[];
  kind: 'line' | 'bar';
}) {
  // Called ONCE per plot and spread across every series below: one subscription,
  // and three series that cannot disagree about whether this draw is cold.
  const animation = chartAnimation(useColdChart());

  const labels = Object.fromEntries(series.map((entry) => [entry.key, entry.label]));
  // The tooltip formats every row with the FIRST series' formatter: a chart
  // mixes counts with counts and durations with durations, never both, so a
  // per-row lookup would be indirection with no case behind it.
  const format = series[0]?.format ?? ((value: number) => formatCount(value));

  const axes = (
    <>
      <CartesianGrid stroke={CHART_CHROME.grid} strokeDasharray={DASH.grid} vertical={false} />
      <XAxis
        dataKey="label"
        stroke={CHART_CHROME.axis}
        tick={{ ...AXIS_TICK }}
        tickLine={false}
        interval="preserveStartEnd"
        minTickGap={16}
      />
      <YAxis
        stroke={CHART_CHROME.axis}
        tick={{ ...AXIS_TICK }}
        tickLine={false}
        axisLine={false}
        width={44}
        /*
          A COUNT AXIS GETS WHOLE TICKS (W3.1).

          Recharts picks tick values from the data's range, and on a small range
          — "organizations created", peaking at 1 — its default is 0, 0.25, 0.5,
          0.75, 1. There is no such thing as a quarter of an organization, and
          the reader is left doing arithmetic to discover the series is integral.

          The flag is DERIVED FROM THE DATA rather than declared per metric,
          because the same component also draws error RATES and latency in
          milliseconds, where the fractional ticks are the whole point: pinning
          `allowDecimals={false}` globally would collapse a 0–24% error-rate axis
          to a single tick at 0. "Every plotted value is a whole number" is the
          honest test, it needs no registry field to be kept in sync, and it is
          right by construction for any metric added later.
        */
        allowDecimals={!allIntegers(rows, series)}
        tickFormatter={(value: number) => format(value)}
      />
      <Tooltip
        cursor={
          kind === 'bar'
            ? { fill: CHART_CHROME.grid, fillOpacity: 0.35 }
            : { stroke: CHART_CHROME.guide, strokeDasharray: DASH.guide }
        }
        content={(props) => (
          <ChartTooltipContent {...props} labels={labels} formatValue={format} />
        )}
      />
    </>
  );

  return (
    <ResponsiveContainer width="100%" height="100%">
      {kind === 'bar' ? (
        <BarChart data={[...rows]} margin={{ ...PLOT_MARGIN }} barGap={2}>
          {axes}
          {series.map((entry) => (
            <Bar
              key={entry.key}
              dataKey={entry.key}
              fill={SERIES_COLORS[entry.color]}
              radius={[2, 2, 0, 0]}
              {...animation}
            />
          ))}
        </BarChart>
      ) : (
        <LineChart data={[...rows]} margin={{ ...PLOT_MARGIN }}>
          {axes}
          {series.map((entry) => (
            <Line
              key={entry.key}
              type="monotone"
              dataKey={entry.key}
              stroke={SERIES_COLORS[entry.color]}
              strokeWidth={STROKE.data}
              // A dot per bucket turns a 90-point line into a caterpillar; the
              // active dot on hover is what a reader actually needs.
              dot={false}
              activeDot={{ r: 3 }}
              {...animation}
            />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}

export default MetricChart;
