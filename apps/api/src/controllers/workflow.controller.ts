/** `/api/projects/:projectId/{statuses,transitions}` — the workflow editor. */
import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/require-auth';
import { getProjectAccess } from '../middlewares/require-roles';
import { getSocketId } from '../middlewares/socket-id';
import { getParsed } from '../middlewares/validate';
import * as workflowService from '../services/workflow.service';
import type { ActorContext } from '../services/projects.service';
import { respond, respondNoContent } from '../utils/respond';
import type {
  CreateStatusBody,
  DeleteStatusBody,
  ReorderStatusesBody,
  ReplaceTransitionsBody,
  StatusParams,
  UpdateStatusBody,
} from '../validation/workflow.validation';

function actorContext(req: Request, res: Response): ActorContext {
  return { actorId: requireUser(req).id, socketId: getSocketId(res) };
}

/** `GET /statuses` — any project viewer. */
export async function listStatuses(_req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  respond(res, await workflowService.listStatuses(access.projectId));
}

/** `POST /statuses` — project admin. */
export async function createStatus(req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  const body = getParsed<CreateStatusBody>(res);
  respond(
    res,
    await workflowService.createStatus(access.projectId, body, actorContext(req, res)),
    undefined,
    201,
  );
}

/** `PATCH /statuses/:statusId` — project admin. */
export async function updateStatus(req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  const { statusId } = getParsed<StatusParams>(res, 'params');
  const body = getParsed<UpdateStatusBody>(res);
  respond(
    res,
    await workflowService.updateStatus(access.projectId, statusId, body, actorContext(req, res)),
  );
}

/** `DELETE /statuses/:statusId` — project admin; `moveTasksTo` when it holds work. */
export async function deleteStatus(req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  const { statusId } = getParsed<StatusParams>(res, 'params');
  const body = getParsed<DeleteStatusBody>(res);
  await workflowService.deleteStatus(
    access.projectId,
    statusId,
    body.moveTasksTo,
    actorContext(req, res),
  );
  respondNoContent(res);
}

/** `PUT /statuses/order` — project admin, whole-set. */
export async function reorderStatuses(req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  const body = getParsed<ReorderStatusesBody>(res);
  respond(
    res,
    await workflowService.reorderStatuses(access.projectId, body.statusIds, actorContext(req, res)),
  );
}

/** `GET /transitions` — any project viewer. */
export async function listTransitions(_req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  respond(res, await workflowService.listTransitions(access.projectId));
}

/** `PUT /transitions` — project admin, whole-set replace. */
export async function replaceTransitions(req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  const body = getParsed<ReplaceTransitionsBody>(res);
  respond(
    res,
    await workflowService.replaceTransitions(
      access.projectId,
      body.transitions,
      actorContext(req, res),
    ),
  );
}
