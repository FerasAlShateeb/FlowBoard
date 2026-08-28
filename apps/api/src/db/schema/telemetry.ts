/**
 * Telemetry — FlowBoard's own analytics, no third party involved.
 *
 * Two append-only streams feeding the admin dashboards: semantic product events
 * (`telemetry_events`) and one row per HTTP request (`request_logs`). Both are
 * written fire-and-forget: a failed insert must never fail the user's request.
 */
import { bigserial, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from '../columns';
import { organizations } from './orgs';
import { projects } from './projects';
import { users } from './users';

export const telemetryEvents = pgTable(
  'telemetry_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    /**
     * `text`, NOT a pg enum, and that is the whole design: the closed set lives
     * in the shared zod enum and is validated at the `record()` boundary, so
     * adding an event type ships with the feature instead of with a migration.
     */
    type: text('type').notNull(),

    /** All optional — a `page_view` on the login screen has no user or project. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),

    /** Event-specific dimensions, e.g. `{ path, view, resultCount }`. */
    payload: jsonb('payload'),
    /** Groups events from one browser tab session; anonymous, not a token. */
    sessionId: text('session_id'),

    ...createdAt(),
  },
  (table) => [
    /** "events over time, split by type" — the admin events chart. */
    index('telemetry_events_type_created_idx').on(table.type, table.createdAt.desc()),
    /** Unfiltered volume over a window — the overview cards. */
    index('telemetry_events_created_idx').on(table.createdAt.desc()),
    /** Per-user drill-down. */
    index('telemetry_events_user_idx').on(table.userId),
  ],
);

export const requestLogs = pgTable(
  'request_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    method: text('method').notNull(),
    /**
     * The normalized ROUTE PATTERN (`/api/projects/:projectId/tasks`), never the
     * concrete URL. Storing raw paths makes "top endpoints" a list of a million
     * distinct uuids instead of a top-ten.
     */
    path: text('path').notNull(),
    statusCode: integer('status_code').notNull(),
    durationMs: integer('duration_ms').notNull(),

    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    ip: text('ip'),
    userAgent: text('user_agent'),

    ...createdAt(),
  },
  (table) => [
    /** Requests-over-time and latency percentiles across a window. */
    index('request_logs_created_idx').on(table.createdAt.desc()),
    /** Top-endpoints and per-endpoint latency. */
    index('request_logs_path_created_idx').on(table.path, table.createdAt.desc()),
    /** Error-rate slices. */
    index('request_logs_status_idx').on(table.statusCode),
  ],
);

export type TelemetryEventRow = typeof telemetryEvents.$inferSelect;
export type NewTelemetryEventRow = typeof telemetryEvents.$inferInsert;
export type RequestLogRow = typeof requestLogs.$inferSelect;
export type NewRequestLogRow = typeof requestLogs.$inferInsert;
