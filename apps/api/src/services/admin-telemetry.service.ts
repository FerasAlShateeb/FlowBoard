/**
 * The five admin telemetry aggregations.
 *
 * ── EVERYTHING IS AGGREGATED IN SQL ─────────────────────────────────────────
 * `telemetry_events` and `request_logs` are the two append-only streams that
 * grow fastest in the product; a month of traffic is millions of rows. Pulling
 * them into Node to bucket them there would move the whole month over the wire
 * to produce 168 numbers. Every function below therefore returns from ONE
 * round trip, and the only JavaScript in the hot path is the row → contract
 * mapping.
 *
 * ── WHOLE BUCKETS, AND WHY THE WINDOW SNAPS OUTWARD ─────────────────────────
 * The two time-series endpoints bucket with `date_trunc`, and the series runs
 * from `date_trunc(bucket, from)` through `date_trunc(bucket, to)` INCLUSIVE.
 * So a window of `09:30 → 11:15` at hourly granularity yields the 09:00, 10:00
 * and 11:00 buckets, each counting its whole hour. The alternative — clipping
 * the first and last buckets to the exact instants — produces two bars that are
 * short for a reason the chart cannot show, which reads as a traffic dip that
 * is really a rounding artefact.
 *
 * ── EMPTY BUCKETS ARE ROWS, NOT GAPS ────────────────────────────────────────
 * Both series are built from a `generate_series` spine LEFT JOINed to the data,
 * so an hour with no traffic comes back as `count: 0` rather than as a missing
 * point. That is a contract with the chart, not a convenience: Recharts draws a
 * line through whatever points it is given, so omitting quiet hours would draw
 * a straight line across an outage and make it invisible.
 *
 * For LATENCY the zero-filled bucket carries `count: 0` alongside its zeroed
 * percentiles — the client uses that count to break the line rather than
 * plotting a 0 ms p95 that never happened.
 *
 * ── PERCENTILES ARE `percentile_cont` ───────────────────────────────────────
 * Interpolated, not nearest-rank: latency is a continuous quantity and a p99
 * over 40 samples that can only ever be one of 40 observed values is a step
 * function, not a percentile. (The cycle-time report makes the OPPOSITE choice
 * for the opposite reason — see `reports.service.ts`.) All four percentiles and
 * the max come from ONE grouped scan; four separate queries over the same rows
 * would be four sorts of the same data.
 */
import { and, count, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  telemetryEventTypeSchema,
  type LatencyBucket,
  type LatencyReport,
  type PaginationMeta,
  type RequestsOverTime,
  type TelemetryEventRow,
  type TelemetryOverview,
  type TopEndpoints,
} from '@flowboard/shared';

import { db, requestLogs, telemetryEvents, users } from '../db';
import { ApiError } from '../utils/api-error';
import type {
  AdminTelemetryEventsQuery,
  TelemetryRangeQuery,
  TopEndpointsQuery,
} from '../validation/admin-telemetry.validation';

const MS_PER_DAY = 86_400_000;

/** The window every range-taking endpoint falls back to when `?from`/`?to` are absent. */
const DEFAULT_RANGE_DAYS = 7;

/**
 * The hard ceiling on how many points one chart may ask for.
 *
 * A minute bucket over the default week is 10 080 rows, which is neither
 * drawable nor cheap. Refusing is better than silently coarsening the bucket:
 * a chart labelled "per minute" that is secretly hourly is a lie, and a 400
 * tells the caller exactly which knob to turn.
 */
const MAX_BUCKETS = 1500;

/** `date_trunc` unit → the matching step for `generate_series`. */
const BUCKET_INTERVAL: Record<TelemetryRangeQuery['bucket'], string> = {
  minute: '1 minute',
  hour: '1 hour',
  day: '1 day',
};

/** Bucket width in milliseconds — used only to size the series before running it. */
const BUCKET_MS: Record<TelemetryRangeQuery['bucket'], number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: MS_PER_DAY,
};

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

interface Window {
  from: Date;
  to: Date;
}

/**
 * Resolve `?from`/`?to` into a concrete window, defaulting to the last
 * {@link DEFAULT_RANGE_DAYS} days ending now.
 *
 * `now` is a parameter so the suites can pin it; production never passes it.
 */
export function resolveWindow(
  range: { from?: string; to?: string },
  now: Date = new Date(),
): Window {
  const to = range.to === undefined ? now : new Date(range.to);
  const from =
    range.from === undefined
      ? new Date(to.getTime() - DEFAULT_RANGE_DAYS * MS_PER_DAY)
      : new Date(range.from);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw ApiError.badRequest('The telemetry window is not a pair of instants');
  }
  if (from.getTime() > to.getTime()) {
    throw ApiError.badRequest('`from` must not be after `to`');
  }
  return { from, to };
}

/**
 * Refuse a window/bucket pair that would produce an undrawable series.
 *
 * Checked in JavaScript, BEFORE the query runs: `generate_series` would happily
 * materialise a million rows first and let the failure be a timeout.
 */
function assertBucketCount(window: Window, bucket: TelemetryRangeQuery['bucket']): void {
  const span = window.to.getTime() - window.from.getTime();
  const buckets = Math.floor(span / BUCKET_MS[bucket]) + 1;
  if (buckets > MAX_BUCKETS) {
    throw ApiError.badRequest(
      `That window holds more than ${String(MAX_BUCKETS)} ${bucket} buckets — narrow the range or widen the bucket`,
    );
  }
}

/** The first instant of the UTC calendar day `at` falls in. */
export function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * A `Date` → the ISO string a RAW `sql` parameter must be.
 *
 * Drizzle encodes a parameter through the COLUMN it is compared against, so
 * `gte(table.createdAt, someDate)` binds correctly. A `Date` interpolated into a
 * hand-written `sql` fragment has no column to learn from, reaches postgres-js
 * as an unencoded object, and fails at bind time with a type error from
 * `Buffer.byteLength`. Every raw timestamp below therefore goes through here and
 * is cast explicitly with `::timestamptz` on the SQL side.
 */
function instant(value: Date): string {
  return value.toISOString();
}

// ---------------------------------------------------------------------------
// 1. Overview
// ---------------------------------------------------------------------------

/**
 * `GET /api/admin/telemetry/overview` — the KPI row.
 *
 * ONE SCAN, FIVE NUMBERS. Every figure is an aggregate over the SAME seven-day
 * slice of `telemetry_events`, so they are computed as `FILTER` clauses on one
 * pass rather than as five queries that would each re-walk the index — and, more
 * importantly, would each see a slightly different "now".
 *
 * "TODAY" IS THE UTC CALENDAR DAY, not a rolling 24 hours. Both `dau` and
 * `eventsToday` are read next to each other on the same card, and a rolling
 * window would make a Monday-morning DAU include half of Sunday — which is not
 * what anyone reading a number labelled "today" assumes. The day boundary is
 * computed in Node (`startOfUtcDay`) rather than with `date_trunc('day', now())`
 * so it cannot silently follow the database session's timezone.
 */
export async function overview(now: Date = new Date()): Promise<TelemetryOverview> {
  const dayStart = startOfUtcDay(now);
  const weekStart = new Date(now.getTime() - DEFAULT_RANGE_DAYS * MS_PER_DAY);
  // See `instant()`: a raw `sql` parameter must be a string, not a `Date`.
  const day = instant(dayStart);
  const week = instant(weekStart);
  // The scan covers whichever window reaches further back — the 7-day one,
  // unless someone shortens DEFAULT_RANGE_DAYS below one day.
  const scanFrom = dayStart.getTime() < weekStart.getTime() ? dayStart : weekStart;

  const [row] = await db
    .select({
      dau: sql<number>`count(distinct ${telemetryEvents.userId}) filter (where ${telemetryEvents.createdAt} >= ${day}::timestamptz)::int`,
      eventsToday: sql<number>`count(*) filter (where ${telemetryEvents.createdAt} >= ${day}::timestamptz)::int`,
      tasksCreated7d: sql<number>`count(*) filter (where ${telemetryEvents.type} = 'task_created' and ${telemetryEvents.createdAt} >= ${week}::timestamptz)::int`,
      tasksCompleted7d: sql<number>`count(*) filter (where ${telemetryEvents.type} = 'task_completed' and ${telemetryEvents.createdAt} >= ${week}::timestamptz)::int`,
      activeProjects: sql<number>`count(distinct ${telemetryEvents.projectId}) filter (where ${telemetryEvents.createdAt} >= ${week}::timestamptz)::int`,
    })
    .from(telemetryEvents)
    .where(gte(telemetryEvents.createdAt, scanFrom));

  // An aggregate-only select always yields exactly one row; the fallback exists
  // so the return type needs no non-null assertion.
  return (
    row ?? {
      dau: 0,
      eventsToday: 0,
      tasksCreated7d: 0,
      tasksCompleted7d: 0,
      activeProjects: 0,
    }
  );
}

// ---------------------------------------------------------------------------
// 2. The raw event feed
// ---------------------------------------------------------------------------

/** A page of events plus the envelope's `meta` block. */
export interface TelemetryEventPage {
  rows: TelemetryEventRow[];
  meta: PaginationMeta;
}

/** Every member of the closed enum — the feed's implicit type filter (see below). */
const KNOWN_EVENT_TYPES: readonly string[] = telemetryEventTypeSchema.options;

/**
 * jsonb → the contract's `Record<string, unknown> | null`.
 *
 * The column can hold any JSON value, but every writer stores an object or
 * nothing. A scalar or an array that got in some other way is reported as
 * `null` rather than crashing the page that renders the expander: the payload
 * is diagnostic detail, and losing one row's detail beats losing the feed.
 */
function toPayload(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * `GET /api/admin/telemetry/events` — the paginated raw feed.
 *
 * NO IMPLICIT TIME WINDOW. Unlike the four aggregations, this endpoint does not
 * default to the last seven days: it is the "what exactly happened" view, it is
 * already bounded by `?page&pageSize`, and a hidden window would make "I cannot
 * find the event from last month" a support ticket instead of a scroll.
 *
 * THE TYPE FILTER IS ALWAYS PRESENT. When the caller names no types the query
 * still constrains `type` to the closed enum, which does two things: it keeps
 * the count and the rows consistent (a filtered-out row cannot inflate the
 * total), and it guarantees every row satisfies `telemetryEventRowSchema`. The
 * column is `text` by design — see `db/schema/telemetry.ts` — so "a value the
 * current build has never heard of" is a real, if rare, possibility during a
 * rollback.
 */
export async function listEvents(query: AdminTelemetryEventsQuery): Promise<TelemetryEventPage> {
  const filters: SQL[] = [
    inArray(
      telemetryEvents.type,
      query.type && query.type.length > 0 ? query.type : KNOWN_EVENT_TYPES,
    ),
  ];
  if (query.userId !== undefined) filters.push(eq(telemetryEvents.userId, query.userId));
  if (query.projectId !== undefined) filters.push(eq(telemetryEvents.projectId, query.projectId));
  if (query.from !== undefined) filters.push(gte(telemetryEvents.createdAt, new Date(query.from)));
  if (query.to !== undefined) filters.push(lte(telemetryEvents.createdAt, new Date(query.to)));

  const where = and(...filters);

  const [totalRow] = await db.select({ value: count() }).from(telemetryEvents).where(where);
  const total = totalRow?.value ?? 0;

  const rows = await db
    .select({
      id: telemetryEvents.id,
      type: telemetryEvents.type,
      userId: telemetryEvents.userId,
      orgId: telemetryEvents.orgId,
      projectId: telemetryEvents.projectId,
      payload: telemetryEvents.payload,
      createdAt: telemetryEvents.createdAt,
      userName: users.name,
    })
    .from(telemetryEvents)
    .leftJoin(users, eq(telemetryEvents.userId, users.id))
    .where(where)
    .orderBy(...eventOrderBy(query.sort))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    rows: rows.map((row) => ({
      // bigserial: a decimal STRING on the wire, because a 64-bit id does not
      // survive JSON's float64 (see `bigIntId` in the shared package).
      id: String(row.id),
      type: telemetryEventTypeSchema.parse(row.type),
      userId: row.userId,
      orgId: row.orgId,
      projectId: row.projectId,
      payload: toPayload(row.payload),
      createdAt: row.createdAt.toISOString(),
      userName: row.userName,
    })),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

/**
 * The ORDER BY, newest first by default.
 *
 * `id` is always the final term. `created_at` has millisecond resolution and a
 * burst of events written in one transaction share it exactly, so without a
 * tiebreak the same row could appear on page 1 AND page 2 while another never
 * appears at all — the classic unstable-pagination bug. The bigserial id is
 * monotonic and unique, which makes the order total.
 */
function eventOrderBy(sort: AdminTelemetryEventsQuery['sort']): SQL[] {
  const direction = sort?.direction ?? 'desc';
  const column = sort?.field === 'type' ? telemetryEvents.type : telemetryEvents.createdAt;
  const primary = direction === 'asc' ? sql`${column} asc` : sql`${column} desc`;
  return [primary, desc(telemetryEvents.id)];
}

// ---------------------------------------------------------------------------
// 3. Requests over time
// ---------------------------------------------------------------------------

/**
 * A raw row of the requests series.
 *
 * A `type` alias rather than an `interface` on purpose: `db.execute<T>` requires
 * `T extends Record<string, unknown>`, and TypeScript grants an implicit index
 * signature to object TYPE ALIASES but never to interfaces.
 */
type RequestsBucketRow = {
  ts: string;
  count: number;
  avgDurationMs: number;
};

/**
 * `GET /api/admin/telemetry/requests-over-time?bucket=&from=&to=`.
 *
 * The `generate_series` spine is the zero-fill (see the module header). The
 * LEFT JOIN's predicate is a half-open `[ts, ts + interval)` so a request
 * landing exactly on a boundary belongs to exactly one bucket — `BETWEEN` would
 * double-count it.
 */
export async function requestsOverTime(query: TelemetryRangeQuery): Promise<RequestsOverTime> {
  const window = resolveWindow(query);
  assertBucketCount(window, query.bucket);
  const step = BUCKET_INTERVAL[query.bucket];

  const rows = await db.execute<RequestsBucketRow>(sql`
    with spine as (
      select generate_series(
        date_trunc(${query.bucket}, ${instant(window.from)}::timestamptz),
        date_trunc(${query.bucket}, ${instant(window.to)}::timestamptz),
        ${step}::interval
      ) as ts
    )
    select
      to_char(spine.ts at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "ts",
      count(logs.id)::int as "count",
      coalesce(round(avg(logs.duration_ms)::numeric, 2), 0)::float8 as "avgDurationMs"
    from spine
    left join ${requestLogs} as logs
      on logs.created_at >= spine.ts
     and logs.created_at < spine.ts + ${step}::interval
    group by spine.ts
    order by spine.ts asc
  `);

  return {
    buckets: rows.map((row) => ({
      ts: row.ts,
      count: row.count,
      avgDurationMs: row.avgDurationMs,
    })),
  };
}

// ---------------------------------------------------------------------------
// 4. Top endpoints
// ---------------------------------------------------------------------------

/** One grouped endpoint row. `type`, not `interface` — see {@link RequestsBucketRow}. */
type TopEndpointRow = {
  method: string;
  path: string;
  count: number;
  avgDurationMs: number;
  errorRate: number;
};

/**
 * `GET /api/admin/telemetry/top-endpoints?from=&to=&limit=`.
 *
 * Grouped by `(method, path)` — the same path under GET and DELETE are two
 * different endpoints with two different latency profiles, and merging them
 * hides the expensive one behind the cheap one's volume.
 *
 * `errorRate` COUNTS 5xx ONLY. A 404 on a deleted task and a 403 on a
 * permission boundary are the API doing its job; folding them in would put a
 * healthy endpoint permanently in the red and train the reader to ignore the
 * column. It is a SHARE in `[0, 1]`, not a percentage — the contract says so,
 * and formatting belongs to the view.
 *
 * The ordering carries `method, path` as a tiebreak so two endpoints with equal
 * traffic do not swap places between two identical requests.
 */
export async function topEndpoints(query: TopEndpointsQuery): Promise<TopEndpoints> {
  const window = resolveWindow(query);

  const rows = await db.execute<TopEndpointRow>(sql`
    select
      logs.method as "method",
      logs.path as "path",
      count(*)::int as "count",
      round(avg(logs.duration_ms)::numeric, 2)::float8 as "avgDurationMs",
      round(
        (count(*) filter (where logs.status_code >= 500))::numeric / count(*)::numeric,
        4
      )::float8 as "errorRate"
    from ${requestLogs} as logs
    where logs.created_at >= ${instant(window.from)}::timestamptz
      and logs.created_at <= ${instant(window.to)}::timestamptz
    group by logs.method, logs.path
    order by count(*) desc, logs.method asc, logs.path asc
    limit ${query.limit}
  `);

  return {
    endpoints: rows.map((row) => ({
      method: row.method,
      path: row.path,
      count: row.count,
      avgDurationMs: row.avgDurationMs,
      errorRate: row.errorRate,
    })),
  };
}

// ---------------------------------------------------------------------------
// 5. Latency percentiles
// ---------------------------------------------------------------------------

/** One latency bucket, raw. `type`, not `interface` — see {@link RequestsBucketRow}. */
type LatencyBucketRow = {
  ts: string;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  count: number;
};

/**
 * `GET /api/admin/telemetry/latency?bucket=&from=&to=`.
 *
 * Percentiles OVER TIME rather than one summary for the window, because the
 * question an admin actually has is "when did it get slow", and a single p95 for
 * a week answers it with one number that is true and useless.
 *
 * All five statistics come from one grouped scan of the same spine used by
 * {@link requestsOverTime}, so the two charts on the requests page share an
 * x-axis domain exactly — including their empty buckets.
 */
export async function latency(query: TelemetryRangeQuery): Promise<LatencyReport> {
  const window = resolveWindow(query);
  assertBucketCount(window, query.bucket);
  const step = BUCKET_INTERVAL[query.bucket];

  const rows = await db.execute<LatencyBucketRow>(sql`
    with spine as (
      select generate_series(
        date_trunc(${query.bucket}, ${instant(window.from)}::timestamptz),
        date_trunc(${query.bucket}, ${instant(window.to)}::timestamptz),
        ${step}::interval
      ) as ts
    )
    select
      to_char(spine.ts at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "ts",
      coalesce(round(percentile_cont(0.5)  within group (order by logs.duration_ms)::numeric, 2), 0)::float8 as "p50",
      coalesce(round(percentile_cont(0.9)  within group (order by logs.duration_ms)::numeric, 2), 0)::float8 as "p90",
      coalesce(round(percentile_cont(0.95) within group (order by logs.duration_ms)::numeric, 2), 0)::float8 as "p95",
      coalesce(round(percentile_cont(0.99) within group (order by logs.duration_ms)::numeric, 2), 0)::float8 as "p99",
      coalesce(max(logs.duration_ms), 0)::float8 as "max",
      count(logs.id)::int as "count"
    from spine
    left join ${requestLogs} as logs
      on logs.created_at >= spine.ts
     and logs.created_at < spine.ts + ${step}::interval
    group by spine.ts
    order by spine.ts asc
  `);

  return {
    buckets: rows.map((row): LatencyBucket => ({
      ts: row.ts,
      p50: row.p50,
      p90: row.p90,
      p95: row.p95,
      p99: row.p99,
      max: row.max,
      count: row.count,
    })),
  };
}
