/**
 * The per-task activity feed. Mount at the API root:
 * `apiRouter.use('/', taskActivityRouter)`.
 *
 * ROOT-STACKED, like the rest of the task domain, because it carries its own
 * full path (`/tasks/:taskId/activity`). Express falls through a router with no
 * matching route, so stacking it alongside the other root-mounted routers costs
 * one miss per unmatched request and keeps `routes/index.ts` a one-line change.
 *
 * `requireAuth` IS SCOPED TO `/tasks`, not applied router-wide — the same rule
 * `tasks.routes.ts` documents. A bare `use(requireAuth)` on a root-stacked
 * router runs for every request that reaches it, including `/api/does-not-exist`,
 * which would then answer 401 instead of the 404 envelope `app.ts`'s `notFound`
 * exists to produce (`__tests__/router-mounting.test.ts` asserts exactly that).
 * A `use()` path matches by PREFIX, so `/tasks` still covers the route below.
 *
 * ORDER OF MIDDLEWARE IS NORMATIVE:
 *   `validate(params)` → `requireProjectRole(...)` → `validate(query)`
 * Params first so a malformed uuid is a 422 at the boundary rather than reaching
 * the guard's `WHERE id = 'not-a-uuid'` and surfacing as a 500.
 *
 * The floor is `viewer`: the audit stream is a READ of work a viewer can already
 * see, and it is the same floor the project feed uses. `requireProjectRole`
 * resolves the project from `:taskId` through `tasks → projects` with both
 * soft-delete filters applied, so a deleted task 404s here instead of answering
 * with the history of something that no longer exists.
 */
import { Router } from 'express';

import { listTaskActivityFeed } from '../controllers/task-activity.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireProjectRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  taskActivityParamsSchema,
  taskActivityQuerySchema,
} from '../validation/task-activity.validation';

export const taskActivityRouter: Router = Router();

taskActivityRouter.use('/tasks', requireAuth);

taskActivityRouter.get(
  '/tasks/:taskId/activity',
  validate(taskActivityParamsSchema, 'params'),
  requireProjectRole('viewer', 'taskId'),
  validate(taskActivityQuerySchema, 'query'),
  asyncHandler(listTaskActivityFeed),
);
