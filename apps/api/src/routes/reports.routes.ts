/**
 * Project reports. Mount at the API root: `apiRouter.use('/', reportsRouter)`.
 *
 * All six are reads at the `viewer` floor — a stakeholder who cannot move a
 * card can still read the burndown.
 */
import { Router } from 'express';

import {
  getBurndown,
  getBurnup,
  getCumulativeFlow,
  getCycleTime,
  getVelocity,
  getWorkload,
} from '../controllers/reports.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireProjectRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  reportParamsSchema,
  reportRangeQuerySchema,
  sprintReportQuerySchema,
} from '../validation/reports.validation';

export const reportsRouter: Router = Router();

const base = '/projects/:projectId/reports';

// Scoped to the prefix this router owns — see `tasks.routes.ts` for why a
// root-stacked router must not guard paths it does not answer.
reportsRouter.use(base, requireAuth);

reportsRouter.get(
  `${base}/burndown`,
  validate(reportParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  validate(sprintReportQuerySchema, 'query'),
  asyncHandler(getBurndown),
);

reportsRouter.get(
  `${base}/burnup`,
  validate(reportParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  validate(sprintReportQuerySchema, 'query'),
  asyncHandler(getBurnup),
);

reportsRouter.get(
  `${base}/cumulative-flow`,
  validate(reportParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  validate(reportRangeQuerySchema, 'query'),
  asyncHandler(getCumulativeFlow),
);

reportsRouter.get(
  `${base}/velocity`,
  validate(reportParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  asyncHandler(getVelocity),
);

reportsRouter.get(
  `${base}/cycle-time`,
  validate(reportParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  validate(reportRangeQuerySchema, 'query'),
  asyncHandler(getCycleTime),
);

reportsRouter.get(
  `${base}/workload`,
  validate(reportParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  asyncHandler(getWorkload),
);
