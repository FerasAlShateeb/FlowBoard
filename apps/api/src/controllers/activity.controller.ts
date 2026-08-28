/** `/api/projects/:projectId/activity` — the project audit feed. */
import type { Request, Response } from 'express';

import { getProjectAccess } from '../middlewares/require-roles';
import { getParsed } from '../middlewares/validate';
import { listProjectActivity } from '../services/activity-feed.service';
import { respond } from '../utils/respond';
import type { ActivityFeedQuery } from '../validation/activity.validation';

/** `GET /activity?page=&pageSize=&action=&beforeId=` — any project viewer. */
export async function listActivity(_req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  const query = getParsed<ActivityFeedQuery>(res, 'query');
  const page = await listProjectActivity(access.projectId, query);
  respond(res, page.items, page.meta);
}
