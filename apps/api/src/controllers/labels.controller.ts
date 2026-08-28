/** `/api/projects/:projectId/labels`. */
import type { Request, Response } from 'express';

import { requireUser } from '../middlewares/require-auth';
import { getProjectAccess } from '../middlewares/require-roles';
import { getSocketId } from '../middlewares/socket-id';
import { getParsed } from '../middlewares/validate';
import * as labelsService from '../services/labels.service';
import type { ActorContext } from '../services/projects.service';
import { respond, respondNoContent } from '../utils/respond';
import type {
  CreateLabelBody,
  LabelParams,
  UpdateLabelBody,
} from '../validation/labels.validation';

function actorContext(req: Request, res: Response): ActorContext {
  return { actorId: requireUser(req).id, socketId: getSocketId(res) };
}

/** `GET /labels` — any project viewer. */
export async function listLabels(_req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  respond(res, await labelsService.listLabels(access.projectId));
}

/** `POST /labels` — project member. */
export async function createLabel(req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  const body = getParsed<CreateLabelBody>(res);
  respond(
    res,
    await labelsService.createLabel(access.projectId, body, actorContext(req, res)),
    undefined,
    201,
  );
}

/** `PATCH /labels/:labelId` — project member. */
export async function updateLabel(req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  const { labelId } = getParsed<LabelParams>(res, 'params');
  const body = getParsed<UpdateLabelBody>(res);
  respond(
    res,
    await labelsService.updateLabel(access.projectId, labelId, body, actorContext(req, res)),
  );
}

/** `DELETE /labels/:labelId` — project member; cascades `task_labels`. */
export async function deleteLabel(req: Request, res: Response): Promise<void> {
  const access = getProjectAccess(res);
  const { labelId } = getParsed<LabelParams>(res, 'params');
  await labelsService.deleteLabel(access.projectId, labelId, actorContext(req, res));
  respondNoContent(res);
}
