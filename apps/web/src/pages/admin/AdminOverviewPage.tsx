import { useState } from 'react';
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
import type { Series } from '@flowboard/shared';

import { OVERVIEW_REFRESH_MS, useAdminOverview } from '@/hooks/useAdminOverview';
import { PanelCard } from '@/components/dashboard/PanelCard';
import { SectionHeader } from '@/components/dashboard/SectionHeader';
import { StatTile } from '@/components/dashboard/StatTile';
import { NO_VALUE, bucketLabel, formatCount, formatShare } from '@/components/dashboard/format';
import ChartFrame from '@/components/reports/ChartFrame';
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
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

/**
 * `/admin/overview` — the admin landing page, and the first thing a global
 * admin sees. `/admin` index-redirects here.
 *
 * ═══ FIVE NUMBERS, AND EVERY ONE OF THEM IS A DOOR ═══════════════════════
 *
 * The tile IS the link (see `StatTile`): each KPI drills to the surface that
 * explains it — users to the directory, orgs to the organizations console,
 * projects to the cross-org overview, tasks to work analytics, error rate to
 * traffic. A landing page whose numbers are read-only makes the reader go find
 * the nav; a landing page of links makes the number the navigation.
 *
 * ═══ ONE REQUEST, NO RANGE PICKER ════════════════════════════════════════
 *
 * `GET /admin/analytics/overview` answers the whole page in one round trip, and
 * its two series are fixed at 14 daily and 24 hourly buckets on purpose. This
 * screen answers "is the platform healthy right now"; a sparkline that silently
 * rescales with a range control is one nobody can read at a glance. The four
 * DRILLABLE domains are where the window is the instrument.
 *
 * ═══ COLD VERSUS WARM ════════════════════════════════════════════════════
 *
 * The skeleton ladder is only ever shown on a genuinely cold load. A refresh —
 * manual or from the 30-second switch — keeps the previous payload on screen
 * (`placeholderData` in the hook) because a KPI grid that blinks back to grey
 * every half minute is unreadable, and the numbers it replaced were not wrong.
 *
 * ═══ AUTO-REFRESH IS OPT-IN ══════════════════════════════════════════════
 *
 * Off by default. Polling a dashboard by default is a background load on every
 * deployment for a page that is usually open because somebody is reading it
 * once.
 */

/** Chart body height. Two sparkline-scale panels, side by side on desktop. */
const CHART_HEIGHT = 200;

export default function AdminOverviewPage() {
  const { t } = useTranslation(['admin', 'common']);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const query = useAdminOverview(autoRefresh ? OVERVIEW_REFRESH_MS : undefined);
  const data = query.data;

  // COLD, not "pending". `isPending` is false the moment placeholder data is
  // served, so this is the honest test for "there has never been a payload".
  const cold = data === undefined;
  const retry = () => {
    void query.refetch();
  };

  return (
    <section className="flex flex-col gap-[var(--gap)]">
      <SectionHeader
        title={t('admin:platform.title')}
        subtitle={t('admin:platform.description')}
        actions={
          <div className="flex items-center gap-2">
            <Switch
              id="admin-overview-autorefresh"
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
              aria-label={t('admin:platform.autoRefreshLabel')}
              data-testid="overview-auto-refresh"
            />
            <Label htmlFor="admin-overview-autorefresh" className="text-xs text-muted-foreground">
              {t('admin:platform.autoRefresh')}
            </Label>
          </div>
        }
      />

      {/* The KPI row. Five tiles, each its own labelled region — see `StatTile`
          for why a dozen headings would be worse than one region apiece. */}
      <div className="grid gap-[var(--gap)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiTile
          id="users"
          cold={cold}
          error={query.error}
          label={t('admin:platform.kpi.users')}
          value={data ? formatCount(data.users.total) : ''}
          caption={
            data
              ? t('admin:platform.kpi.usersCaption', {
                  active: formatCount(data.users.active30d),
                })
              : ''
          }
          to="/admin/users"
          linkLabel={t('admin:platform.kpi.usersLink')}
        />
        <KpiTile
          id="orgs"
          cold={cold}
          error={query.error}
          label={t('admin:platform.kpi.orgs')}
          value={data ? formatCount(data.orgs) : ''}
          caption={t('admin:platform.kpi.orgsCaption')}
          to="/admin/orgs"
          linkLabel={t('admin:platform.kpi.orgsLink')}
        />
        <KpiTile
          id="projects"
          cold={cold}
          error={query.error}
          label={t('admin:platform.kpi.projects')}
          value={data ? formatCount(data.projects) : ''}
          caption={t('admin:platform.kpi.projectsCaption')}
          to="/admin/projects"
          linkLabel={t('admin:platform.kpi.projectsLink')}
        />
        <KpiTile
          id="tasks"
          cold={cold}
          error={query.error}
          label={t('admin:platform.kpi.tasks')}
          value={data ? formatCount(data.tasks.total) : ''}
          caption={
            data
              ? t('admin:platform.kpi.tasksCaption', {
                  completed: formatCount(data.tasks.completed30d),
                })
              : ''
          }
          to="/admin/analytics/work"
          linkLabel={t('admin:platform.kpi.tasksLink')}
        />
        <KpiTile
          id="error-rate"
          cold={cold}
          error={query.error}
          label={t('admin:platform.kpi.errorRate')}
          // A 0–1 SHARE, not a percent level: `formatShare` is the one that
          // multiplies. Reaching for `formatPercent` here is the "the error
          // rate says 0%" bug.
          value={data ? formatShare(data.errorRate24h, 1) : ''}
          caption={t('admin:platform.kpi.errorRateCaption')}
          to="/admin/analytics/traffic"
          linkLabel={t('admin:platform.kpi.errorRateLink')}
        />
      </div>

      <div className="grid gap-[var(--gap)] lg:grid-cols-2">
        <PanelCard
          title={t('admin:platform.events.title')}
          info={t('admin:platform.events.info')}
          testId="overview-events-panel"
          error={query.error}
          onRetry={retry}
          isPending={cold && query.isFetching}
          isEmpty={data !== undefined && !hasSignal(data.eventsSeries)}
          emptyTitle={t('admin:platform.events.empty')}
          emptyMessage={t('admin:platform.events.emptyBody')}
          skeleton={{ kind: 'chart', height: CHART_HEIGHT }}
          caption={
            <ChartLegend
              entries={[{ label: t('admin:platform.events.series'), color: CHART_SERIES.primary }]}
            />
          }
          bodyClassName="h-[200px]"
        >
          <TrendChart
            series={data?.eventsSeries ?? []}
            interval="day"
            seriesLabel={t('admin:platform.events.series')}
            summary={t('admin:platform.events.summary', {
              events: formatCount(total(data?.eventsSeries)),
              peak: formatCount(peak(data?.eventsSeries)),
            })}
          />
        </PanelCard>

        <PanelCard
          title={t('admin:platform.requests.title')}
          info={t('admin:platform.requests.info')}
          testId="overview-requests-panel"
          error={query.error}
          onRetry={retry}
          isPending={cold && query.isFetching}
          isEmpty={data !== undefined && !hasSignal(data.requestsSeries)}
          emptyTitle={t('admin:platform.requests.empty')}
          emptyMessage={t('admin:platform.requests.emptyBody')}
          skeleton={{ kind: 'chart', height: CHART_HEIGHT }}
          caption={
            <ChartLegend
              entries={[
                { label: t('admin:platform.requests.series'), color: CHART_SERIES.delivered },
              ]}
            />
          }
          bodyClassName="h-[200px]"
        >
          <TrendChart
            series={data?.requestsSeries ?? []}
            interval="hour"
            color={CHART_SERIES.delivered}
            seriesLabel={t('admin:platform.requests.series')}
            summary={t('admin:platform.requests.summary', {
              requests: formatCount(total(data?.requestsSeries)),
              peak: formatCount(peak(data?.requestsSeries)),
            })}
          />
        </PanelCard>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Series helpers                                                      */
/* ------------------------------------------------------------------ */

function total(series: Series | undefined): number {
  return (series ?? []).reduce((sum, point) => sum + point.value, 0);
}

function peak(series: Series | undefined): number {
  return (series ?? []).reduce((highest, point) => Math.max(highest, point.value), 0);
}

/**
 * "Is there anything to draw?" — a gap-filled series of zeros is EMPTY.
 *
 * The API never omits a quiet bucket, so `series.length > 0` is true even on a
 * brand-new install. Drawing a flat line along the baseline and calling it a
 * chart is how a dashboard tells an operator nothing while looking like it told
 * them something.
 */
function hasSignal(series: Series): boolean {
  return series.some((point) => point.value !== 0);
}

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

/**
 * One KPI, with the two states a tile can be in before it has a number.
 *
 * The tile does NOT get its own error state: a failure here is the page's
 * failure — one request feeds all five — and five identical retry buttons in a
 * row is worse than one dash per tile plus the two panels' error frames below.
 * A cold tile draws its own skeleton so the grid does not reflow when the
 * numbers land.
 */
function KpiTile({
  id,
  cold,
  error,
  label,
  value,
  caption,
  to,
  linkLabel,
}: {
  id: string;
  cold: boolean;
  error: unknown;
  label: string;
  value: string;
  caption: string;
  to: string;
  linkLabel: string;
}) {
  const pending = cold && error === null;

  return (
    <StatTile
      id={id}
      label={label}
      value={
        pending ? (
          <Skeleton className="h-6 w-16" />
        ) : (
          // `NO_VALUE` rather than a blank: a tile that failed still has to say
          // that it has no number, or it reads as a zero somebody forgot to
          // format.
          value || NO_VALUE
        )
      }
      caption={pending ? undefined : caption}
      to={to}
      linkLabel={linkLabel}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

/**
 * One gap-filled series as a filled area.
 *
 * Filled rather than a bare line because both series are VOLUMES — quantities
 * that accumulate under the curve — which is the same distinction the telemetry
 * dashboard draws between its request volume (area) and its latency levels
 * (lines). Every visual decision here is `chart-theme`'s; this file makes none.
 *
 * `isAnimationActive={false}`: these two panels re-render on every 30-second
 * refresh, and a chart that replays its entry animation each time reads as a
 * page reloading itself. (W2.4 owns the reduced-motion story for charts that
 * animate on cold load.)
 */
function TrendChart({
  series,
  interval,
  seriesLabel,
  summary,
  color = CHART_SERIES.primary,
}: {
  series: Series;
  interval: 'hour' | 'day';
  seriesLabel: string;
  summary: string;
  color?: string;
}) {
  return (
    <ChartFrame summary={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...series]} margin={{ ...PLOT_MARGIN }}>
          <CartesianGrid stroke={CHART_CHROME.grid} strokeDasharray={DASH.grid} vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={(value: string) => bucketLabel(value, interval)}
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
            tickFormatter={(value: number) => formatCount(value, true)}
          />
          <Tooltip
            cursor={{ stroke: CHART_CHROME.grid }}
            content={(props) => (
              <ChartTooltipContent
                {...props}
                labels={{ value: seriesLabel }}
                formatHeading={(value: string) => bucketLabel(value, interval)}
                formatValue={(value: number) => formatCount(value)}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={STROKE.data}
            fill={color}
            fillOpacity={AREA_FILL_OPACITY}
            dot={false}
            activeDot={{ r: 3, fill: color }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
