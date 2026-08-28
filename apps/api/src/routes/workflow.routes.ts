/**
 * The per-project workflow editor — mounted by `projects.routes.ts` at
 * `/api/projects/:projectId`, so its paths are `/statuses` and `/transitions`.
 *
 * `PUT /statuses/order` is declared BEFORE `/statuses/:statusId` on purpose:
 * nothing today routes a PUT to the parameterised path, but if one is ever
 * added, `order` must not be swallowed as a status id.
 *
 * Reads are `viewer` (the board needs its columns before it can draw a card);
 * every mutation is `admin` — a workflow is project configuration, and a member
 * who could silently retire a column would be editing everyone's board.
 */
import { Router } from 'express';

import {
  createStatus,
  deleteStatus,
  listStatuses,
  listTransitions,
  reorderStatuses,
  replaceTransitions,
  updateStatus,
} from '../controllers/workflow.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireProjectRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  createStatusInputSchema,
  deleteStatusBodySchema,
  reorderStatusesInputSchema,
  replaceTransitionsInputSchema,
  statusParamsSchema,
  updateStatusInputSchema,
  workflowParamsSchema,
} from '../validation/workflow.validation';

export const workflowRouter: Router = Router({ mergeParams: true });

workflowRouter.use(requireAuth);

// ── Statuses (board columns) ────────────────────────────────────────────────
workflowRouter.get(
  '/statuses',
  validate(workflowParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  asyncHandler(listStatuses),
);

workflowRouter.post(
  '/statuses',
  validate(workflowParamsSchema, 'params'),
  requireProjectRole('admin', 'projectId'),
  validate(createStatusInputSchema),
  asyncHandler(createStatus),
);

workflowRouter.put(
  '/statuses/order',
  validate(workflowParamsSchema, 'params'),
  requireProjectRole('admin', 'projectId'),
  validate(reorderStatusesInputSchema),
  asyncHandler(reorderStatuses),
);

workflowRouter.patch(
  '/statuses/:statusId',
  validate(statusParamsSchema, 'params'),
  requireProjectRole('admin', 'projectId'),
  validate(updateStatusInputSchema),
  asyncHandler(updateStatus),
);

workflowRouter.delete(
  '/statuses/:statusId',
  validate(statusParamsSchema, 'params'),
  requireProjectRole('admin', 'projectId'),
  validate(deleteStatusBodySchema),
  asyncHandler(deleteStatus),
);

// ── Transitions (the per-source whitelist) ──────────────────────────────────
workflowRouter.get(
  '/transitions',
  validate(workflowParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  asyncHandler(listTransitions),
);

workflowRouter.put(
  '/transitions',
  validate(workflowParamsSchema, 'params'),
  requireProjectRole('admin', 'projectId'),
  validate(replaceTransitionsInputSchema),
  asyncHandler(replaceTransitions),
);
