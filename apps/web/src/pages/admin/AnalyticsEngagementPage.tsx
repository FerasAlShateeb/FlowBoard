import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import i18n from '@/i18n';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { SectionHeader } from '@/components/dashboard/SectionHeader';
import { RangePicker } from '@/components/dashboard/RangePicker';
import { bucketLabel, formatCount, formatShare } from '@/components/dashboard/format';
import { seriesDelta } from '@/components/dashboard/series-delta';
import DrillChartCard from '@/components/admin/analytics/DrillChartCard';
import MetricChart, { pointSeries } from '@/components/admin/analytics/MetricChart';
import MetricTile, { KpiSkeleton } from '@/components/admin/analytics/MetricTile';
import { detailPath, INTERVAL_LABEL_KEYS } from '@/components/admin/analytics/metric-registry';
import { useAnalyticsDomain } from '@/hooks/useAnalytics';

/**
 * Admin → Analytics → Engagement (`/admin/analytics/engagement`).
 *
 * "Are people here, and are they coming back?" — the active-user pair, sign-up
 * volume, stickiness, when the deployment is actually busy, and what people
 * did. ONE round trip (`GET /api/admin/analytics/engagement`), every tile and
 * every card drilling into `AnalyticsDetailPage` through the metric registry.
 *
 * ── THE RHYTHM ALL FOUR DASHBOARDS SHARE ────────────────────────────────────
 * header (title · subtitle · the shared range picker) → KPI grid → a `silent`
 * check → either one empty state or a two-column grid of drill cards, the first
 * spanning both columns. Reading one of these four files should teach you the
 * other three; only the metrics differ.
 *
 * ── WHY `signups` IS A WINDOW TOTAL AND `dau` IS A LAST BUCKET ───────────────
 * They answer different questions. "How many people were here" is a level, and
 * the honest level is the newest bucket; "how many joined" is a volume, and a
 * volume over a window is its sum. Each tile's caption says which, because the
 * number alone cannot.
 */

const DOMAIN = 'engagement' as const;

export default function AnalyticsEngagementPage() {
  const { t } = useTranslation(['analytics']);
  const view = useAnalyticsDomain(DOMAIN);
  const { data, cold, interval } = view;

  const dauRows = useMemo(
    () =>
      (data?.dauSeries ?? []).map((point) => ({
        label: bucketLabel(point.t, interval),
        value: point.value,
      })),
    [data, interval],
  );

  const signupRows = useMemo(
    () =>
      (data?.signupsSeries ?? []).map((point) => ({
        label: bucketLabel(point.t, interval),
        value: point.value,
      })),
    [data, interval],
  );

  const hourRows = useMemo(
    () =>
      (data?.activityByHour ?? []).map((bucket) => ({
        label: `${String(bucket.hour).padStart(2, '0')}:00`,
        value: bucket.value,
      })),
    [data],
  );

  const typeRows = useMemo(
    () =>
      (data?.eventsByType ?? []).map((row) => ({
        // Translated per RENDER of this memo rather than per language change —
        // the same trade the registry's loaders make, and the reason the table
        // in the drill-down translates its cells instead (see the registry).
        label: i18n.t(`admin:eventType.${row.type}`),
        value: row.count,
      })),
    [data],
  );

  const signupsTotal = (data?.signupsSeries ?? []).reduce((sum, p) => sum + p.value, 0);
  const latestDau = data?.dauSeries.at(-1)?.value ?? 0;
  const latestStickiness = data?.stickinessSeries.at(-1)?.value ?? 0;

  const header = (
    <SectionHeader
      title={t('analytics:engagement.title')}
      subtitle={t('analytics:engagement.subtitle')}
      actions={<RangePicker value={view.range} onChange={view.setRange} testId="analytics-range" />}
    />
  );

  if (view.status === 'error') {
    return (
      <div className="flex flex-col gap-[var(--gap)]">
        {header}
        <ErrorState
          error={view.error}
          title={t('analytics:engagement.loadError')}
          onRetry={view.reload}
        />
      </div>
    );
  }

  // Gap-filled series mean "no activity" arrives as real zeroes, so emptiness is
  // a predicate over the VALUES, never over the array length.
  const silent =
    data !== null &&
    data.mau === 0 &&
    !data.dauSeries.some((p) => p.value > 0) &&
    !data.signupsSeries.some((p) => p.value > 0) &&
    data.eventsByType.length === 0;

  const intervalWord = t(INTERVAL_LABEL_KEYS[interval]);

  return (
    <div className="flex flex-col gap-[var(--gap)]" data-testid="admin-analytics-engagement">
      {header}

      <div
        className="grid grid-cols-2 gap-[var(--gap)] xl:grid-cols-4"
        data-testid="admin-analytics-engagement-kpis"
      >
        {cold ? (
          Array.from({ length: 4 }, (_, index) => <KpiSkeleton key={index} />)
        ) : (
          <>
            <MetricTile
              metric="dau"
              domain={DOMAIN}
              label={t('analytics:engagement.kpis.dau')}
              value={formatCount(latestDau)}
              caption={t('analytics:engagement.kpis.dauCaption')}
              delta={seriesDelta(data?.dauSeries ?? [])}
              to={detailPath(DOMAIN, 'dau')}
            />
            <MetricTile
              metric="mau"
              domain={DOMAIN}
              label={t('analytics:engagement.kpis.mau')}
              value={formatCount(data?.mau ?? 0)}
              caption={t('analytics:engagement.kpis.mauCaption')}
              // No delta: `mau` is a scalar for the window's end, not a series,
              // so there is no previous bucket to compare it against. Absence is
              // the truth; a zero would be a claim.
              to={detailPath(DOMAIN, 'dau')}
            />
            <MetricTile
              metric="signups"
              domain={DOMAIN}
              label={t('analytics:engagement.kpis.signups')}
              value={formatCount(signupsTotal)}
              caption={t('analytics:engagement.kpis.signupsCaption')}
              delta={seriesDelta(data?.signupsSeries ?? [])}
              to={detailPath(DOMAIN, 'signups')}
            />
            <MetricTile
              metric="stickiness"
              domain={DOMAIN}
              label={t('analytics:engagement.kpis.stickiness')}
              // A 0–1 ratio (the contract is explicit), so `formatShare` — the
              // one that multiplies by 100 — never `formatPercent`.
              value={formatShare(latestStickiness, 1)}
              caption={t('analytics:engagement.kpis.stickinessCaption')}
              delta={seriesDelta(data?.stickinessSeries ?? [])}
              to={detailPath(DOMAIN, 'stickiness')}
            />
          </>
        )}
      </div>

      {silent ? (
        <EmptyState
          title={t('analytics:engagement.empty.title')}
          message={t('analytics:engagement.empty.message')}
        />
      ) : (
        <div className="grid gap-[var(--gap)] xl:grid-cols-2">
          <DrillChartCard
            title={t('analytics:engagement.charts.dau.title')}
            info={t('analytics:metrics.engagement.dau.subtitle')}
            to={detailPath(DOMAIN, 'dau')}
            testId="analytics-chart-dau"
            className="xl:col-span-2"
          >
            <MetricChart
              rows={dauRows}
              series={pointSeries(t('analytics:series.activeUsers'), 2)}
              title={t('analytics:engagement.charts.dau.title')}
              height={260}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-dau-plot"
            />
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:engagement.charts.signups.title')}
            info={t('analytics:engagement.charts.signups.subtitle', { interval: intervalWord })}
            to={detailPath(DOMAIN, 'signups')}
            testId="analytics-chart-signups"
          >
            <MetricChart
              rows={signupRows}
              series={pointSeries(t('analytics:series.signups'), 1)}
              title={t('analytics:engagement.charts.signups.title')}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-signups-plot"
            />
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:engagement.charts.activityByHour.title')}
            info={t('analytics:engagement.charts.activityByHour.subtitle')}
            to={detailPath(DOMAIN, 'activity-by-hour')}
            testId="analytics-chart-activity-by-hour"
          >
            {/* Bars, not a line: hour-of-day is twenty-four CATEGORIES that
                happen to be ordered, and a line between 23:00 and 00:00 would
                draw a continuity that does not exist. */}
            <MetricChart
              rows={hourRows}
              series={pointSeries(t('analytics:series.events'), 4)}
              kind="bar"
              title={t('analytics:engagement.charts.activityByHour.title')}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-activity-by-hour-plot"
            />
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:engagement.charts.eventsByType.title')}
            info={t('analytics:engagement.charts.eventsByType.subtitle')}
            to={detailPath(DOMAIN, 'events-by-type')}
            testId="analytics-chart-events-by-type"
            className="xl:col-span-2"
          >
            <MetricChart
              rows={typeRows}
              series={pointSeries(t('analytics:series.events'), 5)}
              kind="bar"
              title={t('analytics:engagement.charts.eventsByType.title')}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-events-by-type-plot"
            />
          </DrillChartCard>
        </div>
      )}
    </div>
  );
}
