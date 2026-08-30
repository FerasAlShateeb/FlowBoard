/**
 * `/api/orgs` — organizations, their membership, and the two org-scoped
 * sub-routers (teams and the project list/create pair).
 *
 * Role floors, per the plan's guard table:
 *   - `requireGlobalAdmin` for create and delete — an organization is tenancy,
 *     not content, so its lifecycle is platform surface.
 *   - `requireOrgRole('admin')` for settings and membership.
 *   - `requireOrgRole('member')` for every read.
 *
 * `GET /` is the one route with no org in scope: it answers from the caller's
 * own membership rows, so `requireAuth` is the whole guard.
 */
import { Router } from 'express';

import {
  addOrgMember,
  createOrg,
  deleteOrg,
  getOrg,
  listMyOrgs,
  listOrgMembers,
  listOrgUsers,
  removeOrgMember,
  restoreOrg,
  updateOrg,
  updateOrgMember,
} from '../controllers/orgs.controller';
import { requireAuth, requireGlobalAdmin } from '../middlewares/require-auth';
import { requireOrgRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  addOrgMemberBodySchema,
  createOrgBodySchema,
  orgListQuerySchema,
  orgMemberParamsSchema,
  orgParamsSchema,
  updateMemberInputSchema,
  updateOrgInputSchema,
  userListQuerySchema,
} from '../validation/orgs.validation';
import { orgProjectsRouter } from './projects.routes';
import { teamsRouter } from './teams.routes';

export const orgsRouter: Router = Router();

orgsRouter.use(requireAuth);

// ── The org itself ──────────────────────────────────────────────────────────
orgsRouter.get('/', validate(orgListQuerySchema, 'query'), asyncHandler(listMyOrgs));

orgsRouter.post('/', requireGlobalAdmin, validate(createOrgBodySchema), asyncHandler(createOrg));

orgsRouter.get(
  '/:orgId',
  validate(orgParamsSchema, 'params'),
  requireOrgRole('member'),
  asyncHandler(getOrg),
);

orgsRouter.patch(
  '/:orgId',
  validate(orgParamsSchema, 'params'),
  requireOrgRole('admin'),
  validate(updateOrgInputSchema),
  asyncHandler(updateOrg),
);

orgsRouter.delete(
  '/:orgId',
  validate(orgParamsSchema, 'params'),
  requireGlobalAdmin,
  asyncHandler(deleteOrg),
);

/**
 * Un-archive. `requireGlobalAdmin` and NOT `requireOrgRole('admin')`, which is
 * not a copy-paste slip: the role guard resolves the org through the same
 * `deleted_at IS NULL` filter every other read uses, so it would 404 the exact
 * rows this route exists to act on. An organization's lifecycle is tenancy, not
 * content — the same floor as create and delete.
 */
orgsRouter.post(
  '/:orgId/restore',
  validate(orgParamsSchema, 'params'),
  requireGlobalAdmin,
  asyncHandler(restoreOrg),
);

// ── Membership ──────────────────────────────────────────────────────────────
orgsRouter.get(
  '/:orgId/members',
  validate(orgParamsSchema, 'params'),
  requireOrgRole('member'),
  validate(userListQuerySchema, 'query'),
  asyncHandler(listOrgMembers),
);

orgsRouter.post(
  '/:orgId/members',
  validate(orgParamsSchema, 'params'),
  requireOrgRole('admin'),
  validate(addOrgMemberBodySchema),
  asyncHandler(addOrgMember),
);

orgsRouter.patch(
  '/:orgId/members/:userId',
  validate(orgMemberParamsSchema, 'params'),
  requireOrgRole('admin'),
  validate(updateMemberInputSchema),
  asyncHandler(updateOrgMember),
);

orgsRouter.delete(
  '/:orgId/members/:userId',
  validate(orgMemberParamsSchema, 'params'),
  requireOrgRole('admin'),
  asyncHandler(removeOrgMember),
);

/**
 * The lightweight directory behind assignee pickers and `@mention`
 * autocomplete. Separate from `/members` because it is read on every keystroke
 * and carries no join metadata — and because it hides deactivated accounts,
 * which the members table must still show.
 */
orgsRouter.get(
  '/:orgId/users',
  validate(orgParamsSchema, 'params'),
  requireOrgRole('member'),
  validate(userListQuerySchema, 'query'),
  asyncHandler(listOrgUsers),
);

// ── Org-scoped sub-routers ──────────────────────────────────────────────────
orgsRouter.use('/:orgId/teams', teamsRouter);
orgsRouter.use('/:orgId/projects', orgProjectsRouter);
