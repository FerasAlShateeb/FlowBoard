/**
 * Sprint controllers.
 *
 * `/start` and `/complete` are separate endpoints rather than a `state` field
 * on PATCH because each carries a side effect the contract cannot express:
 * starting stamps the commitment, completing stamps velocity and rehomes every
 * unfinished task.
 */
import type { Request, Response } from 'express';
import type {
  CompleteSprintInput,
  CreateSprintInput,
  SprintListQuery,
  StartSprintInput,
  UpdateSprintInput,
} from '@flowboard/shared';

import { getParsed } from '../middlewares/validate';
import { respond, respondNoContent } from '../utils/respond';
import {
  completeSprint,
  createSprint,
  deleteSprint,
  listSprints,
  startSprint,
  updateSprint,
} from '../services/sprints.service';
import { actorOf, scopeOf } from './tasks.controller';
import type { SprintListParams, SprintParams } from '../validation/sprints.validation';

/** `GET /api/projects/:projectId/sprints?state=`. */
export async function listProjectSprints(_req: Request, res: Response): Promise<void> {
  const { projectId } = getParsed<SprintListParams>(res, 'params');
  const { state } = getParsed<SprintListQuery>(res, 'query');
  respond(res, await listSprints(projectId, state));
}

/** `POST /api/projects/:projectId/sprints` — created `planned`. */
export async function createProjectSprint(req: Request, res: Response): Promise<void> {
  const input = getParsed<CreateSprintInput>(res);
  respond(res, await createSprint(scopeOf(res), actorOf(req, res), input), undefined, 201);
}

/** `PATCH /api/sprints/:sprintId`. */
export async function patchSprint(req: Request, res: Response): Promise<void> {
  const { sprintId } = getParsed<SprintParams>(res, 'params');
  const input = getParsed<UpdateSprintInput>(res);
  respond(res, await updateSprint(scopeOf(res), actorOf(req, res), sprintId, input));
}

/** `DELETE /api/sprints/:sprintId` — returns its tasks to the backlog first. */
export async function removeSprint(req: Request, res: Response): Promise<void> {
  const { sprintId } = getParsed<SprintParams>(res, 'params');
  await deleteSprint(scopeOf(res), actorOf(req, res), sprintId);
  respondNoContent(res);
}

/** `POST /api/sprints/:sprintId/start` — stamps `committedPoints`. */
export async function postSprintStart(req: Request, res: Response): Promise<void> {
  const { sprintId } = getParsed<SprintParams>(res, 'params');
  const input = getParsed<StartSprintInput>(res);
  respond(res, await startSprint(scopeOf(res), actorOf(req, res), sprintId, input));
}

/** `POST /api/sprints/:sprintId/complete` — stamps `completedPoints`. */
export async function postSprintComplete(req: Request, res: Response): Promise<void> {
  const { sprintId } = getParsed<SprintParams>(res, 'params');
  const input = getParsed<CompleteSprintInput>(res);
  respond(res, await completeSprint(scopeOf(res), actorOf(req, res), sprintId, input));
}
