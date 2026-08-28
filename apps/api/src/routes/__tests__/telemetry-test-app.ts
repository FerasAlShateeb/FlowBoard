/**
 * Fixtures for WP4.3's telemetry suites.
 *
 * `buildTelemetryTestApp()` mounts the two routers from
 * `admin-telemetry.routes.ts` at the SAME prefixes the integrator uses
 * (`/api/admin/telemetry` and `/api/telemetry`), behind the same error handler,
 * so a path that resolves here resolves in production. It deliberately does not
 * import `app.ts` — that would drag in CORS, the global rate limiter, the
 * request-logger middleware (which would write `request_logs` rows of its own
 * and corrupt every fixture in this suite) and the socket bootstrap.
 *
 * The seeders below write RAW ROWS with explicit `createdAt` values, which is
 * the whole point: the aggregations are about time, and a fixture that could
 * only be "now" could not test a bucket boundary, a window edge, or a 7-day
 * cut-off.
 *
 * Not named `*.test.ts` — vitest's `include` glob would treat it as a suite
 * with no tests.
 */
import express, { type Express } from 'express';

import { errorHandler, notFound } from '../../middlewares/error-handler';
import {
  db,
  requestLogs,
  telemetryEvents,
  type RequestLogRow,
  type TelemetryEventRow,
} from '../../db';
import { adminTelemetryRouter, telemetryIngestRouter } from '../admin-telemetry.routes';

export function buildTelemetryTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/telemetry', adminTelemetryRouter);
  app.use('/api/telemetry', telemetryIngestRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/** Insert one `telemetry_events` row. `type` is a plain string — that is the column. */
export async function seedEvent(options: {
  type: string;
  createdAt: Date;
  userId?: string | null;
  orgId?: string | null;
  projectId?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<TelemetryEventRow> {
  const [row] = await db
    .insert(telemetryEvents)
    .values({
      type: options.type,
      createdAt: options.createdAt,
      userId: options.userId ?? null,
      orgId: options.orgId ?? null,
      projectId: options.projectId ?? null,
      payload: options.payload ?? null,
    })
    .returning();
  if (!row) throw new Error('seedEvent: insert returned no row');
  return row;
}

/** Insert one `request_logs` row. `path` is the route PATTERN, never a raw URL. */
export async function seedRequestLog(options: {
  createdAt: Date;
  durationMs: number;
  method?: string;
  path?: string;
  statusCode?: number;
  userId?: string | null;
}): Promise<RequestLogRow> {
  const [row] = await db
    .insert(requestLogs)
    .values({
      method: options.method ?? 'GET',
      path: options.path ?? '/api/tasks/:taskId',
      statusCode: options.statusCode ?? 200,
      durationMs: options.durationMs,
      createdAt: options.createdAt,
      userId: options.userId ?? null,
    })
    .returning();
  if (!row) throw new Error('seedRequestLog: insert returned no row');
  return row;
}

/** Seed a run of request logs at one instant — the fastest way to fill a bucket. */
export async function seedLatencies(
  createdAt: Date,
  durations: readonly number[],
  options: { method?: string; path?: string; statusCode?: number } = {},
): Promise<void> {
  for (const durationMs of durations) {
    await seedRequestLog({ createdAt, durationMs, ...options });
  }
}

/** `2026-08-20T09:15:00.000Z` → a `Date`. Reads better than `new Date(…)` inline. */
export function at(iso: string): Date {
  return new Date(iso);
}

/** Shifts an instant by whole hours — bucket-boundary fixtures. */
export function hoursFrom(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 3_600_000);
}

/** Shifts an instant by whole days. */
export function daysFrom(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}
