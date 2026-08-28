/** `/api/projects/:projectId/members`. */
import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/require-auth';
import { getProjectAccess } from '../middlewares/require-roles';
import { getSocketId } from '../middlewares/socket-id';
import { getParsed } from '../middlewares/validate';
import * as membersService from '../services/project-members.service';
import { respond, respondNoContent } from '../utils/respond';
import type {
  AddProjectMemberBody,
  ProjectMemberParams,
  UpdateProjectMemberBody,
} from '../validation/project-members.validation';

/** `GET /api/projects/:projectId/members` — any project viewer. */
export async function listProjectMembers(_req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  respond(res, await membersService.listProjectMembers(access.projectId));
}

/** `POST /api/projects/:projectId/members` — project admin. */
export async function addProjectMember(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const access = getProjectAccess(res);
  const body = getParsed<AddProjectMemberBody>(res);
  const context = { actorId: user.id, socketId: getSocketId(res) };
  respond(
    res,
    await membersService.addProjectMember(access.projectId, access.orgId, body, context),
    undefined,
    201,
  );
}

/** `PATCH /api/projects/:projectId/members/:userId` — project admin. */
export async function updateProjectMember(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const access = getProjectAccess(res);
  const { userId } = getParsed<ProjectMemberParams>(res, 'params');
  const body = getParsed<UpdateProjectMemberBody>(res);
  const callerOutranksProject = await membersService.outranksProject(user, access.orgId);
  respond(
    res,
    await membersService.updateProjectMemberRole(access.projectId, userId, body.role, {
      callerOutranksProject,
    }),
  );
}

/** `DELETE /api/projects/:projectId/members/:userId` — project admin. */
export async function removeProjectMember(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const access = getProjectAccess(res);
  const { userId } = getParsed<ProjectMemberParams>(res, 'params');
  const context = { actorId: user.id, socketId: getSocketId(res) };
  const callerOutranksProject = await membersService.outranksProject(user, access.orgId);
  await membersService.removeProjectMember(access.projectId, userId, context, {
    callerOutranksProject,
  });
  respondNoContent(res);
}
