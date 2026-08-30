/**
 * `/api/orgs` — thin HTTP adapters. Every handler does exactly three things:
 * read the validated request, call one service, `respond()`. No database access
 * and no membership arithmetic: the guard already resolved the caller's role
 * into `res.locals`, and `getOrgAccess` reads it back typed.
 */
import type { Request, Response } from 'express';

import { getOrgAccess } from '../middlewares/require-roles';
import { requireUser } from '../middlewares/require-auth';
import { getParsed } from '../middlewares/validate';
import * as orgsService from '../services/orgs.service';
import { respond, respondNoContent } from '../utils/respond';
import type {
  AddOrgMemberBody,
  CreateOrgBody,
  OrgListQuery,
  OrgMemberParams,
  OrgParams,
  OrgUserListQuery,
  UpdateOrgBody,
  UpdateOrgMemberBody,
} from '../validation/orgs.validation';

/**
 * `GET /api/orgs?q=&scope=&includeDeleted=` — every org the caller can reach.
 *
 * Two response SHAPES behind one path (`OrgWithRole[]` for the switcher,
 * `OrgAdminRow[]` for the admin table under `includeDeleted`). The choice is the
 * service's, not this handler's: it depends on the caller's global-admin flag,
 * which is authorization, and authorization decisions do not belong in an
 * adapter.
 */
export async function listMyOrgs(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = getParsed<OrgListQuery>(res, 'query');
  respond(res, await orgsService.listOrgs(user, query));
}

/** `POST /api/orgs` — global admin. */
export async function createOrg(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = getParsed<CreateOrgBody>(res);
  respond(res, await orgsService.createOrg(body, user), undefined, 201);
}

/** `GET /api/orgs/:orgId` — any org member. */
export async function getOrg(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  respond(res, await orgsService.getOrgDetail(access.orgId, access.role));
}

/** `PATCH /api/orgs/:orgId` — org admin. */
export async function updateOrg(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  const body = getParsed<UpdateOrgBody>(res);
  respond(res, await orgsService.updateOrg(access.orgId, body, access.role));
}

/** `DELETE /api/orgs/:orgId` — global admin, soft. */
export async function deleteOrg(_req: Request, res: Response): Promise<void> {
  const { orgId } = getParsed<OrgParams>(res, 'params');
  await orgsService.softDeleteOrg(orgId);
  respondNoContent(res);
}

/**
 * `POST /api/orgs/:orgId/restore` — global admin, the undo of the soft delete.
 *
 * Answers with the ADMIN row rather than 204: the caller is the archived-orgs
 * table, and handing back the restored row lets it patch its cache in place
 * instead of refetching a list the user is still looking at.
 */
export async function restoreOrg(_req: Request, res: Response): Promise<void> {
  const { orgId } = getParsed<OrgParams>(res, 'params');
  respond(res, await orgsService.restoreOrg(orgId));
}

/** `GET /api/orgs/:orgId/members` — any org member. */
export async function listOrgMembers(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  const query = getParsed<OrgUserListQuery>(res, 'query');
  respond(res, await orgsService.listOrgMembers(access.orgId, query));
}

/** `POST /api/orgs/:orgId/members` — org admin. */
export async function addOrgMember(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  const body = getParsed<AddOrgMemberBody>(res);
  respond(res, await orgsService.addOrgMember(access.orgId, body), undefined, 201);
}

/** `PATCH /api/orgs/:orgId/members/:userId` — org admin. */
export async function updateOrgMember(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  const { userId } = getParsed<OrgMemberParams>(res, 'params');
  const body = getParsed<UpdateOrgMemberBody>(res);
  respond(res, await orgsService.updateOrgMemberRole(access.orgId, userId, body.role));
}

/** `DELETE /api/orgs/:orgId/members/:userId` — org admin. */
export async function removeOrgMember(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  const { userId } = getParsed<OrgMemberParams>(res, 'params');
  await orgsService.removeOrgMember(access.orgId, userId);
  respondNoContent(res);
}

/** `GET /api/orgs/:orgId/users` — the picker/mention directory. */
export async function listOrgUsers(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  const query = getParsed<OrgUserListQuery>(res, 'query');
  respond(res, await orgsService.listOrgUsers(access.orgId, query));
}
