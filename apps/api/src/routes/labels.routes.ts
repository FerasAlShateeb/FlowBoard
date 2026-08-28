/**
 * Project labels — mounted by `projects.routes.ts` at
 * `/api/projects/:projectId/labels`.
 *
 * Writes sit at the `member` floor, not `admin`: tagging work is part of doing
 * the work. A `viewer` still cannot create, rename or delete a label.
 */
import { Router } from 'express';

import {
  createLabel,
  deleteLabel,
  listLabels,
  updateLabel,
} from '../controllers/labels.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireProjectRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  createLabelInputSchema,
  labelListParamsSchema,
  labelParamsSchema,
  updateLabelInputSchema,
} from '../validation/labels.validation';

export const labelsRouter: Router = Router({ mergeParams: true });

labelsRouter.use(requireAuth);

labelsRouter.get(
  '/',
  validate(labelListParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  asyncHandler(listLabels),
);

labelsRouter.post(
  '/',
  validate(labelListParamsSchema, 'params'),
  requireProjectRole('member', 'projectId'),
  validate(createLabelInputSchema),
  asyncHandler(createLabel),
);

labelsRouter.patch(
  '/:labelId',
  validate(labelParamsSchema, 'params'),
  requireProjectRole('member', 'projectId'),
  validate(updateLabelInputSchema),
  asyncHandler(updateLabel),
);

labelsRouter.delete(
  '/:labelId',
  validate(labelParamsSchema, 'params'),
  requireProjectRole('member', 'projectId'),
  asyncHandler(deleteLabel),
);
