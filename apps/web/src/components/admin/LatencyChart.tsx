import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LatencyBucket } from '@flowboard/shared';

import ChartFrame from '@/components/reports/ChartFrame';
import ChartLegend from '@/components/reports/ChartLegend';
import { PanelCard } from '@/components/dashboard/PanelCard';
import { OPS_CHART_BODY } from '@/components/admin/ops-panel';
import { ChartTooltipContent } from '@/components/reports/ChartTooltip';
import {
  AXIS_TICK,
  CHART_CHROME,
  CHART_SERIES,
  DASH,
  PLOT_MARGIN,
  STROKE,
} from '@/components/reports/chart-theme';
import { useLatency } from '@/hooks/useAdminTelemetry';

import { useTelemetryFormat } from './telemetry-format';
import type { TelemetryBucket, TelemetryWindow } from './telemetry-range';

/**
 * Response-time percentiles over time — p50, p95 and p99.
 *
 * ── THREE SERIES, NOT FIVE ──────────────────────────────────────────────────
 * The endpoint returns p50/p90/p95/p99 and the max. Drawing all five makes a
 * hairball in which the two lines anyone acts on are indistinguishable. p50 is
 * the typical experience, p95 is the one that generates complaints, and p99 is
 * the tail that hides timeouts; p90 sits between two lines already drawn, and
 * the max is a single outlier's line rather than a distribution's. Both stay in
 * the payload and in the tooltip — they are just not strokes on the canvas.
 *
 * ── A SILENT BUCKET IS A GAP, NOT A ZERO ────────────────────────────────────
 * This is the one place the telemetry charts and the volume chart disagree
 * about zero-fill, and the disagreement is the correct one. For VOLUME, zero
 * requests is a true measurement and drawing it to the baseline shows the
 * outage. For LATENCY, zero milliseconds is not a measurement at all — nothing
 * was served, so nothing was fast. Plotting 0 would draw a dramatic dip that
 * reads as "the API got instant" at exactly the moment it stopped answering.
 *
 * `toPoint` therefore maps every `count === 0` bucket's percentiles to `null`,
 * which Recharts renders as a BREAK in the line (`connectNulls` left off, on
 * purpose: bridging the gap would re-introduce the lie in interpolated form).
 * The bucket still occupies its slot on the x-axis, so this chart and the
 * volume chart above it share an identical time domain.
 */

/** A plotted row: the percentiles, nulled out wherever nothing was measured. */
interface LatencyPoint {
  ts: string;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

function toPoint(bucket: LatencyBucket): LatencyPoint {
  if (bucket.count === 0) return { ts: bucket.ts, p50: null, p95: null, p99: null };
  return { ts: bucket.ts, p50: bucket.p50, p95: bucket.p95, p99: bucket.p99 };
}

export function LatencyChart({
  buckets,
  bucket,
}: {
  buckets: readonly LatencyBucket[];
  bucket: TelemetryBucket;
}) {
  const { t } = useTranslation(['admin']);
  const format = useTelemetryFormat();

  const points = useMemo(() => buckets.map(toPoint), [buckets]);

  // The headline is the WORST bucket, not the average of the percentiles: the
  // question this chart answers is "how bad did it get", and averaging p95s
  // across a quiet night hides the ten minutes that mattered.
  const measured = buckets.filter((entry) => entry.count > 0);
  const worstP95 = measured.reduce((worst, entry) => Math.max(worst, entry.p95), 0);
  const typical =
    measured.length === 0
      ? 0
      : measured.reduce((sum, entry) => sum + entry.p50, 0) / measured.length;

  const summary = t('admin:latency.summary', {
    p50: format.ms(typical),
    p95: format.ms(worstP95),
  });

  const labels = {
    p50: t('admin:latency.series.p50'),
    p95: t('admin:latency.series.p95'),
    p99: t('admin:latency.series.p99'),
  };

  return (
    <ChartFrame summary={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ ...PLOT_MARGIN }}>
          <CartesianGrid stroke={CHART_CHROME.grid} strokeDasharray={DASH.grid} vertical={false} />
          <XAxis
            dataKey="ts"
            tickFormatter={(value: string) => format.bucketTick(value, bucket)}
            stroke={CHART_CHROME.axis}
            tick={{ ...AXIS_TICK }}
            tickLine={false}
            minTickGap={28}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke={CHART_CHROME.axis}
            tick={{ ...AXIS_TICK }}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={format.ms}
          />
          <Tooltip
            cursor={{ stroke: CHART_CHROME.grid }}
            content={(props) => (
              <ChartTooltipContent
                {...props}
                labels={labels}
                formatHeading={format.stamp}
                formatValue={format.ms}
                unit={t('admin:units.ms')}
              />
            )}
          />
          {/* Drawn quiet → loud, so the tail line lands on top of the median. */}
          <Line
            type="monotone"
            dataKey="p50"
            stroke={CHART_SERIES.delivered}
            strokeWidth={STROKE.data}
            dot={false}
            activeDot={{ r: 3, fill: CHART_SERIES.delivered }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="p95"
            stroke={CHART_SERIES.primary}
            strokeWidth={STROKE.data}
            dot={false}
            activeDot={{ r: 3, fill: CHART_SERIES.primary }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="p99"
            stroke={CHART_SERIES.warning}
            strokeWidth={STROKE.guide}
            strokeDasharray={DASH.guide}
            dot={false}
            activeDot={{ r: 3, fill: CHART_SERIES.warning }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function LatencyLegend() {
  const { t } = useTranslation(['admin']);
  return (
    <ChartLegend
      entries={[
        { label: t('admin:latency.series.p50'), color: CHART_SERIES.delivered },
        { label: t('admin:latency.series.p95'), color: CHART_SERIES.primary },
        { label: t('admin:latency.series.p99'), color: CHART_SERIES.warning, dashed: true },
      ]}
    />
  );
}

/**
 * The dashboard tile.
 *
 * "Empty" means no bucket in the window MEASURED anything — a window of nothing
 * but zero-filled buckets has no percentiles to draw, and three flat lines at
 * zero would be worse than saying so.
 *
 * A `PanelCard` since W3.1, for the reason spelled out in `RequestsChart`: the
 * ops pages carry a KPI row, two plots and a table, so `ReportCard`'s fixed
 * 16:10 aspect — right for a grid of six report tiles — sized the wrong thing
 * here. {@link OPS_CHART_BODY} keeps this plot exactly as tall as the volume
 * chart it sits beside.
 */
export function LatencyCard({
  window,
  bucket,
}: {
  window: TelemetryWindow;
  bucket: TelemetryBucket;
}) {
  const { t } = useTranslation(['admin']);
  const query = useLatency(window, bucket);
  const buckets = query.data?.buckets ?? [];
  const hasData = buckets.some((entry) => entry.count > 0);

  return (
    <PanelCard
      title={t('admin:latency.title')}
      info={t('admin:latency.info')}
      caption={<LatencyLegend />}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={!hasData}
      emptyTitle={t('admin:latency.empty')}
      emptyMessage={t('admin:latency.emptyBody')}
      bodyClassName={OPS_CHART_BODY}
      testId="latency-card"
    >
      <LatencyChart buckets={buckets} bucket={bucket} />
    </PanelCard>
  );
}

export default LatencyChart;
