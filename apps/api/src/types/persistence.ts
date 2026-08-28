/**
 * Row shapes the API core writes through injected persistence sinks.
 *
 * WHY THE SINKS STILL EXIST. `src/db/**` is now in the repo, so these types are
 * drizzle's own inferred inserts rather than hand-written twins — but the
 * INJECTION is not an artefact of the build order, it is the design:
 * `services/telemetry.service.ts` and `middlewares/request-logger.ts` are
 * fire-and-forget observability that must stay unit-testable without a database
 * and must degrade to a no-op when nothing is wired. `src/bootstrap.ts` is the
 * one composition root that hands them the real drizzle inserts.
 *
 * These are `$inferInsert`, not `$inferSelect`: `id` and `created_at` have
 * database defaults, so a caller supplies neither.
 */
import type { requestLogs, telemetryEvents } from '../db/schema/telemetry';

/**
 * One row of `telemetry_events`.
 *
 * `type` is a plain `text` column: the closed set lives in the shared zod enum
 * and is enforced at the `record()` boundary by `TelemetryEventType`, precisely
 * so adding an event type never needs a migration.
 */
export type TelemetryEventInsert = typeof telemetryEvents.$inferInsert;

/**
 * One row of `request_logs`.
 *
 * `path` is the *route pattern* (`/api/projects/:id/tasks`), never the raw URL:
 * the admin telemetry dashboards group by it, and per-id paths would blow the
 * cardinality out to one bucket per entity.
 */
export type RequestLogInsert = typeof requestLogs.$inferInsert;
