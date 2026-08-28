/**
 * Command-palette search. Mount at the API root:
 * `apiRouter.use('/', searchRouter)`.
 *
 * Guarded at the ORG floor (`member`) rather than per project: the whole point
 * is to search across projects, so the per-project filtering happens inside the
 * query instead — a member sees only the projects they belong to, an org or
 * global admin sees all of them.
 */
import { Router } from 'express';

import { searchOrgTasks } from '../controllers/search.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireOrgRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import { searchParamsSchema, searchQuerySchema } from '../validation/search.validation';

export const searchRouter: Router = Router();

// Scoped to the prefix this router owns — see `tasks.routes.ts` for why a
// root-stacked router must not guard paths it does not answer.
searchRouter.use('/orgs/:orgId/search', requireAuth);

searchRouter.get(
  '/orgs/:orgId/search',
  validate(searchParamsSchema, 'params'),
  requireOrgRole('member'),
  validate(searchQuerySchema, 'query'),
  asyncHandler(searchOrgTasks),
);
