import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RequestsBucket } from '@flowboard/shared';

import ChartFrame from '@/components/reports/ChartFrame';
import ReportCard from '@/components/reports/ReportCard';
import ChartLegend from '@/components/reports/ChartLegend';
import { ChartTooltipContent } from '@/components/reports/ChartTooltip';
import {
  AREA_FILL_OPACITY,
  AXIS_TICK,
  CHART_CHROME,
  CHART_SERIES,
  DASH,
  PLOT_MARGIN,
  STROKE,
} from '@/components/reports/chart-theme';
import { useRequestsOverTime } from '@/hooks/useAdminTelemetry';

import { useTelemetryFormat } from './telemetry-format';
import type { TelemetryBucket, TelemetryWindow } from './telemetry-range';

/**
 * Request volume over time, as a filled area.
 *
 * ── WHY AN AREA AND NOT A LINE ──────────────────────────────────────────────
 * Volume is a quantity that accumulates under the curve; latency (the chart
 * below it on the same page) is a level. Filling the volume series and leaving
 * the latency series as bare lines is what lets a reader tell the two charts
 * apart at a glance instead of reading two axis labels.
 *
 * ── THE ZERO BUCKETS ARE THE POINT ──────────────────────────────────────────
 * The API zero-fills every silent bucket across the window (see
 * `admin-telemetry.service.ts`). Drawing them is not a formality: an area that
 * drops to the baseline for two hours IS the outage, whereas a series with
 * those buckets omitted draws a straight line over the top of it.
 *
 * ── EVERYTHING WAVE-3 ALREADY DECIDED IS REUSED ─────────────────────────────
 * `ChartFrame` (the `dir="ltr"` island, the `role="img"` summary), `ReportCard`
 * (error → loading → empty → chart), the `--chart-*` tokens and the tooltip.
 * This chart makes no new visual decisions, which is the entire reason the two
 * dashboards look like one product.
 */
export function RequestsChart({
  buckets,
  bucket,
}: {
  buckets: readonly RequestsBucket[];
  bucket: TelemetryBucket;
}) {
  const { t } = useTranslation(['admin']);
  const format = useTelemetryFormat();

  const total = buckets.reduce((sum, entry) => sum + entry.count, 0);
  // The weighted mean, NOT the mean of the per-bucket means: a quiet hour with
  // one slow request would otherwise weigh as much as a busy hour with a
  // thousand fast ones.
  const weighted = buckets.reduce((sum, entry) => sum + entry.avgDurationMs * entry.count, 0);
  const average = total === 0 ? 0 : weighted / total;

  // `requests`, not `count`: i18next RESERVES `count` for its plural selector
  // and types it as a number, so a pre-formatted string there is a type error —
  // and every number on this dashboard is pre-formatted (Latin digits, see
  // `lib/lang-policy`).
  const summary = t('admin:requests.summary', {
    requests: format.count(total),
    buckets: format.count(buckets.length),
    avg: format.ms(average),
  });

  const labels = {
    count: t('admin:requests.series.count'),
    avgDurationMs: t('admin:requests.series.avg'),
  };

  return (
    <ChartFrame summary={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...buckets]} margin={{ ...PLOT_MARGIN }}>
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
            width={40}
            allowDecimals={false}
            tickFormatter={format.count}
          />
          <Tooltip
            cursor={{ stroke: CHART_CHROME.grid }}
            content={(props) => (
              <ChartTooltipContent
                {...props}
                labels={labels}
                formatHeading={format.stamp}
                formatValue={format.count}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke={CHART_SERIES.primary}
            strokeWidth={STROKE.data}
            fill={CHART_SERIES.primary}
            fillOpacity={AREA_FILL_OPACITY}
            dot={false}
            activeDot={{ r: 3, fill: CHART_SERIES.primary }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** The legend, rendered by the card above the plot so it flips under RTL. */
function RequestsLegend() {
  const { t } = useTranslation(['admin']);
  return (
    <ChartLegend
      entries={[{ label: t('admin:requests.series.count'), color: CHART_SERIES.primary }]}
    />
  );
}

/**
 * The dashboard tile: this chart's query and its four states.
 *
 * "Empty" is a window in which NOTHING was requested — distinct from a window
 * of zeros, which is a real answer and is drawn.
 */
export function RequestsCard({
  window,
  bucket,
}: {
  window: TelemetryWindow;
  bucket: TelemetryBucket;
}) {
  const { t } = useTranslation(['admin']);
  const query = useRequestsOverTime(window, bucket);
  const buckets = query.data?.buckets ?? [];

  return (
    <ReportCard
      title={t('admin:requests.title')}
      info={t('admin:requests.info')}
      caption={<RequestsLegend />}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={buckets.length === 0}
      emptyTitle={t('admin:requests.empty')}
      emptyMessage={t('admin:requests.emptyBody')}
    >
      <RequestsChart buckets={buckets} bucket={bucket} />
    </ReportCard>
  );
}

export default RequestsChart;
