/**
 * The telemetry surface — TWO routers, because the two halves have opposite
 * audiences and opposite guards.
 *
 *   `adminTelemetryRouter`   →  mount at `/api/admin/telemetry`
 *       GET /overview               global admin
 *       GET /events                 global admin
 *       GET /requests-over-time     global admin
 *       GET /top-endpoints          global admin
 *       GET /latency                global admin
 *
 *   `telemetryIngestRouter`  →  mount at `/api/telemetry`
 *       POST /events                any authenticated user
 *
 * WHY NOT ONE ROUTER. The read half exposes every user's activity, every
 * request path and every latency figure in the deployment — that is
 * global-admin surface, and the guard is applied with a blanket `use()` so a
 * route added later cannot be born unguarded. The write half is the opposite: a
 * signed-in user reporting their own page view. Stacking them in one router
 * would mean per-route guards on both, which is exactly the arrangement where
 * someone eventually forgets one.
 *
 * They live in ONE FILE because they are one contract: the events the ingest
 * route accepts are the events the admin feed lists, and the narrowing that
 * keeps a browser from writing `task_completed` is in the validation module both
 * import. Splitting them would put the two ends of that argument in two places.
 *
 * ── RATE LIMITING THE INGEST ROUTE ──────────────────────────────────────────
 * It is the only authenticated write in the product that a script can call in a
 * loop for free — no domain object is created, no uniqueness is checked, and the
 * row is small enough to be cheap for the attacker and expensive in aggregate
 * for the table. 120/minute per user is roughly two navigations a second, which
 * no human produces and no debounced emitter approaches.
 */
import { Router } from 'express';

import * as adminTelemetryController from '../controllers/admin-telemetry.controller';
import { requireAuth, requireGlobalAdmin } from '../middlewares/require-auth';
import { makeRateLimit } from '../middlewares/rate-limit';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  adminTelemetryEventsQuerySchema,
  clientTelemetryEventInputSchema,
  telemetryRangeQuerySchema,
  topEndpointsQuerySchema,
} from '../validation/admin-telemetry.validation';

// ── Read: the admin dashboards ───────────────────────────────────────────────

export const adminTelemetryRouter: Router = Router();

adminTelemetryRouter.use(requireAuth, requireGlobalAdmin);

adminTelemetryRouter.get('/overview', asyncHandler(adminTelemetryController.getOverview));

adminTelemetryRouter.get(
  '/events',
  validate(adminTelemetryEventsQuerySchema, 'query'),
  asyncHandler(adminTelemetryController.getEvents),
);

adminTelemetryRouter.get(
  '/requests-over-time',
  validate(telemetryRangeQuerySchema, 'query'),
  asyncHandler(adminTelemetryController.getRequestsOverTime),
);

adminTelemetryRouter.get(
  '/top-endpoints',
  validate(topEndpointsQuerySchema, 'query'),
  asyncHandler(adminTelemetryController.getTopEndpoints),
);

adminTelemetryRouter.get(
  '/latency',
  validate(telemetryRangeQuerySchema, 'query'),
  asyncHandler(adminTelemetryController.getLatency),
);

// ── Write: the browser's own events ──────────────────────────────────────────

/** See the header: the ceiling on client-reported events, per user per minute. */
export const telemetryIngestRateLimit = makeRateLimit({ windowMs: 60_000, limit: 120 });

export const telemetryIngestRouter: Router = Router();

telemetryIngestRouter.post(
  '/events',
  requireAuth,
  telemetryIngestRateLimit,
  validate(clientTelemetryEventInputSchema, 'body'),
  adminTelemetryController.ingestEvent,
);
