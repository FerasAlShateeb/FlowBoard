/**
 * The cross-organization project list. Mount at `/api/admin/projects`, AHEAD of
 * the bare `/admin` mount.
 *
 *   GET /    global admin
 *
 * ── ROUND 2 SEAM (W1.0 → W1.1) ──────────────────────────────────────────────
 * W1.0 created this file with a `notImplemented` body and owns the mount, the
 * guard and the path; **W1.1 filled in the handler** without touching any of
 * them, which is why `__tests__/router-mounting.test.ts` did not have to change
 * across the 501 → 200 transition.
 *
 * WHY IT IS NOT A ROUTE ON `projectsRouter`. `/projects` is org-scoped surface:
 * every route under it resolves a project, then its org, then the caller's
 * membership (`middlewares/require-roles.ts`), and answers 403 for a project the
 * caller is not in. This endpoint asks the opposite question — "every project in
 * the deployment, whoever owns it" — and answering it from inside the router
 * whose entire job is membership scoping would mean a route that skips the
 * guard its siblings depend on. A separate router under `/admin` puts the
 * global-admin floor on the mount, where it cannot be forgotten.
 */
import { Router } from 'express';

import * as adminProjectsController from '../controllers/admin-projects.controller';
import { requireAuth, requireGlobalAdmin } from '../middlewares/require-auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import { adminProjectsListQuerySchema } from '../validation/admin-projects.validation';

export const adminProjectsRouter: Router = Router();

adminProjectsRouter.use(requireAuth, requireGlobalAdmin);

adminProjectsRouter.get(
  '/',
  validate(adminProjectsListQuerySchema, 'query'),
  asyncHandler(adminProjectsController.listProjects),
);
