// Telemetry contracts: the product-analytics event stream FlowBoard records
// itself (no third-party SDK), plus the admin dashboard's aggregation shapes.
//
// `telemetry_events.type` is a TEXT column validated by the closed zod enum
// below, not a pg enum: adding an event type is then a shared-package change and
// a deploy, never a migration — while the enum still makes an unknown type a 422
// at the boundary and a compile error in the emitter.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { bigIntId, commaSeparatedList, isoDateTime, paginationQuerySchema, uuid } from './common';

/**
 * The CLOSED set of recorded events. Kept deliberately small: each one answers a
 * question someone actually asks of the admin dashboard, and an event nobody
 * charts is just write amplification.
 */
export const telemetryEventTypeSchema = z.enum([
  'auth_login',
  'page_view',
  'task_created',
  'task_moved',
  'task_completed',
  'sprint_started',
  'sprint_completed',
  'comment_added',
  'search_performed',
  'notification_opened',
  'theme_changed',
  'export_csv',
]);
export type TelemetryEventType = z.infer<typeof telemetryEventTypeSchema>;

/**
 * A stored telemetry event (mirrors `telemetry_events`).
 *
 * `payload` is an uninterpreted jsonb bag — the route of a `page_view`, the
 * result count of a `search_performed`. Recording is FIRE-AND-FORGET server-side:
 * a telemetry failure must never fail the mutation that triggered it.
 */
export const telemetryEventSchema = z.object({
  id: bigIntId,
  type: telemetryEventTypeSchema,
  userId: uuid.nullable(),
  orgId: uuid.nullable(),
  projectId: uuid.nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  createdAt: isoDateTime,
});
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

/** `POST /telemetry` — the client-emitted events (`page_view`, `theme_changed`). */
export const telemetryEventInputSchema = z.object({
  type: telemetryEventTypeSchema,
  orgId: uuid.nullable().optional(),
  projectId: uuid.nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type TelemetryEventInput = z.infer<typeof telemetryEventInputSchema>;

// ---------------------------------------------------------------------------
// Admin analytics responses (`/admin/telemetry/*`, global admin only).
// ---------------------------------------------------------------------------

/** `GET /admin/telemetry/overview` — the KPI row above the charts. */
export const telemetryOverviewSchema = z.object({
  /**
   * Daily active users: distinct users with any event on the current UTC
   * CALENDAR DAY — not a rolling 24-hour window.
   *
   * The distinction matters to anyone reading the number: a calendar day resets
   * at 00:00 UTC, so this figure climbs through the day and drops to near zero
   * just after midnight, and it is directly comparable between days. A rolling
   * window would never reset and would never be comparable to `eventsToday`,
   * which is counted the same way.
   */
  dau: z.number().int().nonnegative(),
  eventsToday: z.number().int().nonnegative(),
  tasksCreated7d: z.number().int().nonnegative(),
  tasksCompleted7d: z.number().int().nonnegative(),
  /** Projects touched by any event in the last 7 days. */
  activeProjects: z.number().int().nonnegative(),
});
export type TelemetryOverview = z.infer<typeof telemetryOverviewSchema>;

/**
 * `GET /admin/telemetry/events` filters. Pagination rides the standard
 * `?page&pageSize` params and the response's PAGE COUNTS COME BACK IN THE
 * ENVELOPE `meta`, like every other list endpoint — the payload is a plain array.
 */
export const telemetryEventsQuerySchema = paginationQuerySchema.extend({
  type: commaSeparatedList(telemetryEventTypeSchema).optional(),
  userId: uuid.optional(),
  projectId: uuid.optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});
export type TelemetryEventsQuery = z.infer<typeof telemetryEventsQuerySchema>;

/** An events-table row: the event plus the actor's name, joined for display. */
export const telemetryEventRowSchema = telemetryEventSchema.extend({
  userName: z.string().nullable(),
});
export type TelemetryEventRow = z.infer<typeof telemetryEventRowSchema>;

/** `GET /admin/telemetry/events` payload — paginated via the envelope's `meta`. */
export const telemetryEventsResponseSchema = z.array(telemetryEventRowSchema);
export type TelemetryEventsResponse = z.infer<typeof telemetryEventsResponseSchema>;

/** One time bucket of the request-volume chart (from `request_logs`). */
export const requestsBucketSchema = z.object({
  ts: isoDateTime,
  count: z.number().int().nonnegative(),
  avgDurationMs: z.number().nonnegative(),
});
export type RequestsBucket = z.infer<typeof requestsBucketSchema>;

/** `GET /admin/telemetry/requests-over-time`. */
export const requestsOverTimeSchema = z.object({
  buckets: z.array(requestsBucketSchema),
});
export type RequestsOverTime = z.infer<typeof requestsOverTimeSchema>;

/**
 * One row of the busiest-endpoints table. `path` is the NORMALIZED route pattern
 * (`/api/tasks/:taskId`), not the concrete URL — otherwise every task id would
 * be its own endpoint and the table would be a list of ids.
 */
export const topEndpointSchema = z.object({
  method: z.string(),
  path: z.string(),
  count: z.number().int().nonnegative(),
  avgDurationMs: z.number().nonnegative(),
  errorRate: z.number().min(0).max(1),
});
export type TopEndpoint = z.infer<typeof topEndpointSchema>;

/** `GET /admin/telemetry/top-endpoints`. */
export const topEndpointsSchema = z.object({
  endpoints: z.array(topEndpointSchema),
});
export type TopEndpoints = z.infer<typeof topEndpointsSchema>;

/** Latency percentiles for one time bucket, in milliseconds. */
export const latencyBucketSchema = z.object({
  ts: isoDateTime,
  p50: z.number().nonnegative(),
  p90: z.number().nonnegative(),
  p95: z.number().nonnegative(),
  p99: z.number().nonnegative(),
  max: z.number().nonnegative(),
  count: z.number().int().nonnegative(),
});
export type LatencyBucket = z.infer<typeof latencyBucketSchema>;

/** `GET /admin/telemetry/latency` — percentiles over time, not one summary. */
export const latencyReportSchema = z.object({
  buckets: z.array(latencyBucketSchema),
});
export type LatencyReport = z.infer<typeof latencyReportSchema>;

/** `?from=&to=&bucket=` — the window and granularity of the request charts. */
export const telemetryRangeQuerySchema = z.object({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  bucket: z.enum(['minute', 'hour', 'day']).default('hour'),
});
export type TelemetryRangeQuery = z.infer<typeof telemetryRangeQuerySchema>;
