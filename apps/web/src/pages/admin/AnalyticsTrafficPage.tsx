import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TopEndpoint } from '@flowboard/shared';

import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { SectionHeader } from '@/components/dashboard/SectionHeader';
import { RangePicker } from '@/components/dashboard/RangePicker';
import { DataTable, col } from '@/components/dashboard/DataTable';
import {
  bucketLabel,
  formatCount,
  formatMs,
  formatShare,
  NO_VALUE,
} from '@/components/dashboard/format';
import { seriesDelta } from '@/components/dashboard/series-delta';
import AutoRefreshSwitch from '@/components/admin/analytics/AutoRefreshSwitch';
import DrillChartCard from '@/components/admin/analytics/DrillChartCard';
import MetricChart, { pointSeries } from '@/components/admin/analytics/MetricChart';
import MetricTile, { KpiSkeleton } from '@/components/admin/analytics/MetricTile';
import {
  detailPath,
  INTERVAL_LABEL_KEYS,
  LATENCY_LADDER,
} from '@/components/admin/analytics/metric-registry';
import { useAnalyticsDomain } from '@/hooks/useAnalytics';

/**
 * Admin → Analytics → Traffic (`/admin/analytics/traffic`).
 *
 * The HTTP surface: volume, failures, failure RATE, response time and the
 * endpoints doing the most work. This is the page somebody opens while
 * something is on fire, which is why two things here differ from its three
 * siblings:
 *
 *  - **It keeps HOURLY buckets across a whole week** (`HOURLY_UP_TO_DAYS.traffic
 *    = 7` in the store). An outage is a shape you need the hours to see.
 *  - **It offers the opt-in 30-second auto-refresh.** Off by default — see
 *    `AutoRefreshSwitch` — and harmless when on, because the store keeps the
 *    drawn numbers on screen while it re-reads.
 *
 * ── COUNT AND RATE ARE BOTH DRAWN, ON PURPOSE ───────────────────────────────
 * A spike in the error COUNT may just be a traffic spike; a spike in the error
 * RATE is always a regression. The API sends both series rather than letting a
 * client divide two gap-filled series and invent a `0/0` policy in the browser
 * (see `admin-analytics.schema.ts`), and the page draws both for the same
 * reason.
 *
 * ── THE LATENCY LADDER IS A TILE GRID, NOT A CHART ──────────────────────────
 * `latency` is ONE summary for the whole window — five numbers, not a series —
 * so there is no time axis to draw it against. Five tiles read in one glance
 * and the p50 → max ORDER survives, which is the only thing the ladder
 * communicates and the first thing a sortable table would destroy.
 */

const DOMAIN = 'traffic' as const;

export default function AnalyticsTrafficPage() {
  const { t } = useTranslation(['analytics', 'admin']);
  const view = useAnalyticsDomain(DOMAIN);
  const { data, cold, interval } = view;
  const [autoRefresh, setAutoRefresh] = useState(false);

  const ms = t('admin:units.ms');

  const requestRows = useMemo(
    () =>
      (data?.requestsSeries ?? []).map((point) => ({
        label: bucketLabel(point.t, interval),
        value: point.value,
      })),
    [data, interval],
  );

  const errorRows = useMemo(
    () =>
      (data?.errorSeries ?? []).map((point) => ({
        label: bucketLabel(point.t, interval),
        value: point.value,
      })),
    [data, interval],
  );

  const errorRateRows = useMemo(
    () =>
      (data?.errorRateSeries ?? []).map((point) => ({
        label: bucketLabel(point.t, interval),
        value: point.value,
      })),
    [data, interval],
  );

  const statusRows = useMemo(() => {
    const breakdown = data?.statusBreakdown;
    if (!breakdown) return [];
    return (['2xx', '3xx', '4xx', '5xx'] as const).map((cls) => ({
      label: cls,
      value: breakdown[cls],
    }));
  }, [data]);

  const endpointColumns = useMemo(
    () => [
      col<TopEndpoint>({
        id: 'method',
        header: t('analytics:columns.method'),
        accessor: (row) => row.method,
        // Machine text stays LTR inside an otherwise mirrored table.
        cell: (row) => (
          <span dir="ltr" className="font-mono text-xs">
            {row.method}
          </span>
        ),
      }),
      col<TopEndpoint>({
        id: 'path',
        header: t('analytics:columns.path'),
        accessor: (row) => row.path,
        enableHiding: false,
        cell: (row) => (
          <span dir="ltr" className="font-mono text-xs">
            {row.path}
          </span>
        ),
      }),
      col<TopEndpoint>({
        id: 'count',
        header: t('analytics:columns.requests'),
        align: 'end',
        accessor: (row) => row.count,
        cell: (row) => formatCount(row.count),
      }),
      col<TopEndpoint>({
        id: 'avgDurationMs',
        header: t('analytics:columns.avg'),
        align: 'end',
        accessor: (row) => row.avgDurationMs,
        cell: (row) => formatMs(row.avgDurationMs, ms),
      }),
      col<TopEndpoint>({
        id: 'errorRate',
        header: t('analytics:columns.errorRate'),
        align: 'end',
        accessor: (row) => row.errorRate,
        cell: (row) => formatShare(row.errorRate),
      }),
    ],
    [t, ms],
  );

  const requests = (data?.requestsSeries ?? []).reduce((sum, p) => sum + p.value, 0);
  const errors = (data?.errorSeries ?? []).reduce((sum, p) => sum + p.value, 0);

  const header = (
    <SectionHeader
      title={t('analytics:traffic.title')}
      subtitle={t('analytics:traffic.subtitle')}
      actions={
        <>
          <AutoRefreshSwitch
            enabled={autoRefresh}
            onEnabledChange={setAutoRefresh}
            onRefresh={view.reload}
            testId="analytics-traffic-auto-refresh"
          />
          <RangePicker value={view.range} onChange={view.setRange} testId="analytics-range" />
        </>
      }
    />
  );

  if (view.status === 'error') {
    return (
      <div className="flex flex-col gap-[var(--gap)]">
        {header}
        <ErrorState
          error={view.error}
          title={t('analytics:traffic.loadError')}
          onRetry={view.reload}
        />
      </div>
    );
  }

  const silent = data !== null && requests === 0 && data.topEndpoints.length === 0;

  const intervalWord = t(INTERVAL_LABEL_KEYS[interval]);

  return (
    <div className="flex flex-col gap-[var(--gap)]" data-testid="admin-analytics-traffic">
      {header}

      <div
        className="grid grid-cols-2 gap-[var(--gap)] xl:grid-cols-4"
        data-testid="admin-analytics-traffic-kpis"
      >
        {cold ? (
          Array.from({ length: 4 }, (_, index) => <KpiSkeleton key={index} />)
        ) : (
          <>
            <MetricTile
              metric="requests"
              domain={DOMAIN}
              label={t('analytics:traffic.kpis.requests')}
              value={formatCount(requests)}
              caption={t('analytics:traffic.kpis.requestsCaption')}
              delta={seriesDelta(data?.requestsSeries ?? [])}
              to={detailPath(DOMAIN, 'requests')}
            />
            <MetricTile
              metric="errors"
              domain={DOMAIN}
              label={t('analytics:traffic.kpis.errors')}
              value={formatCount(errors)}
              caption={t('analytics:traffic.kpis.errorsCaption')}
              delta={seriesDelta(data?.errorSeries ?? [])}
              to={detailPath(DOMAIN, 'errors')}
            />
            <MetricTile
              metric="error-rate"
              domain={DOMAIN}
              label={t('analytics:traffic.kpis.errorRate')}
              value={requests > 0 ? formatShare(errors / requests, 2) : NO_VALUE}
              caption={t('analytics:traffic.kpis.errorRateCaption')}
              delta={seriesDelta(data?.errorRateSeries ?? [])}
              to={detailPath(DOMAIN, 'error-rate')}
            />
            <MetricTile
              metric="p95"
              domain={DOMAIN}
              label={t('analytics:traffic.kpis.p95')}
              value={data ? formatMs(data.latency.p95, ms) : NO_VALUE}
              caption={t('analytics:traffic.kpis.p95Caption')}
              to={detailPath(DOMAIN, 'latency')}
            />
          </>
        )}
      </div>

      {silent ? (
        <EmptyState
          title={t('analytics:traffic.empty.title')}
          message={t('analytics:traffic.empty.message')}
        />
      ) : (
        <div className="grid gap-[var(--gap)] xl:grid-cols-2">
          <DrillChartCard
            title={t('analytics:traffic.charts.requests.title')}
            info={t('analytics:traffic.charts.requests.subtitle', { interval: intervalWord })}
            to={detailPath(DOMAIN, 'requests')}
            testId="analytics-chart-requests"
            className="xl:col-span-2"
          >
            <MetricChart
              rows={requestRows}
              series={pointSeries(t('analytics:series.requests'), 2)}
              title={t('analytics:traffic.charts.requests.title')}
              height={260}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-requests-plot"
            />
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:traffic.charts.errors.title')}
            info={t('analytics:traffic.charts.errors.subtitle', { interval: intervalWord })}
            to={detailPath(DOMAIN, 'errors')}
            testId="analytics-chart-errors"
          >
            <MetricChart
              rows={errorRows}
              series={pointSeries(t('analytics:series.errors'), 5)}
              title={t('analytics:traffic.charts.errors.title')}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-errors-plot"
            />
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:traffic.charts.errorRate.title')}
            info={t('analytics:traffic.charts.errorRate.subtitle', { interval: intervalWord })}
            to={detailPath(DOMAIN, 'error-rate')}
            testId="analytics-chart-error-rate"
          >
            <MetricChart
              rows={errorRateRows}
              series={pointSeries(t('analytics:series.errorRate'), 5, (value) =>
                formatShare(value, 2),
              )}
              title={t('analytics:traffic.charts.errorRate.title')}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-error-rate-plot"
            />
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:traffic.charts.latency.title')}
            info={t('analytics:traffic.charts.latency.subtitle')}
            to={detailPath(DOMAIN, 'latency')}
            testId="analytics-chart-latency"
          >
            <div
              className="grid grid-cols-5 gap-2"
              role="group"
              aria-label={t('analytics:traffic.charts.latency.aria')}
              data-testid="analytics-latency-ladder"
            >
              {LATENCY_LADDER.map((rung) => (
                <div
                  key={rung}
                  data-testid={`analytics-latency-${rung}`}
                  className="rounded-[var(--radius)] border border-border bg-surface px-2 py-3 text-center"
                >
                  <div className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                    {rung}
                  </div>
                  <div className="mt-1 text-sm font-semibold tabular-nums">
                    {data ? formatMs(data.latency[rung], ms) : NO_VALUE}
                  </div>
                </div>
              ))}
            </div>
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:traffic.charts.statusBreakdown.title')}
            info={t('analytics:traffic.charts.statusBreakdown.subtitle')}
            to={detailPath(DOMAIN, 'status-breakdown')}
            testId="analytics-chart-status-breakdown"
          >
            <MetricChart
              rows={statusRows}
              series={pointSeries(t('analytics:series.responses'), 4)}
              kind="bar"
              title={t('analytics:traffic.charts.statusBreakdown.title')}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-status-breakdown-plot"
            />
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:traffic.charts.topEndpoints.title')}
            info={t('analytics:traffic.charts.topEndpoints.subtitle')}
            to={detailPath(DOMAIN, 'top-endpoints')}
            testId="analytics-chart-top-endpoints"
            className="xl:col-span-2"
          >
            {/* Client mode: no `meta`, so the grid sorts in the browser off each
                column's accessor. The whole endpoint list is already in hand —
                paging it would hide rows the page demonstrably holds. */}
            <DataTable
              aria-label={t('analytics:traffic.charts.topEndpoints.aria')}
              columns={endpointColumns}
              rows={data?.topEndpoints ?? []}
              rowKey={(row) => `${row.method} ${row.path}`}
              loading={cold}
              emptyMessage={t('analytics:traffic.empty.message')}
              enableColumnReorder={false}
            />
          </DrillChartCard>
        </div>
      )}
    </div>
  );
}
