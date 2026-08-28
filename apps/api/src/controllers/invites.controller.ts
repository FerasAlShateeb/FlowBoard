/**
 * Org-invite management controllers (`/api/orgs/:orgId/invites`).
 *
 * The org id comes from `getOrgAccess(res)` rather than `req.params`: the guard
 * already resolved and authorized it, so re-reading the raw param would be a
 * second, unverified source of the same value.
 */
import type { Request, Response } from 'express';
import type { CreateInviteInput } from '@flowboard/shared';

import { getOrgAccess } from '../middlewares/require-roles';
import { requireUser } from '../middlewares/require-auth';
import { getParsed } from '../middlewares/validate';
import { respond, respondNoContent } from '../utils/respond';
import * as invitesService from '../services/invites.service';
import type { OrgInviteIdParams } from '../validation/invites.validation';

/** `GET /api/orgs/:orgId/invites` — pending links plus recently accepted ones. */
export async function listInvites(_req: Request, res: Response): Promise<void> {
  const { orgId } = getOrgAccess(res);
  respond(res, await invitesService.listInvites(orgId));
}

/** `POST /api/orgs/:orgId/invites` — mint a link. Returns the token exactly once. */
export async function createInvite(req: Request, res: Response): Promise<void> {
  const { orgId } = getOrgAccess(res);
  const actor = requireUser(req);
  const input = getParsed<CreateInviteInput>(res, 'body');
  respond(res, await invitesService.createInvite(orgId, actor.id, input), undefined, 201);
}

/** `DELETE /api/orgs/:orgId/invites/:inviteId` — revoke an unspent link. */
export async function revokeInvite(_req: Request, res: Response): Promise<void> {
  const { orgId } = getOrgAccess(res);
  const params = getParsed<OrgInviteIdParams>(res, 'params');
  await invitesService.revokeInvite(orgId, params.inviteId);
  respondNoContent(res);
}
