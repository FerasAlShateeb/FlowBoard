/**
 * Analytics controllers — five handlers, one per domain.
 *
 * Thin by rule (`routes → controllers → services → db`): read the
 * already-validated query, hand the service's answer to `respond`. There is no
 * shaping to do here, and that is the point — every number on an analytics page
 * comes out of one SQL statement, so a controller that post-processed anything
 * would be a second, invisible definition of a metric.
 *
 * {@link getOverview} takes no query even though the router validates one: the
 * overview's windows are fixed by the contract (14 days of events, 24 hours of
 * requests, trailing 30 days for the KPIs). The `validate` middleware still runs
 * ahead of it so a nonsense `?interval=fortnight` is a 422 on EVERY analytics
 * path rather than on four of the five — a client that gets a 200 from one
 * endpoint and a 422 from its neighbour for the same query string has learned
 * something false about the API.
 */
import type { Request, Response } from 'express';

import { getParsed } from '../middlewares/validate';
import * as adminAnalyticsService from '../services/admin-analytics.service';
import { respond } from '../utils/respond';
import type { AnalyticsWindowQuery } from '../validation/admin-analytics.validation';

/** `GET /api/admin/analytics/overview` — platform KPIs, fixed windows. */
export async function getOverview(_req: Request, res: Response): Promise<void> {
  respond(res, await adminAnalyticsService.overview());
}

/** `GET /api/admin/analytics/engagement?from=&to=&interval=`. */
export async function getEngagement(_req: Request, res: Response): Promise<void> {
  const query = getParsed<AnalyticsWindowQuery>(res, 'query');
  respond(res, await adminAnalyticsService.engagement(query));
}

/** `GET /api/admin/analytics/work?from=&to=&interval=`. */
export async function getWork(_req: Request, res: Response): Promise<void> {
  const query = getParsed<AnalyticsWindowQuery>(res, 'query');
  respond(res, await adminAnalyticsService.work(query));
}

/** `GET /api/admin/analytics/traffic?from=&to=&interval=`. */
export async function getTraffic(_req: Request, res: Response): Promise<void> {
  const query = getParsed<AnalyticsWindowQuery>(res, 'query');
  respond(res, await adminAnalyticsService.traffic(query));
}

/** `GET /api/admin/analytics/growth?from=&to=&interval=`. */
export async function getGrowth(_req: Request, res: Response): Promise<void> {
  const query = getParsed<AnalyticsWindowQuery>(res, 'query');
  respond(res, await adminAnalyticsService.growth(query));
}
