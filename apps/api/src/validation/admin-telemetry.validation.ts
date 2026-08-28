/**
 * Query/body shapes for the telemetry surface — the admin aggregations
 * (`/api/admin/telemetry/*`) and the one client-ingest route
 * (`POST /api/telemetry/events`).
 *
 * Almost everything here is a RE-EXPORT of `@flowboard/shared`'s
 * `telemetry.schema.ts`: the dashboards build these query strings and parse the
 * responses, so a server-only copy would be half a contract. Three things are
 * genuinely local and are defined below.
 *
 * ── 1. `?sort` ON THE EVENT FEED ────────────────────────────────────────────
 * The shared `telemetryEventsQuerySchema` carries the filters and the standard
 * `?page&pageSize`, but no sort. The feed is a table with a clickable time
 * column, so the API accepts one — restricted through `sortQueryFor` to the two
 * columns that have an index behind them, which is what keeps `?sort=payload`
 * from reaching the query builder. Left OPTIONAL rather than defaulted: the
 * default (`createdAt:desc`) belongs to the service, so a direct service call
 * and an HTTP call cannot disagree about it.
 *
 * ── 2. `?limit` ON TOP-ENDPOINTS ────────────────────────────────────────────
 * A "top N" table needs an N, and the shared range schema deliberately does not
 * carry one (the two chart endpoints have no use for it).
 *
 * ── 3. THE CLIENT-PERMITTED EVENT SUBSET ────────────────────────────────────
 * `telemetryEventInputSchema` accepts the WHOLE closed enum, which is correct
 * for the contract but wrong for a route a browser can call: `task_completed`
 * or `auth_login` are SERVER-AUTHORITATIVE — they are recorded inside the
 * transaction that performed the thing they describe, and a client that could
 * post them could write a history that never happened. The ingest route
 * therefore narrows `type` to the three events only the browser can observe.
 * The narrowing is a zod ENUM SUBSET of the shared one, so it stays a compile
 * error if a spelling drifts.
 */
import { z } from 'zod';
import {
  sortQueryFor,
  telemetryEventInputSchema,
  telemetryEventsQuerySchema,
  telemetryRangeQuerySchema,
  type TelemetryEventType,
} from '@flowboard/shared';

export {
  telemetryEventsQuerySchema,
  telemetryRangeQuerySchema,
  telemetryEventInputSchema,
} from '@flowboard/shared';

export type {
  TelemetryEventsQuery,
  TelemetryRangeQuery,
  TelemetryEventInput,
} from '@flowboard/shared';

// ---------------------------------------------------------------------------
// The event feed
// ---------------------------------------------------------------------------

/** The columns `?sort` may name — each one is the leading column of an index. */
export const TELEMETRY_EVENT_SORT_FIELDS = ['createdAt', 'type'] as const;

/** `GET /api/admin/telemetry/events?…&sort=createdAt:desc`. */
export const adminTelemetryEventsQuerySchema = telemetryEventsQuerySchema.extend({
  sort: sortQueryFor(TELEMETRY_EVENT_SORT_FIELDS).optional(),
});
export type AdminTelemetryEventsQuery = z.infer<typeof adminTelemetryEventsQuerySchema>;

// ---------------------------------------------------------------------------
// The request charts
// ---------------------------------------------------------------------------

/** Rows in one "busiest endpoints" table. Ten fills the panel; 100 is the ceiling. */
export const DEFAULT_TOP_ENDPOINTS_LIMIT = 10;

/** `GET /api/admin/telemetry/top-endpoints?from=&to=&limit=`. */
export const topEndpointsQuerySchema = telemetryRangeQuerySchema
  .pick({ from: true, to: true })
  .extend({
    limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_TOP_ENDPOINTS_LIMIT),
  });
export type TopEndpointsQuery = z.infer<typeof topEndpointsQuerySchema>;

// ---------------------------------------------------------------------------
// Client ingest
// ---------------------------------------------------------------------------

/**
 * The events a BROWSER is allowed to report. Everything else in the closed enum
 * is written server-side, inside the transaction it describes.
 *
 * `satisfies` pins each member to the shared union, so renaming an event type in
 * `@flowboard/shared` breaks this list at compile time instead of silently
 * turning a permitted event into a rejected one.
 */
export const CLIENT_TELEMETRY_EVENT_TYPES = [
  'page_view',
  'theme_changed',
  'export_csv',
] as const satisfies readonly TelemetryEventType[];

export type ClientTelemetryEventType = (typeof CLIENT_TELEMETRY_EVENT_TYPES)[number];

/**
 * `POST /api/telemetry/events` body.
 *
 * The payload bag is capped: it is an uninterpreted jsonb column on the hottest
 * append-only table in the product, and an unbounded one from an unprivileged
 * route is a storage amplifier. Twelve keys is more than any emitter in
 * `lib/telemetry-client` sends.
 */
export const MAX_CLIENT_PAYLOAD_KEYS = 12;

export const clientTelemetryEventInputSchema = telemetryEventInputSchema.extend({
  type: z.enum(CLIENT_TELEMETRY_EVENT_TYPES),
  payload: z
    .record(z.string(), z.unknown())
    .refine(
      (value) => Object.keys(value).length <= MAX_CLIENT_PAYLOAD_KEYS,
      `A telemetry payload may carry at most ${String(MAX_CLIENT_PAYLOAD_KEYS)} keys`,
    )
    .optional(),
});
export type ClientTelemetryEventInput = z.infer<typeof clientTelemetryEventInputSchema>;
