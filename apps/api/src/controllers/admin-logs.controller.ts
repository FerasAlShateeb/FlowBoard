/**
 * Server side of the diagnostics drawer: a cursor-tailed view of the in-memory
 * log ring.
 *
 * The drawer polls every 2 s with the `lastId` it last saw. Because ring ids are
 * strictly monotonic and never reused, a `sinceId` cursor stays correct across
 * eviction — and a cursor from BEFORE an API restart reads as "far in the
 * future", which the drawer detects (`lastId < sinceId`) and rewinds.
 */
import type { Request, Response } from 'express';
import { snapshot } from '../utils/log-ring';
import { respond } from '../utils/respond';
import { getParsed } from '../middlewares/validate';
import type { ServerLogsQuery } from '../validation/admin-logs.validation';

/** `GET /api/admin/logs?sinceId=&level=&limit=` — global admin only. */
export function getServerLogs(_req: Request, res: Response): void {
  const query = getParsed<ServerLogsQuery>(res, 'query');
  respond(res, snapshot(query));
}
