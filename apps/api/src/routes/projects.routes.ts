/**
 * Projects, on the two mounts the plan gives them:
 *
 *  - `orgProjectsRouter` → `/api/orgs/:orgId/projects` (list + create; the org
 *    is the scope in which a project key is unique, so create must be
 *    org-addressed). Mounted by `orgs.routes.ts`.
 *  - `projectsRouter` → `/api/projects` (read/update/delete one project) and it
 *    COMPOSES the four project-scoped sub-routers — members, labels, activity
 *    and the workflow editor.
 *
 * Composing here rather than in `routes/index.ts` is what keeps the frozen
 * registry to two `use()` lines for this whole work package, and keeps the
 * `/api/projects/:projectId/**` URL shape owned by one file.
 */
import { Router } from 'express';

import {
  createProject,
  deleteProject,
  getProject,
  listOrgProjects,
  updateProject,
} from '../controllers/projects.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireOrgRole, requireProjectRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  createProjectInputSchema,
  orgProjectsParamsSchema,
  projectListQuerySchema,
  projectParamsSchema,
  updateProjectInputSchema,
} from '../validation/projects.validation';
import { projectActivityRouter } from './activity.routes';
import { labelsRouter } from './labels.routes';
import { projectMembersRouter } from './project-members.routes';
import { workflowRouter } from './workflow.routes';

/** `/api/orgs/:orgId/projects` — mounted by the orgs router. */
export const orgProjectsRouter: Router = Router({ mergeParams: true });

orgProjectsRouter.use(requireAuth);

orgProjectsRouter.get(
  '/',
  validate(orgProjectsParamsSchema, 'params'),
  requireOrgRole('member'),
  validate(projectListQuerySchema, 'query'),
  asyncHandler(listOrgProjects),
);

orgProjectsRouter.post(
  '/',
  validate(orgProjectsParamsSchema, 'params'),
  requireOrgRole('admin'),
  validate(createProjectInputSchema),
  asyncHandler(createProject),
);

/** `/api/projects` — the project-scoped half. */
export const projectsRouter: Router = Router();

projectsRouter.use(requireAuth);

projectsRouter.get(
  '/:projectId',
  validate(projectParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  asyncHandler(getProject),
);

projectsRouter.patch(
  '/:projectId',
  validate(projectParamsSchema, 'params'),
  requireProjectRole('admin', 'projectId'),
  validate(updateProjectInputSchema),
  asyncHandler(updateProject),
);

projectsRouter.delete(
  '/:projectId',
  validate(projectParamsSchema, 'params'),
  requireProjectRole('admin', 'projectId'),
  asyncHandler(deleteProject),
);

// ── Project-scoped sub-routers ──────────────────────────────────────────────
// Each carries its own guards; the workflow router is mounted last because its
// mount path is the bare `/:projectId` prefix.
projectsRouter.use('/:projectId/members', projectMembersRouter);
projectsRouter.use('/:projectId/labels', labelsRouter);
projectsRouter.use('/:projectId/activity', projectActivityRouter);
projectsRouter.use('/:projectId', workflowRouter);
