/**
 * Org-invite management. Mount at `/api/orgs/:orgId/invites`.
 *
 *   GET    /                 org admin
 *   POST   /                 org admin
 *   DELETE /:inviteId        org admin
 *
 * `mergeParams: true` is load-bearing: `:orgId` belongs to the MOUNT path, and
 * without it neither `requireOrgRole` nor the params schema can see it.
 *
 * The public half of the invite flow (preview, accept) is deliberately NOT
 * here — it hangs off `/api/auth`, because its caller has no org yet and
 * therefore cannot pass an org guard.
 */
import { Router } from 'express';
import { createInviteInputSchema } from '@flowboard/shared';

import * as invitesController from '../controllers/invites.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireOrgRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import { orgInviteIdParamsSchema, orgInviteParamsSchema } from '../validation/invites.validation';

export const invitesRouter: Router = Router({ mergeParams: true });

// Managing who can get into an org is an admin action, not a member one — so
// the guard is router-wide rather than per-route.
invitesRouter.use(requireAuth, requireOrgRole('admin'));

invitesRouter.get(
  '/',
  validate(orgInviteParamsSchema, 'params'),
  asyncHandler(invitesController.listInvites),
);

invitesRouter.post(
  '/',
  validate(orgInviteParamsSchema, 'params'),
  validate(createInviteInputSchema, 'body'),
  asyncHandler(invitesController.createInvite),
);

invitesRouter.delete(
  '/:inviteId',
  validate(orgInviteIdParamsSchema, 'params'),
  asyncHandler(invitesController.revokeInvite),
);
