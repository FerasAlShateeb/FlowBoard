/**
 * Admin analytics — the five domain aggregations. Mount at
 * `/api/admin/analytics`, AHEAD of the bare `/admin` mount.
 *
 *   GET /overview      global admin
 *   GET /engagement    global admin
 *   GET /work          global admin
 *   GET /traffic       global admin
 *   GET /growth        global admin
 *
 * ── THE GUARD IS ROUTER-WIDE, ON PURPOSE ────────────────────────────────────
 * A single blanket `use()` rather than five per-route guards: this surface
 * exposes every user's activity, every organization's size and every request
 * path in the deployment, and a per-route arrangement is exactly the one where
 * a route added later is born unguarded. See the same note in
 * `admin-telemetry.routes.ts`. `__tests__/router-mounting.test.ts` asserts the
 * 401 / 403 contract on all five paths and kept asserting it unchanged across
 * the seam's 501 → 200 transition (W1.0 pre-mounted this router with
 * `notImplemented` bodies; W1.2 replaced them with the handlers below).
 *
 * ── ONE WINDOW SCHEMA FOR ALL FIVE ──────────────────────────────────────────
 * `analyticsWindowQuerySchema` (`@flowboard/shared`, re-exported through
 * `validation/admin-analytics.validation.ts`) so the domains can never drift
 * apart on what `?from`, `?to` and `?interval` mean — and so a hand-typed
 * `?interval=fortnight` is a 422 at the boundary rather than a query that
 * returns 2.6 million rows.
 *
 * `/overview` validates the same query even though it ignores it: its two
 * sparklines are fixed-window by contract, but an endpoint that ACCEPTED a
 * malformed parameter its four neighbours reject would teach a client something
 * false about the API.
 */
import { Router } from 'express';

import * as adminAnalyticsController from '../controllers/admin-analytics.controller';
import { requireAuth, requireGlobalAdmin } from '../middlewares/require-auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import { analyticsWindowQuerySchema } from '../validation/admin-analytics.validation';

export const adminAnalyticsRouter: Router = Router();

adminAnalyticsRouter.use(requireAuth, requireGlobalAdmin);

adminAnalyticsRouter.get(
  '/overview',
  validate(analyticsWindowQuerySchema, 'query'),
  asyncHandler(adminAnalyticsController.getOverview),
);

adminAnalyticsRouter.get(
  '/engagement',
  validate(analyticsWindowQuerySchema, 'query'),
  asyncHandler(adminAnalyticsController.getEngagement),
);

adminAnalyticsRouter.get(
  '/work',
  validate(analyticsWindowQuerySchema, 'query'),
  asyncHandler(adminAnalyticsController.getWork),
);

adminAnalyticsRouter.get(
  '/traffic',
  validate(analyticsWindowQuerySchema, 'query'),
  asyncHandler(adminAnalyticsController.getTraffic),
);

adminAnalyticsRouter.get(
  '/growth',
  validate(analyticsWindowQuerySchema, 'query'),
  asyncHandler(adminAnalyticsController.getGrowth),
);
