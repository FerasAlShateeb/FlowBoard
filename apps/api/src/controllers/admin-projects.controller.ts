/**
 * `/api/admin/projects` — the cross-organization project list.
 *
 * Pagination lives in the envelope's `meta` block, never in the payload, so
 * `data` stays a plain array the client can map over — the same split as
 * `admin-users.controller.ts`.
 */
import type { Request, Response } from 'express';

import { getParsed } from '../middlewares/validate';
import * as adminProjectsService from '../services/admin-projects.service';
import { respond } from '../utils/respond';
import type { AdminProjectsListQuery } from '../validation/admin-projects.validation';

/** `GET /api/admin/projects?q&orgId&includeArchived&page&pageSize&sort`. */
export async function listProjects(_req: Request, res: Response): Promise<void> {
  const query = getParsed<AdminProjectsListQuery>(res, 'query');
  const page = await adminProjectsService.listProjects(query);
  respond(res, page.rows, page.meta);
}
