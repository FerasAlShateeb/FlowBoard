/**
 * Command-palette search controller.
 *
 * `seesWholeOrg` is resolved HERE, from the org access the guard already
 * established, so the service receives a decided fact rather than re-running
 * the permission chain inside its query planner.
 */
import type { Request, Response } from 'express';
import type { SearchQuery } from '@flowboard/shared';

import { getParsed } from '../middlewares/validate';
import { requireUser } from '../middlewares/require-auth';
import { getOrgAccess } from '../middlewares/require-roles';
import { respond } from '../utils/respond';
import { searchTasks } from '../services/search.service';
import type { SearchParams } from '../validation/search.validation';

/** `GET /api/orgs/:orgId/search?q=&limit=`. */
export async function searchOrgTasks(req: Request, res: Response): Promise<void> {
  const { orgId } = getParsed<SearchParams>(res, 'params');
  const { q, limit } = getParsed<SearchQuery>(res, 'query');
  const user = requireUser(req);
  const access = getOrgAccess(res);

  const results = await searchTasks(
    {
      orgId,
      userId: user.id,
      // A global admin resolves to org `admin` in the guard, so this one flag
      // covers both "sees everything" cases.
      seesWholeOrg: access.role === 'admin',
    },
    q,
    limit,
  );
  respond(res, results);
}
