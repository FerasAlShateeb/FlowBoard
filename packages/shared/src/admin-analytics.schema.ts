// Admin analytics contracts — the five payloads behind
// `GET /api/admin/analytics/{overview,engagement,work,traffic,growth}`.
//
// ONE ROUND TRIP PER DOMAIN. Each page is a KPI row plus three to five charts;
// building one screen out of nine parallel requests is the mistake the existing
// `/admin/telemetry/*` surface already regrets (five endpoints, five spinners,
// five ranges that can disagree). A domain payload is one query plan, one
// window, one loading state.
//
// EVERY SERIES IS GAP-FILLED SERVER-SIDE. A bucket with no activity is present
// with `value: 0`, never omitted, so no client ever reconstructs an x-axis from
// sparse points — a chart that silently drops its empty days redraws the shape
// of the data. The server builds each spine with `generate_series` and caps the
// bucket count; see `services/admin-analytics.service.ts`.
//
// WHAT IS REUSED RATHER THAN RE-MINTED. `topEndpointSchema` comes from
// `telemetry.schema.ts` verbatim: the Traffic dashboard and the ops pages must
// never disagree about the shape of "slowest endpoints". `telemetryEventTypeSchema`
// likewise types the events-by-type breakdown, which keeps the analytics page's
// labels and the events feed's filter chips on one closed vocabulary.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { isoDateTime, slugSchema, uuid } from './common';
import { projectKeySchema } from './projects.schema';
import { telemetryEventTypeSchema, topEndpointSchema } from './telemetry.schema';
import { nameSchema } from './users.schema';

/**
 * The four DRILLABLE analytics domains — the `:domain` segment of
 * `/admin/analytics/:domain/:metric`.
 *
 * `overview` is deliberately absent: it is the admin landing page, not a
 * domain with a metric registry behind it, and letting `/admin/analytics/overview/x`
 * resolve would promise a drill-down that has no metrics to reach. The web
 * parses the route param against this enum and renders a friendly not-found
 * card for anything else, rather than a blank page.
 */
export const analyticsDomainSchema = z.enum(['engagement', 'work', 'traffic', 'growth']);
export type AnalyticsDomain = z.infer<typeof analyticsDomainSchema>;

/**
 * Bucket granularity. Chosen CLIENT-side from the span (see `windowFor` /
 * `intervalForSpan` in the web's analytics store) so a 24-hour window is hourly
 * and a 12-month window is monthly, and re-validated here so a hand-typed
 * `?interval=second` is a 422 rather than a query that returns 2.6 million rows.
 */
export const analyticsIntervalSchema = z.enum(['hour', 'day', 'week', 'month']);
export type AnalyticsInterval = z.infer<typeof analyticsIntervalSchema>;

/**
 * `?from=&to=&interval=` — the window EVERY analytics endpoint accepts.
 *
 * All three are optional and defaulted SERVER-side (30 days, daily), so a
 * caller that passes nothing still gets a sensible dashboard; the five domains
 * share one schema so their windows can never drift apart. `from`/`to` are full
 * instants rather than calendar days, matching `telemetryRangeQuerySchema` —
 * an hourly window is a real range this product renders.
 */
export const analyticsWindowQuerySchema = z.object({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  interval: analyticsIntervalSchema.optional(),
});
export type AnalyticsWindowQuery = z.infer<typeof analyticsWindowQuerySchema>;

/**
 * One point of a gap-filled series: `t` is the bucket's START instant (UTC),
 * `value` the measure.
 *
 * `value` is a plain `z.number()`, not an integer: the same point shape carries
 * counts (tasks created), ratios (stickiness, error rate) and durations
 * (average cycle time in hours). One shape means one `MetricChart`, one CSV
 * exporter and one delta helper for every metric in the registry.
 */
export const seriesPointSchema = z.object({
  t: isoDateTime,
  value: z.number(),
});
export type SeriesPoint = z.infer<typeof seriesPointSchema>;

/** A gap-filled series. Always ordered by `t`, ascending. */
export const seriesSchema = z.array(seriesPointSchema);
export type Series = z.infer<typeof seriesSchema>;

/** A whole, non-negative tally — every count in this module. */
const tally = z.number().int().nonnegative();
/** A fraction of one — an error rate, an acceptance rate, stickiness. */
const fraction = z.number().min(0).max(1);

// ---------------------------------------------------------------------------
// Overview — the admin landing page.
// ---------------------------------------------------------------------------

/** Accounts: everything ever provisioned, and who actually showed up. */
export const analyticsOverviewUsersSchema = z.object({
  total: tally,
  /** Distinct users with any telemetry event in the trailing 30 days. */
  active30d: tally,
});
export type AnalyticsOverviewUsers = z.infer<typeof analyticsOverviewUsersSchema>;

/** Work: the backlog's size, and how much of it moved recently. */
export const analyticsOverviewTasksSchema = z.object({
  total: tally,
  completed30d: tally,
});
export type AnalyticsOverviewTasks = z.infer<typeof analyticsOverviewTasksSchema>;

/**
 * `GET /api/admin/analytics/overview` — platform KPIs plus two fixed-window
 * sparklines.
 *
 * THE TWO SERIES IGNORE `?from&to` ON PURPOSE. `eventsSeries` is always the
 * last 14 daily buckets and `requestsSeries` always the last 24 hourly ones,
 * because this page answers "is the platform healthy right now", and a KPI card
 * whose sparkline silently re-scales with a range picker is a card nobody can
 * read at a glance. The domain pages below are where the window is the
 * instrument.
 */
export const analyticsOverviewSchema = z.object({
  users: analyticsOverviewUsersSchema,
  orgs: tally,
  projects: tally,
  tasks: analyticsOverviewTasksSchema,
  /** Telemetry events per day, 14 buckets. */
  eventsSeries: seriesSchema,
  /** HTTP requests per hour, 24 buckets. */
  requestsSeries: seriesSchema,
  /** (4xx + 5xx) ÷ requests over the trailing 24 hours; `0` on an idle install. */
  errorRate24h: fraction,
});
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

// ---------------------------------------------------------------------------
// Engagement — who is here, and when.
// ---------------------------------------------------------------------------

/**
 * Activity by UTC hour-of-day: EXACTLY 24 entries, `hour` 0–23, in order.
 *
 * `.length(24)` is a real assertion, not decoration — a histogram missing its
 * quiet hours silently redraws the busiest window, so the server gap-fills and
 * the contract enforces it. UTC for the same reason every other boundary here
 * is UTC: two admins in different timezones must read the same chart.
 */
export const analyticsHourBucketSchema = z.object({
  hour: z.number().int().min(0).max(23),
  value: tally,
});
export type AnalyticsHourBucket = z.infer<typeof analyticsHourBucketSchema>;

export const analyticsActivityByHourSchema = z.array(analyticsHourBucketSchema).length(24);
export type AnalyticsActivityByHour = z.infer<typeof analyticsActivityByHourSchema>;

/** One slice of the event-mix breakdown. Types come from the closed telemetry
 *  vocabulary, so the chart's labels are the feed's filter chips. */
export const analyticsEventTypeRowSchema = z.object({
  type: telemetryEventTypeSchema,
  count: tally,
});
export type AnalyticsEventTypeRow = z.infer<typeof analyticsEventTypeRowSchema>;

/**
 * `GET /api/admin/analytics/engagement`.
 *
 * `stickinessSeries` is DAU ÷ MAU per bucket, the conventional ratio; it is `0`
 * (never `NaN`) when MAU is 0, because a fresh install must render a flat line
 * rather than an error. `mau` is the scalar for the window's end, which is what
 * the KPI tile shows.
 */
export const analyticsEngagementSchema = z.object({
  mau: tally,
  dauSeries: seriesSchema,
  signupsSeries: seriesSchema,
  stickinessSeries: seriesSchema,
  activityByHour: analyticsActivityByHourSchema,
  eventsByType: z.array(analyticsEventTypeRowSchema),
});
export type AnalyticsEngagement = z.infer<typeof analyticsEngagementSchema>;

// ---------------------------------------------------------------------------
// Work — delivery across every project in the deployment.
// ---------------------------------------------------------------------------

/**
 * Cycle-time percentiles over the window, in HOURS — the same unit as
 * `cycleTimeReportSchema` in `reports.schema.ts`, so the platform figure and a
 * project's own report are directly comparable.
 *
 * Nullable, not zero: "nothing resolved in this window" and "everything resolved
 * instantly" are different answers, and a `0` on a p95 tile reads as the second.
 */
export const analyticsCycleTimePercentilesSchema = z.object({
  p50: z.number().nonnegative().nullable(),
  p90: z.number().nonnegative().nullable(),
  p95: z.number().nonnegative().nullable(),
});
export type AnalyticsCycleTimePercentiles = z.infer<typeof analyticsCycleTimePercentilesSchema>;

/**
 * One row of the per-project delivery table.
 *
 * It carries `projectKey` and `orgSlug` as well as the ids because the table is
 * a jumping-off point: every row links to `/o/:orgSlug/p/:projectKey/board`,
 * and a client that had only ids would need two more list queries to build one
 * href.
 */
export const analyticsWorkProjectRowSchema = z.object({
  projectId: uuid,
  projectKey: projectKeySchema,
  projectName: nameSchema,
  orgId: uuid,
  orgName: nameSchema,
  orgSlug: slugSchema,
  created: tally,
  completed: tally,
  /** Median cycle time for this project's window, in hours; `null` if nothing resolved. */
  cycleTimeHours: z.number().nonnegative().nullable(),
  /** Story points completed. Fractional points are legal, so not an integer. */
  points: z.number().nonnegative(),
});
export type AnalyticsWorkProjectRow = z.infer<typeof analyticsWorkProjectRowSchema>;

/** `GET /api/admin/analytics/work`. `cycleTimeSeries` is the AVERAGE resolved
 *  cycle time per bucket, in hours — not a count, and therefore not summable. */
export const analyticsWorkSchema = z.object({
  tasksCreatedSeries: seriesSchema,
  tasksCompletedSeries: seriesSchema,
  cycleTimeSeries: seriesSchema,
  cycleTimePercentiles: analyticsCycleTimePercentilesSchema,
  pointsCompletedSeries: seriesSchema,
  byProject: z.array(analyticsWorkProjectRowSchema),
});
export type AnalyticsWork = z.infer<typeof analyticsWorkSchema>;

// ---------------------------------------------------------------------------
// Traffic — the HTTP surface, from `request_logs`.
// ---------------------------------------------------------------------------

/**
 * Latency percentiles over the whole window, in milliseconds.
 *
 * The same ladder as `latencyBucketSchema` minus its per-bucket `ts`/`count`:
 * this is one summary for the window, and the ladder is rendered UNSORTED by
 * design — p50 → max is the reading order, and letting a table sort it by value
 * would destroy the only thing the ladder communicates.
 */
export const analyticsLatencySchema = z.object({
  p50: z.number().nonnegative(),
  p90: z.number().nonnegative(),
  p95: z.number().nonnegative(),
  p99: z.number().nonnegative(),
  max: z.number().nonnegative(),
});
export type AnalyticsLatency = z.infer<typeof analyticsLatencySchema>;

/** Requests per status class in the window. All four classes are always present
 *  (zero-filled), so the legend never reflows between refreshes. */
export const analyticsStatusBreakdownSchema = z.object({
  '2xx': tally,
  '3xx': tally,
  '4xx': tally,
  '5xx': tally,
});
export type AnalyticsStatusBreakdown = z.infer<typeof analyticsStatusBreakdownSchema>;

/**
 * `GET /api/admin/analytics/traffic`.
 *
 * `errorSeries` (4xx + 5xx per bucket) and `errorRateSeries` (that over the
 * bucket's request count) are BOTH sent, because they answer different
 * questions: a spike in the count may just be a traffic spike, while a spike in
 * the rate is always a regression. Deriving one from the other client-side
 * would mean dividing two gap-filled series and inventing a `0/0` policy in the
 * browser.
 */
export const analyticsTrafficSchema = z.object({
  requestsSeries: seriesSchema,
  errorSeries: seriesSchema,
  errorRateSeries: seriesSchema,
  latency: analyticsLatencySchema,
  topEndpoints: z.array(topEndpointSchema),
  statusBreakdown: analyticsStatusBreakdownSchema,
});
export type AnalyticsTraffic = z.infer<typeof analyticsTrafficSchema>;

// ---------------------------------------------------------------------------
// Growth — organizations, and how people get into them.
// ---------------------------------------------------------------------------

/**
 * One row of the per-organization table: the multi-org admin's "who is actually
 * using this deployment" answer.
 *
 * `lastActivityAt` is the most recent telemetry event in the org, `null` for an
 * org that has been created but never touched — which is precisely the row this
 * table exists to surface, so it must be representable rather than filtered out.
 */
export const analyticsGrowthOrgRowSchema = z.object({
  orgId: uuid,
  orgName: nameSchema,
  orgSlug: slugSchema,
  memberCount: tally,
  projectCount: tally,
  taskCount: tally,
  lastActivityAt: isoDateTime.nullable(),
});
export type AnalyticsGrowthOrgRow = z.infer<typeof analyticsGrowthOrgRowSchema>;

/** `GET /api/admin/analytics/growth`. `acceptanceRate` is accepted ÷ sent over
 *  the window, `0` when none were sent. */
export const analyticsGrowthSchema = z.object({
  orgsCreatedSeries: seriesSchema,
  invitesSentSeries: seriesSchema,
  invitesAcceptedSeries: seriesSchema,
  acceptanceRate: fraction,
  byOrg: z.array(analyticsGrowthOrgRowSchema),
});
export type AnalyticsGrowth = z.infer<typeof analyticsGrowthSchema>;
