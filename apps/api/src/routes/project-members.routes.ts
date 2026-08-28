/**
 * Project membership — mounted by `projects.routes.ts` at
 * `/api/projects/:projectId/members`.
 *
 * Reads are `viewer`, writes are `admin`: who may see a project is project
 * configuration, not day-to-day work.
 */
import { Router } from 'express';

import {
  addProjectMember,
  listProjectMembers,
  removeProjectMember,
  updateProjectMember,
} from '../controllers/project-members.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireProjectRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  addProjectMemberInputSchema,
  projectMemberParamsSchema,
  projectMembersParamsSchema,
  updateProjectMemberInputSchema,
} from '../validation/project-members.validation';

export const projectMembersRouter: Router = Router({ mergeParams: true });

projectMembersRouter.use(requireAuth);

projectMembersRouter.get(
  '/',
  validate(projectMembersParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  asyncHandler(listProjectMembers),
);

projectMembersRouter.post(
  '/',
  validate(projectMembersParamsSchema, 'params'),
  requireProjectRole('admin', 'projectId'),
  validate(addProjectMemberInputSchema),
  asyncHandler(addProjectMember),
);

projectMembersRouter.patch(
  '/:userId',
  validate(projectMemberParamsSchema, 'params'),
  requireProjectRole('admin', 'projectId'),
  validate(updateProjectMemberInputSchema),
  asyncHandler(updateProjectMember),
);

projectMembersRouter.delete(
  '/:userId',
  validate(projectMemberParamsSchema, 'params'),
  requireProjectRole('admin', 'projectId'),
  asyncHandler(removeProjectMember),
);
