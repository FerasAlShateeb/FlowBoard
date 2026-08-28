/**
 * Task routes. Mount at the API root: `apiRouter.use('/', tasksRouter)`.
 *
 * The router carries its own full paths (`/projects/:projectId/tasks`,
 * `/tasks/:taskId`, …) rather than being nested under a prefix, because the
 * task domain lives on BOTH — a collection hangs off the project, an individual
 * task is addressed globally by id. Express falls through a router that has no
 * matching route, so stacking this at `/` alongside the other Wave-2 routers
 * costs nothing and keeps `routes/index.ts` a one-line change.
 *
 * ORDER OF MIDDLEWARE IS NORMATIVE on every route:
 *   `validate(params)` → `requireProjectRole(...)` → `validate(body|query)`
 * Params are parsed FIRST so a malformed uuid is a 422 at the boundary instead
 * of reaching the guard's `WHERE id = 'not-a-uuid'` and surfacing as a 500.
 *
 * Role floors follow the project rule: reads `viewer`, writes `member`.
 * Watching is a READ-side affordance — a viewer is allowed to follow a task
 * they cannot edit.
 */
import { Router } from 'express';

import {
  createProjectTask,
  deleteDependency,
  deleteTaskDetail,
  deleteWatcher,
  getTaskByKey,
  getTaskDetail,
  listDependencies,
  listProjectTasks,
  moveTaskCard,
  patchTaskDetail,
  postDependency,
  putWatcher,
  rankTaskCard,
} from '../controllers/tasks.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireProjectRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  createTaskInputSchema,
  dependencyInputSchema,
  dependencyParamsSchema,
  moveTaskInputSchema,
  patchTaskInputSchema,
  projectParamsSchema,
  rankTaskInputSchema,
  taskByKeyParamsSchema,
  taskListRequestQuerySchema,
  taskParamsSchema,
  watchTaskInputSchema,
} from '../validation/tasks.validation';

export const tasksRouter: Router = Router();

/**
 * `requireAuth` is scoped to the two prefixes this router OWNS rather than
 * applied router-wide.
 *
 * This router is stacked at the API root (`apiRouter.use('/', tasksRouter)`),
 * and a bare `use(requireAuth)` there runs for every request that reaches the
 * router — including `/api/does-not-exist`, which would then answer 401 instead
 * of the 404 envelope `app.ts`'s `notFound` exists to produce. Scoping the
 * guard means an unmatched URL falls through all six root-stacked routers
 * untouched, while every route below is still guarded (a `use()` path matches
 * by PREFIX, so `/tasks` covers `/tasks/:taskId/watchers/me` too).
 */
tasksRouter.use(['/projects/:projectId/tasks', '/tasks'], requireAuth);

// ── Collection, under the project ───────────────────────────────────────────

tasksRouter.get(
  '/projects/:projectId/tasks',
  validate(projectParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  validate(taskListRequestQuerySchema, 'query'),
  asyncHandler(listProjectTasks),
);

tasksRouter.post(
  '/projects/:projectId/tasks',
  validate(projectParamsSchema, 'params'),
  requireProjectRole('member', 'projectId'),
  validate(createTaskInputSchema),
  asyncHandler(createProjectTask),
);

tasksRouter.get(
  '/projects/:projectId/tasks/by-key/:taskKey',
  validate(taskByKeyParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  asyncHandler(getTaskByKey),
);

// ── One task, addressed globally ────────────────────────────────────────────

tasksRouter.get(
  '/tasks/:taskId',
  validate(taskParamsSchema, 'params'),
  requireProjectRole('viewer', 'taskId'),
  asyncHandler(getTaskDetail),
);

tasksRouter.patch(
  '/tasks/:taskId',
  validate(taskParamsSchema, 'params'),
  requireProjectRole('member', 'taskId'),
  validate(patchTaskInputSchema),
  asyncHandler(patchTaskDetail),
);

tasksRouter.delete(
  '/tasks/:taskId',
  validate(taskParamsSchema, 'params'),
  requireProjectRole('member', 'taskId'),
  asyncHandler(deleteTaskDetail),
);

// ── Ordering ────────────────────────────────────────────────────────────────

tasksRouter.post(
  '/tasks/:taskId/move',
  validate(taskParamsSchema, 'params'),
  requireProjectRole('member', 'taskId'),
  validate(moveTaskInputSchema),
  asyncHandler(moveTaskCard),
);

tasksRouter.post(
  '/tasks/:taskId/rank',
  validate(taskParamsSchema, 'params'),
  requireProjectRole('member', 'taskId'),
  validate(rankTaskInputSchema),
  asyncHandler(rankTaskCard),
);

// ── Watchers: `me` only, so nobody can subscribe somebody else ──────────────

tasksRouter.put(
  '/tasks/:taskId/watchers/me',
  validate(taskParamsSchema, 'params'),
  requireProjectRole('viewer', 'taskId'),
  validate(watchTaskInputSchema),
  asyncHandler(putWatcher),
);

tasksRouter.delete(
  '/tasks/:taskId/watchers/me',
  validate(taskParamsSchema, 'params'),
  requireProjectRole('viewer', 'taskId'),
  asyncHandler(deleteWatcher),
);

// ── Dependencies ────────────────────────────────────────────────────────────

/**
 * Project-wide, so it hangs off `/projects/:projectId` rather than `/tasks` —
 * which also means it needs its own `requireAuth`: the `use()` above is scoped
 * to `/projects/:projectId/tasks` and `/tasks`, and a prefix match does not
 * reach a sibling path.
 */
tasksRouter.get(
  '/projects/:projectId/dependencies',
  requireAuth,
  validate(projectParamsSchema, 'params'),
  requireProjectRole('viewer', 'projectId'),
  asyncHandler(listDependencies),
);

tasksRouter.post(
  '/tasks/:taskId/dependencies',
  validate(taskParamsSchema, 'params'),
  requireProjectRole('member', 'taskId'),
  validate(dependencyInputSchema),
  asyncHandler(postDependency),
);

// Addressed by the OTHER TASK's id, not the dependency row's — the row id never
// reaches a client (`taskSchema.dependencies` expands each edge as a `TaskRef`),
// so a row-id route would be unreachable from the panel that needs it.
tasksRouter.delete(
  '/tasks/:taskId/dependencies/:otherTaskId',
  validate(dependencyParamsSchema, 'params'),
  requireProjectRole('member', 'taskId'),
  asyncHandler(deleteDependency),
);
