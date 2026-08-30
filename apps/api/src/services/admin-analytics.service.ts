/**
 * The five admin analytics domains — `GET /api/admin/analytics/*`.
 *
 * ── ONE ROUND TRIP PER DOMAIN ───────────────────────────────────────────────
 * Every function below issues exactly ONE statement. A domain page is a KPI row
 * plus three to five charts, and building it out of nine queries would be nine
 * plans, nine snapshots of "now" and nine chances for two tiles on the same
 * screen to disagree. The whole payload is therefore assembled in SQL — CTEs for
 * the spine and the window, `json_agg` for the series — and the only JavaScript
 * on the hot path is the row → contract mapping. `@flowboard/shared`'s
 * `admin-analytics.schema.ts` is the normative contract; this module exists to
 * satisfy it.
 *
 * ── THE EFFECTIVE WINDOW: ONE PER REQUEST, SNAPPED OUTWARD ──────────────────
 * `?from&to&interval` are resolved once (30 days / daily by default) and then
 * SNAPPED to whole buckets:
 *
 *     w_start = date_trunc(interval, from)
 *     w_end   = date_trunc(interval, to) + 1 interval      (exclusive)
 *
 * The spine runs `w_start … w_end - 1 interval`, so a `09:30 → 11:15` hourly
 * window yields the 09:00, 10:00 and 11:00 buckets, each counting its whole
 * hour — the same rule `admin-telemetry.service.ts` documents. Clipping the edge
 * buckets to the exact instants instead produces two short bars for a reason the
 * chart cannot show, which reads as a dip that is really a rounding artefact.
 *
 * THOSE BOUNDARIES ARE UTC, and not because this file says so: `date_trunc` on a
 * `timestamptz` truncates in the SESSION's zone, and the pool pins it (see the
 * `TimeZone: 'UTC'` note in `db/client.ts`). Without that pin a daily bucket
 * would start wherever the deployment's database is configured to think a day
 * starts, while every instant in the contract stayed UTC.
 *
 * CRUCIALLY, every NON-series figure in a domain uses that SAME snapped window:
 * the percentiles, the hour histogram, the event mix, the per-project table, the
 * acceptance rate. So `sum(eventsByType)` equals the total under the engagement
 * chart, and a p95 tile can never describe a slice the chart beside it does not
 * draw. (`/overview` is the exception, and deliberately so — see below.)
 *
 * ── EMPTY BUCKETS ARE ROWS ──────────────────────────────────────────────────
 * Every series is built from a `generate_series` spine, so a quiet bucket is
 * `value: 0`, never a missing point. Recharts draws a line through whatever it
 * is given: omitting the silent days would draw a straight line across an
 * outage and make it invisible. The ceiling is {@link MAX_BUCKETS}, checked in
 * JavaScript BEFORE the query runs, because `generate_series` would happily
 * materialise a million rows first and let the failure be a timeout.
 *
 * ── WHAT "LIVE" MEANS, EVERYWHERE ───────────────────────────────────────────
 * One rule for the whole surface: **a soft-deleted organization, project or task
 * is invisible to analytics, and so is everything hanging off it.** A task
 * counts only when the task, its project AND its org are live; an invite counts
 * only when its org is live. The two append-only streams (`telemetry_events`,
 * `request_logs`) are NOT org-filtered — they are platform-level and most of
 * their rows carry no org at all.
 *
 * ── DEFINITIONS THAT ARE CHOICES, NOT FACTS ─────────────────────────────────
 * Four numbers here could reasonably be computed more than one way; each is
 * pinned at its call site and repeated in the tests as a hand-worked figure:
 *
 *  - **Stickiness** = bucket DAU ÷ trailing-30-day MAU *as of the bucket's end*,
 *    a RATIO in [0,1] (the view formats the percentage). `0`, never `NaN`, when
 *    MAU is 0 — a fresh install must draw a flat line, not an error.
 *  - **Cycle time** = `resolved_at − created_at` in hours. This is NOT the
 *    per-project report's definition (`reports.service.ts` starts the clock when
 *    a task first entered an `in_progress` column, read out of the activity
 *    stream). That walk needs the whole activity table per project and cannot be
 *    one round trip across every project in the deployment; the UNIT is shared
 *    so the tiles read alike, the definition is not. Documented, not accidental.
 *  - **An error** is `status_code >= 400` for `errorRate24h`, `errorSeries` and
 *    `errorRateSeries` — the contract says so in as many words. `topEndpoints`
 *    keeps its own 5xx-ONLY rate, because that column is reused verbatim from
 *    the ops page and the two surfaces must never disagree about one table.
 *  - **Acceptance rate** is a COHORT rate: of the invites SENT in the window,
 *    the share that have been accepted (whenever). The contract says "`0` when
 *    none were sent", which is only meaningful if the denominator is the sent
 *    cohort. It therefore does NOT equal `sum(accepted series) ÷ sum(sent
 *    series)`, which mixes two populations.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  telemetryEventTypeSchema,
  type AnalyticsEngagement,
  type AnalyticsGrowth,
  type AnalyticsInterval,
  type AnalyticsOverview,
  type AnalyticsTraffic,
  type AnalyticsWork,
  type Series,
} from '@flowboard/shared';

import {
  db,
  invites,
  orgMembers,
  organizations,
  projects,
  requestLogs,
  tasks,
  telemetryEvents,
  users,
} from '../db';
import { ApiError } from '../utils/api-error';
import { DEFAULT_TOP_ENDPOINTS_LIMIT } from '../validation/admin-telemetry.validation';
import type { AnalyticsWindowQuery } from '../validation/admin-analytics.validation';
import { resolveWindow } from './admin-telemetry.service';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** The window `?from`/`?to` fall back to. Thirty days is the range picker's default preset. */
const DEFAULT_WINDOW_DAYS = 30;

/** The bucket `?interval` falls back to. */
const DEFAULT_INTERVAL: AnalyticsInterval = 'day';

/**
 * The hard ceiling on how many points one domain may ask for.
 *
 * Lower than the ops surface's 1500: these payloads carry FIVE series plus a
 * table, and the engagement spine runs two `count(distinct …)` sub-selects per
 * bucket. 400 daily buckets is thirteen months, which is more than any preset
 * the range picker offers; anything past it is a hand-typed URL, and a 400 that
 * names the knob beats a query that times out.
 */
const MAX_BUCKETS = 400;

/** `date_trunc` unit → the matching `generate_series` step. */
const BUCKET_INTERVAL: Record<AnalyticsInterval, string> = {
  hour: '1 hour',
  day: '1 day',
  week: '1 week',
  month: '1 month',
};

/**
 * Bucket width in milliseconds — used ONLY to size a series before running it.
 *
 * A month is counted as 28 days on purpose: the figure is a guard, and the
 * shortest possible month over-estimates the bucket count, which makes the
 * refusal conservative rather than optimistic.
 */
const BUCKET_MS: Record<AnalyticsInterval, number> = {
  hour: MS_PER_HOUR,
  day: MS_PER_DAY,
  week: 7 * MS_PER_DAY,
  month: 28 * MS_PER_DAY,
};

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/** A resolved request window plus the bucket it will be sliced into. */
interface AnalyticsWindow {
  from: Date;
  to: Date;
  interval: AnalyticsInterval;
  /** The `generate_series` step, e.g. `'1 day'`. */
  step: string;
}

/**
 * `?from&to&interval` → a concrete window, defaulting to the last
 * {@link DEFAULT_WINDOW_DAYS} days in {@link DEFAULT_INTERVAL} buckets.
 *
 * The ordering check is delegated to the ops surface's {@link resolveWindow} so
 * the two families of endpoints cannot drift on what a reversed range means;
 * only the DEFAULT differs (7 days there, 30 here), which is why both edges are
 * filled in before the call. `now` is a parameter so suites can pin it.
 */
export function resolveAnalyticsWindow(
  query: AnalyticsWindowQuery,
  now: Date = new Date(),
): AnalyticsWindow {
  const to = query.to === undefined ? now : new Date(query.to);
  const from =
    query.from === undefined
      ? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY)
      : new Date(query.from);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw ApiError.badRequest('The analytics window is not a pair of instants');
  }

  const window = resolveWindow({ from: from.toISOString(), to: to.toISOString() }, now);
  const interval = query.interval ?? DEFAULT_INTERVAL;
  assertBucketCount(window, interval);

  return { from: window.from, to: window.to, interval, step: BUCKET_INTERVAL[interval] };
}

/** Refuse a window/interval pair that would produce an undrawable series. */
function assertBucketCount(window: { from: Date; to: Date }, interval: AnalyticsInterval): void {
  const span = window.to.getTime() - window.from.getTime();
  const buckets = Math.floor(span / BUCKET_MS[interval]) + 1;
  if (buckets > MAX_BUCKETS) {
    throw ApiError.badRequest(
      `That window holds more than ${String(MAX_BUCKETS)} ${interval} buckets — narrow the range or widen the interval`,
    );
  }
}

/**
 * A `Date` → the ISO string a RAW `sql` parameter must be.
 *
 * Drizzle encodes a parameter through the COLUMN it is compared against, so
 * `gte(table.createdAt, someDate)` binds correctly. A `Date` interpolated into a
 * hand-written fragment has no column to learn from, reaches postgres-js as an
 * unencoded object and fails at bind time inside `Buffer.byteLength`. Every raw
 * timestamp below goes through here and is cast with `::timestamptz` in SQL.
 */
function instant(value: Date): string {
  return value.toISOString();
}

// ---------------------------------------------------------------------------
// SQL fragments
// ---------------------------------------------------------------------------

/**
 * The `to_char` mask that renders a `timestamptz` as the contract's
 * `isoDateTime` — `2026-08-20T09:00:00.000Z`, which is what `Date#toISOString`
 * produces and therefore what a test can compare with `===`.
 */
const ISO_MASK = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/** `to_char(<expr> at time zone 'utc', …)` — a bucket start as an ISO instant. */
function isoOf(expression: string): SQL {
  return sql.raw(`to_char(${expression} at time zone 'utc', ${ISO_MASK})`);
}

/**
 * A whole gap-filled series as one `json` column: `[{ t, value }, …]`, ordered.
 *
 * `coalesce(…, '[]')` matters — `json_agg` over zero rows is `NULL`, and a spine
 * can legitimately be empty only if a window is degenerate, which must still
 * parse as an empty array rather than crash the payload.
 *
 * Both arguments are compile-time literals from this module; nothing
 * caller-supplied ever reaches `sql.raw`.
 */
function seriesJson(source: string, valueColumn: string): SQL {
  return sql.raw(
    `coalesce((select json_agg(json_build_object(` +
      `'t', to_char(ts at time zone 'utc', ${ISO_MASK}), ` +
      `'value', ${valueColumn}) order by ts) from ${source}), '[]'::json)`,
  );
}

/**
 * The `win` + `spine` CTE pair every windowed domain opens with.
 *
 * `win` is the snapped window (see the module header) and `spine` is one row per
 * bucket, running from `w_start` through `w_end - 1 step` so the last bucket is
 * `date_trunc(interval, to)`.
 */
function windowCte(window: AnalyticsWindow): SQL {
  return sql`
    win as (
      select
        date_trunc(${window.interval}, ${instant(window.from)}::timestamptz) as w_start,
        date_trunc(${window.interval}, ${instant(window.to)}::timestamptz)
          + ${window.step}::interval as w_end
    ),
    spine as (
      select generate_series(
        (select w_start from win),
        (select w_end from win) - ${window.step}::interval,
        ${window.step}::interval
      ) as ts
    )`;
}

/** Live organizations — the root of every "live" rule in this module. */
function liveOrgsCte(): SQL {
  return sql`
    live_orgs as (
      select o.id, o.name, o.slug from ${organizations} o where o.deleted_at is null
    )`;
}

/** Live projects: a live project inside a live org, carrying its org's identity. */
function liveProjectsCte(): SQL {
  return sql`
    live_projects as (
      select p.id, p.key, p.name, o.id as org_id, o.name as org_name, o.slug as org_slug
      from ${projects} p
      join live_orgs o on o.id = p.org_id
      where p.deleted_at is null
    )`;
}

/**
 * Live tasks, with the cycle-time clock already computed.
 *
 * `greatest(…, 0)` guards the one case the schema cannot: a row whose
 * `resolved_at` precedes its `created_at` (a back-dated import, a fixture) would
 * otherwise produce a negative duration and fail the contract's `nonnegative()`.
 */
function liveTasksCte(): SQL {
  return sql`
    live_tasks as (
      select
        t.project_id,
        t.created_at,
        t.resolved_at,
        t.story_points,
        greatest(extract(epoch from (t.resolved_at - t.created_at)), 0)::float8 / 3600 as cycle_hours
      from ${tasks} t
      join live_projects p on p.id = t.project_id
      where t.deleted_at is null
    )`;
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/**
 * A `json_agg`-ed series as postgres-js hands it back.
 *
 * `type`, not `interface`: `db.execute<T>` requires `T extends Record<string,
 * unknown>`, and TypeScript grants an implicit index signature to object type
 * ALIASES but never to interfaces.
 */
type SeriesJson = { t: string; value: number }[];

type OverviewRow = {
  usersTotal: number;
  usersActive30d: number;
  orgs: number;
  projects: number;
  tasksTotal: number;
  tasksCompleted30d: number;
  errorRate24h: number;
  eventsSeries: SeriesJson;
  requestsSeries: SeriesJson;
};

type EngagementRow = {
  mau: number;
  dauSeries: SeriesJson;
  signupsSeries: SeriesJson;
  stickinessSeries: SeriesJson;
  activityByHour: { hour: number; value: number }[];
  eventsByType: { type: string; count: number }[];
};

type WorkRow = {
  tasksCreatedSeries: SeriesJson;
  tasksCompletedSeries: SeriesJson;
  cycleTimeSeries: SeriesJson;
  pointsCompletedSeries: SeriesJson;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  byProject: {
    projectId: string;
    projectKey: string;
    projectName: string;
    orgId: string;
    orgName: string;
    orgSlug: string;
    created: number;
    completed: number;
    cycleTimeHours: number | null;
    points: number;
  }[];
};

type TrafficRow = {
  requestsSeries: SeriesJson;
  errorSeries: SeriesJson;
  errorRateSeries: SeriesJson;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  topEndpoints: {
    method: string;
    path: string;
    count: number;
    avgDurationMs: number;
    errorRate: number;
  }[];
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
};

type GrowthRow = {
  orgsCreatedSeries: SeriesJson;
  invitesSentSeries: SeriesJson;
  invitesAcceptedSeries: SeriesJson;
  acceptanceRate: number;
  byOrg: {
    orgId: string;
    orgName: string;
    orgSlug: string;
    memberCount: number;
    projectCount: number;
    taskCount: number;
    lastActivityAt: string | null;
  }[];
};

/**
 * The single row an aggregate-only select always yields.
 *
 * Failing loudly beats fabricating zeros: a missing row here means the statement
 * did not run the way this module thinks it did, and a payload of plausible
 * zeros would hide that behind a chart nobody questions.
 */
function firstRow<TRow>(rows: readonly TRow[]): TRow {
  const row = rows[0];
  if (row === undefined) {
    throw ApiError.internal('The analytics aggregation returned no row');
  }
  return row;
}

/** `json_agg`'s output → the contract's `Series`. */
function toSeries(rows: SeriesJson): Series {
  return rows.map((row) => ({ t: row.t, value: row.value }));
}

// ---------------------------------------------------------------------------
// 1. Overview
// ---------------------------------------------------------------------------

/**
 * `GET /api/admin/analytics/overview` — platform KPIs plus two sparklines.
 *
 * THE ONLY DOMAIN THAT IGNORES `?from&to&interval`. This page answers "is the
 * platform healthy right now", so its windows are fixed by the contract: the
 * last 14 daily event buckets, the last 24 hourly request buckets, 30 days for
 * the "active" and "completed" figures and 24 hours for the error rate. A KPI
 * sparkline that silently re-scales with a range picker is a card nobody can
 * read at a glance; the four domain pages below are where the window is the
 * instrument.
 */
export async function overview(now: Date = new Date()): Promise<AnalyticsOverview> {
  const at = instant(now);
  const since30d = instant(new Date(now.getTime() - 30 * MS_PER_DAY));
  const since24h = instant(new Date(now.getTime() - 24 * MS_PER_HOUR));

  const rows = await db.execute<OverviewRow>(sql`
    with
      day_spine as (
        select generate_series(
          date_trunc('day', ${at}::timestamptz) - interval '13 days',
          date_trunc('day', ${at}::timestamptz),
          '1 day'::interval
        ) as ts
      ),
      events_series as (
        select d.ts, count(e.id)::int as value
        from day_spine d
        left join ${telemetryEvents} e
          on e.created_at >= d.ts and e.created_at < d.ts + interval '1 day'
        group by d.ts
      ),
      hour_spine as (
        select generate_series(
          date_trunc('hour', ${at}::timestamptz) - interval '23 hours',
          date_trunc('hour', ${at}::timestamptz),
          '1 hour'::interval
        ) as ts
      ),
      requests_series as (
        select h.ts, count(r.id)::int as value
        from hour_spine h
        left join ${requestLogs} r
          on r.created_at >= h.ts and r.created_at < h.ts + interval '1 hour'
        group by h.ts
      ),
      ${liveOrgsCte()},
      ${liveProjectsCte()},
      live_tasks as (
        select t.resolved_at
        from ${tasks} t
        join live_projects p on p.id = t.project_id
        where t.deleted_at is null
      )
    select
      (select count(*)::int from ${users}) as "usersTotal",
      (
        select count(distinct e.user_id)::int
        from ${telemetryEvents} e
        where e.user_id is not null and e.created_at >= ${since30d}::timestamptz
      ) as "usersActive30d",
      (select count(*)::int from live_orgs) as "orgs",
      (select count(*)::int from live_projects) as "projects",
      (select count(*)::int from live_tasks) as "tasksTotal",
      (
        select count(*)::int from live_tasks
        where resolved_at >= ${since30d}::timestamptz
      ) as "tasksCompleted30d",
      (
        select coalesce(
          round(
            (count(*) filter (where r.status_code >= 400))::numeric / nullif(count(*), 0),
            6
          ), 0
        )::float8
        from ${requestLogs} r
        where r.created_at >= ${since24h}::timestamptz
      ) as "errorRate24h",
      ${seriesJson('events_series', 'value')} as "eventsSeries",
      ${seriesJson('requests_series', 'value')} as "requestsSeries"
  `);

  const row = firstRow(rows);
  return {
    users: { total: row.usersTotal, active30d: row.usersActive30d },
    orgs: row.orgs,
    projects: row.projects,
    tasks: { total: row.tasksTotal, completed30d: row.tasksCompleted30d },
    eventsSeries: toSeries(row.eventsSeries),
    requestsSeries: toSeries(row.requestsSeries),
    errorRate24h: row.errorRate24h,
  };
}

// ---------------------------------------------------------------------------
// 2. Engagement
// ---------------------------------------------------------------------------

/** The closed telemetry vocabulary — the only types `eventsByType` may report. */
const KNOWN_EVENT_TYPES = telemetryEventTypeSchema.options;

/**
 * `GET /api/admin/analytics/engagement` — who is here, and when.
 *
 * ── STICKINESS ──────────────────────────────────────────────────────────────
 * `DAU ÷ MAU`, where DAU is the bucket's own distinct actors and MAU is the
 * distinct actors over the THIRTY DAYS ENDING AT THAT BUCKET'S END — a trailing
 * window that moves with the spine, not one MAU for the whole request. A single
 * denominator would make the first bucket of a long window compare against
 * activity that had not happened yet. The result is a ratio in [0,1] rounded to
 * four places, and exactly `0` when MAU is 0.
 *
 * ── activityByHour ──────────────────────────────────────────────────────────
 * Twenty-four rows, always, from `generate_series(0, 23)` — the contract asserts
 * `.length(24)` because a histogram missing its quiet hours silently redraws the
 * busiest one. Hour-of-day is taken in UTC so two admins in different timezones
 * read the same chart.
 *
 * ── eventsByType ────────────────────────────────────────────────────────────
 * Constrained to the closed enum, so every row satisfies
 * `telemetryEventTypeSchema` — the column is `text` by design, and a value from
 * a rolled-back build is a real if rare possibility. Types with no events in the
 * window are OMITTED rather than zero-filled: this is a breakdown, and twelve
 * slices of which nine are zero is a legend, not a chart.
 */
export async function engagement(
  query: AnalyticsWindowQuery,
  now: Date = new Date(),
): Promise<AnalyticsEngagement> {
  const window = resolveAnalyticsWindow(query, now);
  const step = sql`${window.step}::interval`;
  const knownTypes = sql.join(
    KNOWN_EVENT_TYPES.map((type) => sql`${type}`),
    sql`, `,
  );

  const rows = await db.execute<EngagementRow>(sql`
    with
      ${windowCte(window)},
      buckets as (
        select
          s.ts,
          (
            select count(distinct e.user_id)::int
            from ${telemetryEvents} e
            where e.user_id is not null
              and e.created_at >= s.ts
              and e.created_at < s.ts + ${step}
          ) as dau,
          (
            select count(distinct e.user_id)::int
            from ${telemetryEvents} e
            where e.user_id is not null
              and e.created_at >= s.ts + ${step} - interval '30 days'
              and e.created_at < s.ts + ${step}
          ) as mau,
          (
            select count(*)::int
            from ${users} u
            where u.created_at >= s.ts and u.created_at < s.ts + ${step}
          ) as signups
        from spine s
      ),
      stickiness as (
        select
          ts,
          (case when mau = 0 then 0 else round(dau::numeric / mau::numeric, 4) end)::float8 as value
        from buckets
      ),
      hours as (
        select g.hour, coalesce(counted.value, 0)::int as value
        from generate_series(0, 23) as g(hour)
        left join (
          select
            extract(hour from (e.created_at at time zone 'utc'))::int as hour,
            count(*)::int as value
          from ${telemetryEvents} e, win
          where e.created_at >= win.w_start and e.created_at < win.w_end
          group by 1
        ) counted on counted.hour = g.hour
      ),
      event_types as (
        select e.type as type, count(*)::int as count
        from ${telemetryEvents} e, win
        where e.created_at >= win.w_start
          and e.created_at < win.w_end
          and e.type in (${knownTypes})
        group by e.type
      )
    select
      (
        select count(distinct e.user_id)::int
        from ${telemetryEvents} e, win
        where e.user_id is not null
          and e.created_at >= win.w_end - interval '30 days'
          and e.created_at < win.w_end
      ) as "mau",
      ${seriesJson('buckets', 'dau')} as "dauSeries",
      ${seriesJson('buckets', 'signups')} as "signupsSeries",
      ${seriesJson('stickiness', 'value')} as "stickinessSeries",
      coalesce((
        select json_agg(json_build_object('hour', hour, 'value', value) order by hour)
        from hours
      ), '[]'::json) as "activityByHour",
      coalesce((
        select json_agg(json_build_object('type', type, 'count', count) order by count desc, type asc)
        from event_types
      ), '[]'::json) as "eventsByType"
  `);

  const row = firstRow(rows);
  return {
    mau: row.mau,
    dauSeries: toSeries(row.dauSeries),
    signupsSeries: toSeries(row.signupsSeries),
    stickinessSeries: toSeries(row.stickinessSeries),
    activityByHour: row.activityByHour.map((bucket) => ({
      hour: bucket.hour,
      value: bucket.value,
    })),
    eventsByType: row.eventsByType.map((entry) => ({
      // The `in (…)` above already constrained the column to the enum; parsing
      // is what turns that into a TYPE rather than a promise.
      type: telemetryEventTypeSchema.parse(entry.type),
      count: entry.count,
    })),
  };
}

// ---------------------------------------------------------------------------
// 3. Work
// ---------------------------------------------------------------------------

/**
 * `GET /api/admin/analytics/work` — delivery across every project.
 *
 * `tasks.resolved_at` IS the completion clock. There is no `completed_at`
 * column: a task is resolved when it first enters a `done`-category status and
 * the stamp is cleared on reopen (see `db/schema/tasks.ts`). The contract's
 * field names — `tasksCompletedSeries`, `completed` — are the product's
 * vocabulary and stay as minted; the mapping to `resolved_at` lives here.
 *
 * ── PERCENTILES ARE `percentile_cont`, AND NULLABLE ─────────────────────────
 * Interpolated, matching the latency ladder. NULL — not 0 — when nothing
 * resolved in the window: "nothing finished" and "everything finished instantly"
 * are different answers, and a `0` on a p95 tile reads as the second. An
 * aggregate over an empty set is NULL, so the contract's nullability is the
 * query's natural result rather than a special case.
 *
 * ── byProject LISTS EVERY LIVE PROJECT ──────────────────────────────────────
 * Including the ones that did nothing this window (0 / 0 / null / 0). A table
 * whose empty rows are filtered out cannot answer "which projects have gone
 * quiet", which is most of why an admin opens it. Its counts are WINDOW-scoped
 * and its `cycleTimeHours` is the project's own MEDIAN, per the contract.
 */
export async function work(
  query: AnalyticsWindowQuery,
  now: Date = new Date(),
): Promise<AnalyticsWork> {
  const window = resolveAnalyticsWindow(query, now);
  const step = sql`${window.step}::interval`;

  const rows = await db.execute<WorkRow>(sql`
    with
      ${windowCte(window)},
      ${liveOrgsCte()},
      ${liveProjectsCte()},
      ${liveTasksCte()},
      buckets as (
        select
          s.ts,
          (
            select count(*)::int from live_tasks t
            where t.created_at >= s.ts and t.created_at < s.ts + ${step}
          ) as created,
          (
            select count(*)::int from live_tasks t
            where t.resolved_at >= s.ts and t.resolved_at < s.ts + ${step}
          ) as completed,
          (
            select coalesce(round(avg(t.cycle_hours)::numeric, 2), 0)::float8 from live_tasks t
            where t.resolved_at >= s.ts and t.resolved_at < s.ts + ${step}
          ) as cycle,
          (
            select coalesce(sum(t.story_points), 0)::float8 from live_tasks t
            where t.resolved_at >= s.ts and t.resolved_at < s.ts + ${step}
          ) as points
        from spine s
      ),
      resolved as (
        select t.cycle_hours
        from live_tasks t, win
        where t.resolved_at >= win.w_start and t.resolved_at < win.w_end
      ),
      percentiles as (
        select
          round(percentile_cont(0.5) within group (order by cycle_hours)::numeric, 2)::float8 as p50,
          round(percentile_cont(0.9) within group (order by cycle_hours)::numeric, 2)::float8 as p90,
          round(percentile_cont(0.95) within group (order by cycle_hours)::numeric, 2)::float8 as p95
        from resolved
      ),
      by_project as (
        select
          p.id as project_id,
          p.key as project_key,
          p.name as project_name,
          p.org_id as org_id,
          p.org_name as org_name,
          p.org_slug as org_slug,
          count(*) filter (
            where t.created_at >= win.w_start and t.created_at < win.w_end
          )::int as created,
          count(*) filter (
            where t.resolved_at >= win.w_start and t.resolved_at < win.w_end
          )::int as completed,
          round(
            (
              percentile_cont(0.5) within group (order by t.cycle_hours)
              filter (where t.resolved_at >= win.w_start and t.resolved_at < win.w_end)
            )::numeric, 2
          )::float8 as cycle_time_hours,
          coalesce(
            sum(t.story_points) filter (
              where t.resolved_at >= win.w_start and t.resolved_at < win.w_end
            ), 0
          )::float8 as points
        from live_projects p
        cross join win
        left join live_tasks t on t.project_id = p.id
        group by p.id, p.key, p.name, p.org_id, p.org_name, p.org_slug
      )
    select
      ${seriesJson('buckets', 'created')} as "tasksCreatedSeries",
      ${seriesJson('buckets', 'completed')} as "tasksCompletedSeries",
      ${seriesJson('buckets', 'cycle')} as "cycleTimeSeries",
      ${seriesJson('buckets', 'points')} as "pointsCompletedSeries",
      (select p50 from percentiles) as "p50",
      (select p90 from percentiles) as "p90",
      (select p95 from percentiles) as "p95",
      coalesce((
        select json_agg(
          json_build_object(
            'projectId', project_id,
            'projectKey', project_key,
            'projectName', project_name,
            'orgId', org_id,
            'orgName', org_name,
            'orgSlug', org_slug,
            'created', created,
            'completed', completed,
            'cycleTimeHours', cycle_time_hours,
            'points', points
          ) order by completed desc, created desc, project_name asc
        )
        from by_project
      ), '[]'::json) as "byProject"
  `);

  const row = firstRow(rows);
  return {
    tasksCreatedSeries: toSeries(row.tasksCreatedSeries),
    tasksCompletedSeries: toSeries(row.tasksCompletedSeries),
    cycleTimeSeries: toSeries(row.cycleTimeSeries),
    cycleTimePercentiles: { p50: row.p50, p90: row.p90, p95: row.p95 },
    pointsCompletedSeries: toSeries(row.pointsCompletedSeries),
    byProject: row.byProject.map((entry) => ({ ...entry })),
  };
}

// ---------------------------------------------------------------------------
// 4. Traffic
// ---------------------------------------------------------------------------

/**
 * `GET /api/admin/analytics/traffic` — the HTTP surface, from `request_logs`.
 *
 * `errorSeries` (the count) and `errorRateSeries` (the share) are BOTH sent
 * because they answer different questions: a spike in the count may just be a
 * traffic spike, while a spike in the rate is always a regression. Deriving one
 * from the other in the browser would mean dividing two gap-filled series and
 * inventing a `0/0` policy there.
 *
 * `topEndpoints` is RE-DERIVED here rather than fetched from
 * `adminTelemetryService.topEndpoints` — one round trip per domain is the
 * contract, and a second query would also give the table a second window. The
 * SQL is deliberately identical to the ops surface's, 5xx-only error rate
 * included, so the two views of one table can never disagree.
 *
 * The latency ladder is ONE summary for the window (the ops page owns
 * percentiles over time), and `statusBreakdown` always carries all four classes
 * so the legend never reflows between refreshes.
 */
export async function traffic(
  query: AnalyticsWindowQuery,
  now: Date = new Date(),
): Promise<AnalyticsTraffic> {
  const window = resolveAnalyticsWindow(query, now);
  const step = sql`${window.step}::interval`;

  const rows = await db.execute<TrafficRow>(sql`
    with
      ${windowCte(window)},
      buckets as (
        select
          s.ts,
          count(r.id)::int as requests,
          (count(r.id) filter (where r.status_code >= 400))::int as errors
        from spine s
        left join ${requestLogs} r
          on r.created_at >= s.ts and r.created_at < s.ts + ${step}
        group by s.ts
      ),
      rates as (
        select
          ts,
          (
            case when requests = 0 then 0
                 else round(errors::numeric / requests::numeric, 4)
            end
          )::float8 as value
        from buckets
      ),
      windowed as (
        select r.method, r.path, r.status_code, r.duration_ms
        from ${requestLogs} r, win
        where r.created_at >= win.w_start and r.created_at < win.w_end
      ),
      latency_summary as (
        select
          coalesce(round(percentile_cont(0.5)  within group (order by duration_ms)::numeric, 2), 0)::float8 as p50,
          coalesce(round(percentile_cont(0.9)  within group (order by duration_ms)::numeric, 2), 0)::float8 as p90,
          coalesce(round(percentile_cont(0.95) within group (order by duration_ms)::numeric, 2), 0)::float8 as p95,
          coalesce(round(percentile_cont(0.99) within group (order by duration_ms)::numeric, 2), 0)::float8 as p99,
          coalesce(max(duration_ms), 0)::float8 as max
        from windowed
      ),
      endpoints as (
        select
          method,
          path,
          count(*)::int as count,
          round(avg(duration_ms)::numeric, 2)::float8 as avg_duration_ms,
          round(
            (count(*) filter (where status_code >= 500))::numeric / count(*)::numeric, 4
          )::float8 as error_rate
        from windowed
        group by method, path
        order by count(*) desc, method asc, path asc
        limit ${DEFAULT_TOP_ENDPOINTS_LIMIT}
      ),
      status_classes as (
        select
          (count(*) filter (where status_code >= 200 and status_code < 300))::int as s2,
          (count(*) filter (where status_code >= 300 and status_code < 400))::int as s3,
          (count(*) filter (where status_code >= 400 and status_code < 500))::int as s4,
          (count(*) filter (where status_code >= 500))::int as s5
        from windowed
      )
    select
      ${seriesJson('buckets', 'requests')} as "requestsSeries",
      ${seriesJson('buckets', 'errors')} as "errorSeries",
      ${seriesJson('rates', 'value')} as "errorRateSeries",
      (select p50 from latency_summary) as "p50",
      (select p90 from latency_summary) as "p90",
      (select p95 from latency_summary) as "p95",
      (select p99 from latency_summary) as "p99",
      (select max from latency_summary) as "max",
      coalesce((
        select json_agg(
          json_build_object(
            'method', method,
            'path', path,
            'count', count,
            'avgDurationMs', avg_duration_ms,
            'errorRate', error_rate
          ) order by count desc, method asc, path asc
        )
        from endpoints
      ), '[]'::json) as "topEndpoints",
      (select s2 from status_classes) as "status2xx",
      (select s3 from status_classes) as "status3xx",
      (select s4 from status_classes) as "status4xx",
      (select s5 from status_classes) as "status5xx"
  `);

  const row = firstRow(rows);
  return {
    requestsSeries: toSeries(row.requestsSeries),
    errorSeries: toSeries(row.errorSeries),
    errorRateSeries: toSeries(row.errorRateSeries),
    latency: { p50: row.p50, p90: row.p90, p95: row.p95, p99: row.p99, max: row.max },
    topEndpoints: row.topEndpoints.map((entry) => ({ ...entry })),
    statusBreakdown: {
      '2xx': row.status2xx,
      '3xx': row.status3xx,
      '4xx': row.status4xx,
      '5xx': row.status5xx,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Growth
// ---------------------------------------------------------------------------

/**
 * `GET /api/admin/analytics/growth` — organizations, and how people get in.
 *
 * ── byOrg IS INVENTORY, NOT A WINDOW SLICE ──────────────────────────────────
 * Its three counts are all-time (how big is this org) and `lastActivityAt` is
 * the all-time newest telemetry event carrying the org's id, `null` for an org
 * nobody has ever touched. Window-scoping them would make "created but never
 * used" indistinguishable from "quiet since Tuesday", and the never-used row is
 * precisely what this table exists to surface. The three SERIES above it are
 * window-scoped as usual; the two live side by side because the question
 * "how fast are we adding orgs" and the question "who are they" have different
 * natural spans.
 *
 * Ordered newest-activity-first with the untouched orgs last — the reading order
 * of the question, and total (name breaks the tie) so two identical requests
 * cannot swap two rows.
 */
export async function growth(
  query: AnalyticsWindowQuery,
  now: Date = new Date(),
): Promise<AnalyticsGrowth> {
  const window = resolveAnalyticsWindow(query, now);
  const step = sql`${window.step}::interval`;

  const rows = await db.execute<GrowthRow>(sql`
    with
      ${windowCte(window)},
      ${liveOrgsCte()},
      live_invites as (
        select i.created_at, i.accepted_at
        from ${invites} i
        join live_orgs o on o.id = i.org_id
      ),
      buckets as (
        select
          s.ts,
          (
            select count(*)::int from ${organizations} o
            where o.deleted_at is null
              and o.created_at >= s.ts and o.created_at < s.ts + ${step}
          ) as orgs_created,
          (
            select count(*)::int from live_invites i
            where i.created_at >= s.ts and i.created_at < s.ts + ${step}
          ) as invites_sent,
          (
            select count(*)::int from live_invites i
            where i.accepted_at >= s.ts and i.accepted_at < s.ts + ${step}
          ) as invites_accepted
        from spine s
      ),
      by_org as (
        select
          o.id as org_id,
          o.name as org_name,
          o.slug as org_slug,
          (select count(*)::int from ${orgMembers} m where m.org_id = o.id) as member_count,
          (
            select count(*)::int from ${projects} p
            where p.org_id = o.id and p.deleted_at is null
          ) as project_count,
          (
            select count(*)::int
            from ${tasks} t
            join ${projects} p on p.id = t.project_id
            where p.org_id = o.id and p.deleted_at is null and t.deleted_at is null
          ) as task_count,
          (
            select max(e.created_at) from ${telemetryEvents} e where e.org_id = o.id
          ) as last_activity_at
        from live_orgs o
      )
    select
      ${seriesJson('buckets', 'orgs_created')} as "orgsCreatedSeries",
      ${seriesJson('buckets', 'invites_sent')} as "invitesSentSeries",
      ${seriesJson('buckets', 'invites_accepted')} as "invitesAcceptedSeries",
      (
        select coalesce(
          round(
            (count(*) filter (where i.accepted_at is not null))::numeric / nullif(count(*), 0),
            4
          ), 0
        )::float8
        from live_invites i, win
        where i.created_at >= win.w_start and i.created_at < win.w_end
      ) as "acceptanceRate",
      coalesce((
        select json_agg(
          json_build_object(
            'orgId', org_id,
            'orgName', org_name,
            'orgSlug', org_slug,
            'memberCount', member_count,
            'projectCount', project_count,
            'taskCount', task_count,
            'lastActivityAt', ${isoOf('last_activity_at')}
          ) order by last_activity_at desc nulls last, org_name asc
        )
        from by_org
      ), '[]'::json) as "byOrg"
  `);

  const row = firstRow(rows);
  return {
    orgsCreatedSeries: toSeries(row.orgsCreatedSeries),
    invitesSentSeries: toSeries(row.invitesSentSeries),
    invitesAcceptedSeries: toSeries(row.invitesAcceptedSeries),
    acceptanceRate: row.acceptanceRate,
    byOrg: row.byOrg.map((entry) => ({ ...entry })),
  };
}
