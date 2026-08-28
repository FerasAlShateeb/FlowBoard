/**
 * Project activity feed — mounted by `projects.routes.ts` at
 * `/api/projects/:projectId/activity`.
 *
 * Read-only by construction: the audit stream is append-only, and the only
 * writer is `services/activity.service.ts`, called from inside each mutation's
 * transaction.
 */
import { Router } from 'express';

import { listActivity } from '../controllers/activity.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireProjectRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import { activityParamsSchema, activityQuerySchema } from '../validation/activity.validation';

export const projectActivityRouter: Router = Router({ mergeParams: true });

projectActivityRouter.use(requireAuth);

projectActivityRouter.get(
  '/',
  validate(activityParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  validate(activityQuerySchema, 'query'),
  asyncHandler(listActivity),
);
