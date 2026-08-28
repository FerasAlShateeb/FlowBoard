/** `/api/orgs/:orgId/projects` and `/api/projects/:projectId`. */
import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/require-auth';
import { getOrgAccess, getProjectAccess } from '../middlewares/require-roles';
import { getSocketId } from '../middlewares/socket-id';
import { getParsed } from '../middlewares/validate';
import * as projectsService from '../services/projects.service';
import { respond, respondNoContent } from '../utils/respond';
import type {
  CreateProjectBody,
  ProjectListQuery,
  UpdateProjectBody,
} from '../validation/projects.validation';

/** `GET /api/orgs/:orgId/projects` — any org member; role is resolved per row. */
export async function listOrgProjects(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const access = getOrgAccess(res);
  const query = getParsed<ProjectListQuery>(res, 'query');
  respond(res, await projectsService.listProjects(access.orgId, user, access.role, query));
}

/** `POST /api/orgs/:orgId/projects` — org admin; seeds the default workflow. */
export async function createProject(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const access = getOrgAccess(res);
  const body = getParsed<CreateProjectBody>(res);
  respond(res, await projectsService.createProject(access.orgId, body, user), undefined, 201);
}

/** `GET /api/projects/:projectId` — project viewer; the view-boot payload. */
export async function getProject(_req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  respond(res, await projectsService.getProjectDetail(access.projectId, access.role));
}

/** `PATCH /api/projects/:projectId` — project admin. */
export async function updateProject(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const access = getProjectAccess(res);
  const body = getParsed<UpdateProjectBody>(res);
  const context = { actorId: user.id, socketId: getSocketId(res) };
  respond(res, await projectsService.updateProject(access.projectId, body, context, access.role));
}

/** `DELETE /api/projects/:projectId` — project admin, soft. */
export async function deleteProject(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const access = getProjectAccess(res);
  const context = { actorId: user.id, socketId: getSocketId(res) };
  await projectsService.softDeleteProject(access.projectId, context);
  respondNoContent(res);
}
