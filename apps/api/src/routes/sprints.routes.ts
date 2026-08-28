/**
 * Sprint routes. Mount at the API root: `apiRouter.use('/', sprintsRouter)`.
 *
 * Planning a sprint is ordinary team work (`member`), but STARTING and
 * COMPLETING one are not: both stamp numbers that are never recomputed and
 * `/complete` moves everybody's unfinished work. Those two sit at the `admin`
 * floor.
 */
import { Router } from 'express';

import {
  createProjectSprint,
  listProjectSprints,
  patchSprint,
  postSprintComplete,
  postSprintStart,
  removeSprint,
} from '../controllers/sprints.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireProjectRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  completeSprintInputSchema,
  createSprintInputSchema,
  sprintListParamsSchema,
  sprintListQuerySchema,
  sprintParamsSchema,
  startSprintInputSchema,
  updateSprintInputSchema,
} from '../validation/sprints.validation';

export const sprintsRouter: Router = Router();

// Scoped to the prefixes this router owns — see `tasks.routes.ts` for why a
// root-stacked router must not guard paths it does not answer.
sprintsRouter.use(['/projects/:projectId/sprints', '/sprints'], requireAuth);

sprintsRouter.get(
  '/projects/:projectId/sprints',
  validate(sprintListParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  validate(sprintListQuerySchema, 'query'),
  asyncHandler(listProjectSprints),
);

sprintsRouter.post(
  '/projects/:projectId/sprints',
  validate(sprintListParamsSchema, 'params'),
  requireProjectRole('member', 'projectId'),
  validate(createSprintInputSchema),
  asyncHandler(createProjectSprint),
);

sprintsRouter.patch(
  '/sprints/:sprintId',
  validate(sprintParamsSchema, 'params'),
  requireProjectRole('member', 'sprintId'),
  validate(updateSprintInputSchema),
  asyncHandler(patchSprint),
);

sprintsRouter.delete(
  '/sprints/:sprintId',
  validate(sprintParamsSchema, 'params'),
  requireProjectRole('member', 'sprintId'),
  asyncHandler(removeSprint),
);

sprintsRouter.post(
  '/sprints/:sprintId/start',
  validate(sprintParamsSchema, 'params'),
  requireProjectRole('admin', 'sprintId'),
  validate(startSprintInputSchema),
  asyncHandler(postSprintStart),
);

sprintsRouter.post(
  '/sprints/:sprintId/complete',
  validate(sprintParamsSchema, 'params'),
  requireProjectRole('admin', 'sprintId'),
  validate(completeSprintInputSchema),
  asyncHandler(postSprintComplete),
);
