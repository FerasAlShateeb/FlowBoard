/**
 * Telemetry controllers — the five admin aggregations plus the one route the
 * browser itself calls.
 *
 * Thin by rule (`routes → controllers → services → db`): each handler reads the
 * already-validated request part and hands the service's answer to `respond`.
 * The only handler with any shape of its own is {@link ingestEvent}, and what it
 * owns is a SECURITY decision rather than a business one — see below.
 */
import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/require-auth';
import { getParsed } from '../middlewares/validate';
import * as adminTelemetryService from '../services/admin-telemetry.service';
import { record } from '../services/telemetry.service';
import { respond, respondNoContent } from '../utils/respond';
import type {
  AdminTelemetryEventsQuery,
  ClientTelemetryEventInput,
  TelemetryRangeQuery,
  TopEndpointsQuery,
} from '../validation/admin-telemetry.validation';

/** `GET /api/admin/telemetry/overview` — the KPI row. Takes no parameters. */
export async function getOverview(_req: Request, res: Response): Promise<void> {
  respond(res, await adminTelemetryService.overview());
}

/**
 * `GET /api/admin/telemetry/events` — the paginated raw feed.
 *
 * Pagination rides the ENVELOPE's `meta`, so `data` stays a plain array, exactly
 * like `/api/admin/users` and every other list endpoint.
 */
export async function getEvents(_req: Request, res: Response): Promise<void> {
  const query = getParsed<AdminTelemetryEventsQuery>(res, 'query');
  const page = await adminTelemetryService.listEvents(query);
  respond(res, page.rows, page.meta);
}

/** `GET /api/admin/telemetry/requests-over-time?bucket=&from=&to=`. */
export async function getRequestsOverTime(_req: Request, res: Response): Promise<void> {
  const query = getParsed<TelemetryRangeQuery>(res, 'query');
  respond(res, await adminTelemetryService.requestsOverTime(query));
}

/** `GET /api/admin/telemetry/top-endpoints?from=&to=&limit=`. */
export async function getTopEndpoints(_req: Request, res: Response): Promise<void> {
  const query = getParsed<TopEndpointsQuery>(res, 'query');
  respond(res, await adminTelemetryService.topEndpoints(query));
}

/** `GET /api/admin/telemetry/latency?bucket=&from=&to=`. */
export async function getLatency(_req: Request, res: Response): Promise<void> {
  const query = getParsed<TelemetryRangeQuery>(res, 'query');
  respond(res, await adminTelemetryService.latency(query));
}

/**
 * `POST /api/telemetry/events` — the ONLY door a browser has into
 * `telemetry_events`.
 *
 * ── THE ACTOR IS THE TOKEN, NEVER THE BODY ──────────────────────────────────
 * `userId` is taken from `req.user` and the body has no field for it. A client
 * that could name the actor could attribute a page view to anybody, and the
 * DAU number on the dashboard above would become an assertion by the client
 * rather than a measurement. `orgId`/`projectId` ARE accepted from the body
 * because they are dimensions of what the user was looking at, not claims about
 * who they are — and they are foreign keys, so an invented id cannot be stored.
 *
 * ── 204, NOT 200 ────────────────────────────────────────────────────────────
 * `record()` is fire-and-forget by contract: it returns `void` and the row is
 * inserted after this handler has already answered. There is therefore nothing
 * truthful to put in a body — a `{ id }` would be a fabrication, and a
 * `{ success: true }` would claim a durability this path deliberately does not
 * offer. The emitter in `lib/telemetry-client` ignores the response entirely.
 */
export function ingestEvent(req: Request, res: Response): void {
  const actor = requireUser(req);
  const input = getParsed<ClientTelemetryEventInput>(res, 'body');

  record(input.type, input.payload ?? null, {
    userId: actor.id,
    orgId: input.orgId ?? null,
    projectId: input.projectId ?? null,
  });

  respondNoContent(res);
}
