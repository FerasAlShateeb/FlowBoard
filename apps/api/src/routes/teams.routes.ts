/**
 * Teams — mounted by `orgs.routes.ts` at `/api/orgs/:orgId/teams`.
 *
 * `mergeParams: true` is what lets `requireOrgRole` (which reads `:orgId`) work
 * on a router whose own paths never mention the org.
 *
 * Guard order on every route is the same and is deliberate:
 *   requireAuth → validate(params) → requireOrgRole → validate(body) → handler
 * Params are validated BEFORE the role guard because the guard puts the raw id
 * straight into a `uuid = $1` comparison; without the check, `/teams/nope` is a
 * driver-level 500 rather than a 422.
 */
import { Router } from 'express';

import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  replaceTeamMembers,
  updateTeam,
} from '../controllers/teams.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireOrgRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  createTeamInputSchema,
  replaceTeamMembersInputSchema,
  teamListParamsSchema,
  teamParamsSchema,
  updateTeamInputSchema,
} from '../validation/teams.validation';

export const teamsRouter: Router = Router({ mergeParams: true });

teamsRouter.use(requireAuth);

teamsRouter.get(
  '/',
  validate(teamListParamsSchema, 'params'),
  requireOrgRole('member'),
  asyncHandler(listTeams),
);

teamsRouter.post(
  '/',
  validate(teamListParamsSchema, 'params'),
  requireOrgRole('admin'),
  validate(createTeamInputSchema),
  asyncHandler(createTeam),
);

teamsRouter.get(
  '/:teamId',
  validate(teamParamsSchema, 'params'),
  requireOrgRole('member'),
  asyncHandler(getTeam),
);

teamsRouter.patch(
  '/:teamId',
  validate(teamParamsSchema, 'params'),
  requireOrgRole('admin'),
  validate(updateTeamInputSchema),
  asyncHandler(updateTeam),
);

teamsRouter.delete(
  '/:teamId',
  validate(teamParamsSchema, 'params'),
  requireOrgRole('admin'),
  asyncHandler(deleteTeam),
);

teamsRouter.put(
  '/:teamId/members',
  validate(teamParamsSchema, 'params'),
  requireOrgRole('admin'),
  validate(replaceTeamMembersInputSchema),
  asyncHandler(replaceTeamMembers),
);
