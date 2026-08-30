import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnalyticsGrowthOrgRow } from '@flowboard/shared';

import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { SectionHeader } from '@/components/dashboard/SectionHeader';
import { RangePicker } from '@/components/dashboard/RangePicker';
import { DataTable, col } from '@/components/dashboard/DataTable';
import {
  bucketLabel,
  formatCount,
  formatInstant,
  formatShare,
  NO_VALUE,
} from '@/components/dashboard/format';
import { seriesDelta } from '@/components/dashboard/series-delta';
import DrillChartCard from '@/components/admin/analytics/DrillChartCard';
import MetricChart, { pointSeries } from '@/components/admin/analytics/MetricChart';
import MetricTile, { KpiSkeleton } from '@/components/admin/analytics/MetricTile';
import { detailPath, INTERVAL_LABEL_KEYS } from '@/components/admin/analytics/metric-registry';
import { useAnalyticsDomain } from '@/hooks/useAnalytics';

/**
 * Admin → Analytics → Growth (`/admin/analytics/growth`).
 *
 * Organizations, and how people get into them — the multi-org admin's "is this
 * deployment growing, and who is actually using it" page.
 *
 * ── THE ONE PLACE THE WINDOW DOES NOT APPLY ─────────────────────────────────
 * `byOrg` is ALL-TIME INVENTORY, not a windowed series: it is every
 * organization that exists, with its member/project/task counts and its last
 * activity. That is deliberate and it is why this dashboard is almost never
 * `silent` — an install with one org and no invites still has a row to show,
 * and hiding it behind "nothing happened in the last 30 days" would answer a
 * question nobody asked. The card's own subtitle says so out loud, because a
 * table that ignores the range picker above it owes the reader an explanation.
 *
 * ── SENT AND ACCEPTED SHARE A CHART ─────────────────────────────────────────
 * Same reasoning as Work's created-vs-completed: the interesting quantity is
 * the gap. Two separate cards at two scales hide exactly the thing an
 * acceptance rate is asked about.
 *
 * ── `lastActivityAt` IS NULLABLE, AND THAT ROW IS THE POINT ─────────────────
 * An org created and never touched is precisely what this table exists to
 * surface, so `null` renders as `—` and sorts LAST in both directions rather
 * than being filtered out or pretending to be the epoch.
 */

const DOMAIN = 'growth' as const;

export default function AnalyticsGrowthPage() {
  const { t } = useTranslation(['analytics']);
  const view = useAnalyticsDomain(DOMAIN);
  const { data, cold, interval } = view;

  const orgRows = useMemo(
    () =>
      (data?.orgsCreatedSeries ?? []).map((point) => ({
        label: bucketLabel(point.t, interval),
        value: point.value,
      })),
    [data, interval],
  );

  const inviteRows = useMemo(() => {
    const sent = data?.invitesSentSeries ?? [];
    const accepted = data?.invitesAcceptedSeries ?? [];
    return sent.map((point, index) => ({
      label: bucketLabel(point.t, interval),
      sent: point.value,
      accepted: accepted[index]?.value ?? 0,
    }));
  }, [data, interval]);

  const orgColumns = useMemo(
    () => [
      col<AnalyticsGrowthOrgRow>({
        id: 'orgName',
        header: t('analytics:columns.org'),
        accessor: (row) => row.orgName,
        enableHiding: false,
        cell: (row) => row.orgName,
      }),
      col<AnalyticsGrowthOrgRow>({
        id: 'orgSlug',
        header: t('analytics:columns.orgSlug'),
        accessor: (row) => row.orgSlug,
        // A slug is machine text: lowercase ASCII that must not reorder in RTL.
        cell: (row) => (
          <span dir="ltr" className="font-mono text-xs">
            {row.orgSlug}
          </span>
        ),
      }),
      col<AnalyticsGrowthOrgRow>({
        id: 'memberCount',
        header: t('analytics:columns.members'),
        align: 'end',
        accessor: (row) => row.memberCount,
        cell: (row) => formatCount(row.memberCount),
      }),
      col<AnalyticsGrowthOrgRow>({
        id: 'projectCount',
        header: t('analytics:columns.projects'),
        align: 'end',
        accessor: (row) => row.projectCount,
        cell: (row) => formatCount(row.projectCount),
      }),
      col<AnalyticsGrowthOrgRow>({
        id: 'taskCount',
        header: t('analytics:columns.tasks'),
        align: 'end',
        accessor: (row) => row.taskCount,
        cell: (row) => formatCount(row.taskCount),
      }),
      col<AnalyticsGrowthOrgRow>({
        id: 'lastActivityAt',
        header: t('analytics:columns.lastActivity'),
        // `null`, not `''`: `compareValues` sinks nullish in BOTH directions,
        // which is the honest place for "never touched".
        accessor: (row) => row.lastActivityAt,
        cell: (row) => (row.lastActivityAt === null ? NO_VALUE : formatInstant(row.lastActivityAt)),
      }),
    ],
    [t],
  );

  const orgsCreated = (data?.orgsCreatedSeries ?? []).reduce((sum, p) => sum + p.value, 0);
  const invitesSent = (data?.invitesSentSeries ?? []).reduce((sum, p) => sum + p.value, 0);
  const invitesAccepted = (data?.invitesAcceptedSeries ?? []).reduce((sum, p) => sum + p.value, 0);

  const header = (
    <SectionHeader
      title={t('analytics:growth.title')}
      subtitle={t('analytics:growth.subtitle')}
      actions={<RangePicker value={view.range} onChange={view.setRange} testId="analytics-range" />}
    />
  );

  if (view.status === 'error') {
    return (
      <div className="flex flex-col gap-[var(--gap)]">
        {header}
        <ErrorState
          error={view.error}
          title={t('analytics:growth.loadError')}
          onRetry={view.reload}
        />
      </div>
    );
  }

  // `byOrg` is all-time, so a deployment with any organization at all is never
  // silent — which is correct: there is a table worth reading.
  const silent =
    data !== null &&
    orgsCreated === 0 &&
    invitesSent === 0 &&
    invitesAccepted === 0 &&
    data.byOrg.length === 0;

  const intervalWord = t(INTERVAL_LABEL_KEYS[interval]);

  return (
    <div className="flex flex-col gap-[var(--gap)]" data-testid="admin-analytics-growth">
      {header}

      <div
        className="grid grid-cols-2 gap-[var(--gap)] xl:grid-cols-4"
        data-testid="admin-analytics-growth-kpis"
      >
        {cold ? (
          Array.from({ length: 4 }, (_, index) => <KpiSkeleton key={index} />)
        ) : (
          <>
            <MetricTile
              metric="orgs-created"
              domain={DOMAIN}
              label={t('analytics:growth.kpis.orgs')}
              value={formatCount(orgsCreated)}
              caption={t('analytics:growth.kpis.orgsCaption')}
              delta={seriesDelta(data?.orgsCreatedSeries ?? [])}
              to={detailPath(DOMAIN, 'orgs-created')}
            />
            <MetricTile
              metric="invites-sent"
              domain={DOMAIN}
              label={t('analytics:growth.kpis.invitesSent')}
              value={formatCount(invitesSent)}
              caption={t('analytics:growth.kpis.invitesSentCaption')}
              delta={seriesDelta(data?.invitesSentSeries ?? [])}
              to={detailPath(DOMAIN, 'invites-sent')}
            />
            <MetricTile
              metric="invites-accepted"
              domain={DOMAIN}
              label={t('analytics:growth.kpis.invitesAccepted')}
              value={formatCount(invitesAccepted)}
              caption={t('analytics:growth.kpis.invitesAcceptedCaption')}
              delta={seriesDelta(data?.invitesAcceptedSeries ?? [])}
              to={detailPath(DOMAIN, 'invites-accepted')}
            />
            <MetricTile
              metric="acceptance-rate"
              domain={DOMAIN}
              label={t('analytics:growth.kpis.acceptanceRate')}
              // The API's own scalar, not accepted ÷ sent recomputed here: the
              // server defines it as `0` when nothing was sent, and two
              // definitions of one rate is one definition too many.
              value={data ? formatShare(data.acceptanceRate) : NO_VALUE}
              caption={t('analytics:growth.kpis.acceptanceRateCaption')}
              to={detailPath(DOMAIN, 'invites-accepted')}
            />
          </>
        )}
      </div>

      {silent ? (
        <EmptyState
          title={t('analytics:growth.empty.title')}
          message={t('analytics:growth.empty.message')}
        />
      ) : (
        <div className="grid gap-[var(--gap)] xl:grid-cols-2">
          <DrillChartCard
            title={t('analytics:growth.charts.invites.title')}
            info={t('analytics:growth.charts.invites.subtitle', { interval: intervalWord })}
            to={detailPath(DOMAIN, 'invites-sent')}
            testId="analytics-chart-invites"
            className="xl:col-span-2"
          >
            <MetricChart
              rows={inviteRows}
              series={[
                { key: 'sent', label: t('analytics:series.invitesSent'), color: 4 },
                { key: 'accepted', label: t('analytics:series.invitesAccepted'), color: 2 },
              ]}
              title={t('analytics:growth.charts.invites.title')}
              height={260}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-invites-plot"
            />
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:growth.charts.orgs.title')}
            info={t('analytics:growth.charts.orgs.subtitle', { interval: intervalWord })}
            to={detailPath(DOMAIN, 'orgs-created')}
            testId="analytics-chart-orgs-created"
            className="xl:col-span-2"
          >
            <MetricChart
              rows={orgRows}
              series={pointSeries(t('analytics:series.orgs'), 1)}
              title={t('analytics:growth.charts.orgs.title')}
              loading={cold}
              emptyTitle={t('analytics:chart.empty.title')}
              emptyMessage={t('analytics:chart.empty.message')}
              testId="analytics-chart-orgs-created-plot"
            />
          </DrillChartCard>

          <DrillChartCard
            title={t('analytics:growth.charts.byOrg.title')}
            info={t('analytics:growth.charts.byOrg.subtitle')}
            to={detailPath(DOMAIN, 'by-org')}
            testId="analytics-chart-by-org"
            className="xl:col-span-2"
          >
            <DataTable
              aria-label={t('analytics:growth.charts.byOrg.aria')}
              columns={orgColumns}
              rows={data?.byOrg ?? []}
              rowKey={(row) => row.orgId}
              loading={cold}
              emptyMessage={t('analytics:growth.empty.message')}
              enableColumnReorder={false}
            />
          </DrillChartCard>
        </div>
      )}
    </div>
  );
}
