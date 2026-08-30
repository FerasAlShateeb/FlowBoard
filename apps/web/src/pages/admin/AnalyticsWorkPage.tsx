import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { SectionHeader } from '@/components/dashboard/SectionHeader';
import { RangePicker } from '@/components/dashboard/RangePicker';
import { bucketLabel, formatCount, formatShare, NO_VALUE } from '@/components/dashboard/format';
import { seriesDelta } from '@/components/dashboard/series-delta';
import { formatDecimal } from '@/components/reports/chart-format';
import { getIntlLocale } from '@/lib/lang-policy';
import DrillChartCard from '@/components/admin/analytics/DrillChartCard';
import MetricChart, { pointSeries } from '@/components/admin/analytics/MetricChart';
import MetricTile, { KpiSkeleton } from '@/components/admin/analytics/MetricTile';
import { detailPath, INTERVAL_LABEL_KEYS } from '@/components/admin/analytics/metric-registry';
import { useAnalyticsDomain } from '@/hooks/useAnalytics';

/**
 * Admin → Analytics → Work (`/admin/analytics/work`).
 *
 * "What is this deployment actually delivering?" — across every project, not
 * one. The reports dashboard answers the same question for a single project;
 * this is the platform view, and the two share their unit (cycle time in HOURS)
 * on purpose so the numbers are directly comparable.
 *
 * ── CREATED AND COMPLETED SHARE ONE CHART ───────────────────────────────────
 * Two lines rather than two cards, because the interesting quantity is neither
 * series — it is the GAP between them. A widening gap is a growing backlog, and
 * that is invisible when the two are drawn side by side at different scales.
 *
 * ── THE PERCENTILE CAPTION IS NOT DECORATION ────────────────────────────────
 * `cycleTimeSeries` is an AVERAGE per bucket, and an average cycle time is the
 * number most likely to be quoted and least likely to describe anyone's
 * experience. The p50/p90/p95 caption under the chart is what stops that; when
 * nothing resolved in the window the percentiles are `null` (not zero — see the
 * schema) and the caption says so in words rather than printing three zeroes.
 */

const DOMAIN = 'work' as const;

/** The chart shows the ten busiest projects; the drill-down has the rest. */
const TOP_PROJECTS = 10;

export default function AnalyticsWorkPage() {
  const { t } = useTranslation(['analytics']);
  const view = useAnalyticsDomain(DOMAIN);
  const { data, cold, interval } = view;

  /** One row per bucket carrying BOTH series — what a two-line chart needs. */
  const flowRows = useMemo(() => {
    const created = data?.tasksCreatedSeries ?? [];
    const completed = data?.tasksCompletedSeries ?? [];
    return created.map((point, index) => ({
      label: bucketLabel(point.t, interval),
      created: point.value,
      // The two series are built from ONE `generate_series` spine server-side,
      // so index alignment is a contract rather than a hope; `?? 0` is belt.
      completed: completed[index]?.value ?? 0,
    }));
  }, [data, interval]);

  const cycleRows = useMemo(
    () =>
      (data?.cycleTimeSeries ?? []).map((point) => ({
        label: bucketLabel(point.t, interval),
        value: point.value,
      })),
    [data, interval],
  );

  const pointRows = useMemo(
    () =>
      (data?.pointsCompletedSeries ?? []).map((point) => ({
        label: bucketLabel(point.t, interval),
        value: point.value,
      })),
    [data, interval],
  );

  const projectRows = useMemo(
    () =>
      [...(data?.byProject ?? [])]
        .sort((a, b) => b.completed - a.completed)
        .slice(0, TOP_PROJECTS)
        .map((project) => ({ label: project.projectKey, value: project.completed })),
    [data],
  );

  const created = (data?.tasksCreatedSeries ?? []).reduce((sum, p) => sum + p.value, 0);
  const completed = (data?.tasksCompletedSeries ?? []).reduce((sum, p) => sum + p.value, 0);
  const points = (data?.pointsCompletedSeries ?? []).reduce((sum, p) => sum + p.value, 0);

  const header = (
    <SectionHeader
      title={t('analytics:work.title')}
      subtitle={t('analytics:work.subtitle')}
      actions={<RangePicker value={view.range} onChange={view.setRange} testId="analytics-range" />}
    />
  );

  if (view.status === 'error') {
    return (
      <div className="flex flex-col gap-[var(--gap)]">
        {header}
        <ErrorState
          error={view.error}
          title={t('analytics:work.loadError')}
          onRetry={view.reload}
        />
      </div>
    );
  }

  const silent = data !== null && created === 0 && completed === 0 && data.byProject.length === 0;

  const intervalWord = t(INTERVAL_LABEL_KEYS[interval]);
  const percentiles = data?.cycleTimePercentiles;
  const hours = (value: number | null | undefined): string =>
    value === null || value === undefined
      ? NO_VALUE
      : `${formatDecimal(value, getIntlLocale())} ${t('analytics:units.hours')}`;

  return (
    <div className="flex flex-col gap-[var(--gap)]" data-testid="admin-analytics-work">
      {header}

      <div
        className="grid grid-cols-2 gap-[var(--gap)] xl:grid-cols-4"
        data-testid="admin-analytics-work-kpis"
      >
        {cold ? (
          Array.from({ length: 4 }, (_, index) => <KpiSkeleton key={index} />)
        ) : (
          <>
            <MetricTile
              metric="tasks-created"
              domain={DOMAIN}
              label={t('analytics:work.kpis.created')}
              value={formatCount(created)}
              caption={t('analytics:work.kpis.createdCaption')}
              delta={seriesDelta(data?.tasksCreatedSeries ?? [])}
              to={detailPath(DOMAIN, 'tasks-created')}
            />
            <MetricTile
              metric="tasks-completed"
              domain={DOMAIN}
              label={t('analytics:work.kpis.completed')}
              value={formatCount(completed)}
              caption={t('analytics:work.kpis.completedCaption')}
              delta={seriesDelta(data?.tasksCompletedSeries ?? [])}
              to={detailPath(DOMAIN, 'tasks-completed')}
            />
            <MetricTile
              metric="completion-rate"
              domain={DOMAIN}
              label={t('analytics:work.kpis.completionRate')}
              // Guarded, not because the division would throw, but because
              // `0/0 = NaN` paints as "NaN%" — and a window with no work is a
              // window with no rate, which `—` says and `0%` does not.
              value={created > 0 ? formatShare(completed / created) : NO_VALUE}
              caption={t('analytics:work.kpis.completionRateCaption')}
              to={detailPath(DOMAIN, 'tasks-completed')}
            />
            <MetricTile
              metric="points-completed"
              domain={DOMAIN}
              label={t('analytics:work.kpis.points')}
              value={formatCount(points)}
              caption={t('analytics:work.kpis.pointsCaption')}
              delta={seriesDelta(data?.pointsCompletedSeries ?? [])}
              to={detailPath(DOMAIN, 'points-completed')}
            />
          </>
        )}
      </div>

      {silent ? (
        <EmptyState
          title={t('analytics:work.empty.title')}
          message={t('analytics:work.empty.message')}
        />
      ) : (
        <div className="grid gap-[var(--gap)] xl:grid-cols-2">
          <DrillChartCard
            title={t('analytics:work.charts.flow.title')}
            info={t('analytics:work.charts.flow.subtitle', { interval: intervalWord })}
            to={detailPath(DOMAIN, 'tasks-completed')}
            testId="analytics-chart-flow"
            className="xl:col-span-2"
          >
            <MetricChart
              rows={flowRows}
              series={[
                { key: 'created', label: t('analytics:series.tasksCreated'), color: 1 },
                { key: 'completed', label: t('analytics:series.tasksCompleted'), color: 2 },
              ]}
              title={t('analytics:work.charts.flow.title')}
              height={260}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-flow-plot"
            />
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:work.charts.cycleTime.title')}
            info={t('analytics:work.charts.cycleTime.subtitle', { interval: intervalWord })}
            to={detailPath(DOMAIN, 'cycle-time')}
            testId="analytics-chart-cycle-time"
            caption={
              <p
                className="text-xs text-muted-foreground tabular-nums"
                data-testid="analytics-cycle-percentiles"
              >
                {percentiles && percentiles.p50 !== null
                  ? t('analytics:work.charts.cycleTime.percentiles', {
                      p50: hours(percentiles.p50),
                      p90: hours(percentiles.p90),
                      p95: hours(percentiles.p95),
                    })
                  : t('analytics:work.charts.cycleTime.percentilesEmpty')}
              </p>
            }
          >
            <MetricChart
              rows={cycleRows}
              series={pointSeries(
                t('analytics:series.cycleTime'),
                3,
                (value) => `${formatDecimal(value, getIntlLocale())} ${t('analytics:units.hours')}`,
              )}
              title={t('analytics:work.charts.cycleTime.title')}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-cycle-time-plot"
            />
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:work.charts.points.title')}
            info={t('analytics:work.charts.points.subtitle', { interval: intervalWord })}
            to={detailPath(DOMAIN, 'points-completed')}
            testId="analytics-chart-points"
          >
            <MetricChart
              rows={pointRows}
              series={pointSeries(t('analytics:series.points'), 4)}
              title={t('analytics:work.charts.points.title')}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-points-plot"
            />
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:work.charts.byProject.title')}
            info={t('analytics:work.charts.byProject.subtitle')}
            to={detailPath(DOMAIN, 'by-project')}
            testId="analytics-chart-by-project"
            className="xl:col-span-2"
          >
            {/* Project keys on the x-axis, not names: `FB` fits a tick and
                "FlowBoard Platform Migration" does not. The name is one click
                away in the drill-down's table. */}
            <MetricChart
              rows={projectRows}
              series={pointSeries(t('analytics:series.tasksCompleted'), 2)}
              kind="bar"
              title={t('analytics:work.charts.byProject.title')}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-by-project-plot"
            />
          </DrillChartCard>
        </div>
      )}
    </div>
  );
}
