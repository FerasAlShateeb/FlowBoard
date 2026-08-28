/** `/api/orgs/:orgId/teams` — envelope adapters over `teams.service`. */
import type { Request, Response } from 'express';

import { getOrgAccess } from '../middlewares/require-roles';
import { getParsed } from '../middlewares/validate';
import * as teamsService from '../services/teams.service';
import { respond, respondNoContent } from '../utils/respond';
import type {
  CreateTeamBody,
  ReplaceTeamMembersBody,
  TeamParams,
  UpdateTeamBody,
} from '../validation/teams.validation';

/** `GET /api/orgs/:orgId/teams` — any org member. */
export async function listTeams(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  respond(res, await teamsService.listTeams(access.orgId));
}

/** `GET /api/orgs/:orgId/teams/:teamId` — any org member. */
export async function getTeam(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  const { teamId } = getParsed<TeamParams>(res, 'params');
  respond(res, await teamsService.getTeamDetail(access.orgId, teamId));
}

/** `POST /api/orgs/:orgId/teams` — org admin. */
export async function createTeam(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  const body = getParsed<CreateTeamBody>(res);
  respond(res, await teamsService.createTeam(access.orgId, body), undefined, 201);
}

/** `PATCH /api/orgs/:orgId/teams/:teamId` — org admin. */
export async function updateTeam(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  const { teamId } = getParsed<TeamParams>(res, 'params');
  const body = getParsed<UpdateTeamBody>(res);
  respond(res, await teamsService.updateTeam(access.orgId, teamId, body));
}

/** `DELETE /api/orgs/:orgId/teams/:teamId` — org admin, soft + project detach. */
export async function deleteTeam(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  const { teamId } = getParsed<TeamParams>(res, 'params');
  await teamsService.softDeleteTeam(access.orgId, teamId);
  respondNoContent(res);
}

/** `PUT /api/orgs/:orgId/teams/:teamId/members` — org admin, whole-set replace. */
export async function replaceTeamMembers(_req: Request, res: Response): Promise<void> {
  const access = getOrgAccess(res);
  const { teamId } = getParsed<TeamParams>(res, 'params');
  const body = getParsed<ReplaceTeamMembersBody>(res);
  respond(res, await teamsService.replaceTeamMembers(access.orgId, teamId, body.userIds));
}
