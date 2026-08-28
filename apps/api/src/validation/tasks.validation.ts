/**
 * Request schemas for the task routes.
 *
 * The body and query contracts come STRAIGHT FROM `@flowboard/shared` — they
 * are the same objects the web app validates its forms with, so a drift between
 * the two ends is impossible by construction. WP2.3's two local supersets (the
 * `?sort` whitelist and the two-directional dependency body) were promoted into
 * the shared package by WP2.5: the Table view offers the sorts and the detail
 * sheet offers both dependency directions, so both are things a client sends.
 *
 * What is left here is what only the server knows: the route-parameter shapes.
 */
import { z } from 'zod';
import { taskKeySchema, uuid } from '@flowboard/shared';

export {
  createDependencyInputSchema,
  createTaskInputSchema,
  moveTaskInputSchema,
  patchTaskInputSchema,
  rankTaskInputSchema,
  taskListQuerySchema,
  taskSortQuerySchema,
  watchTaskInputSchema,
  watcherResponseSchema,
  VM_UPDATE_AT_LEAST_ONE_FIELD,
} from '@flowboard/shared';

export type {
  CreateDependencyInput,
  CreateTaskInput,
  MoveTaskInput,
  PatchTaskInput,
  RankTaskInput,
  TaskListQuery,
  TaskSortQuery,
  WatchTaskInput,
  WatcherResponse,
} from '@flowboard/shared';

// ── Legacy aliases ──────────────────────────────────────────────────────────
// WP2.3's names for the two schemas that are now shared contracts.
export {
  createDependencyInputSchema as dependencyInputSchema,
  taskListQuerySchema as taskListRequestQuerySchema,
} from '@flowboard/shared';
export type {
  CreateDependencyInput as DependencyInputBody,
  TaskListQuery as TaskListRequestQuery,
} from '@flowboard/shared';

// ── Route params ────────────────────────────────────────────────────────────

export const projectParamsSchema = z.object({ projectId: uuid });
export type ProjectParams = z.infer<typeof projectParamsSchema>;

/**
 * `GET /projects/:projectId/tasks/by-key/:taskKey` — the `FLOW-123` deep link.
 *
 * The param is the WHOLE key, not the bare number, because that is what the URL
 * a human pasted actually contains (`/t/FLOW-142`) and what the command palette
 * hands back. Taking the number alone would make the web app parse and split
 * the key before it could fetch, which is one more place for the two ends to
 * disagree about the format.
 *
 * The project prefix is therefore redundant with `:projectId` — and that
 * redundancy is checked, not ignored: the service 404s when `FLOW-12` is
 * requested under CORE's id, rather than silently answering with CORE-12.
 */
export const taskByKeyParamsSchema = z.object({
  projectId: uuid,
  taskKey: taskKeySchema,
});
export type TaskByKeyParams = z.infer<typeof taskByKeyParamsSchema>;

export const taskParamsSchema = z.object({ taskId: uuid });
export type TaskParams = z.infer<typeof taskParamsSchema>;

/**
 * `DELETE /tasks/:taskId/dependencies/:otherTaskId`.
 *
 * Addressed by the OTHER TASK's id rather than the dependency row's id.
 * `taskSchema.dependencies` expands each edge as a `TaskRef`, whose `id` is the
 * task — the row id never reaches the client, so a row-id route would have been
 * unreachable from the UI that needs it. The pair is unique and cycles are
 * refused, so `(taskId, otherTaskId)` identifies at most one edge in either
 * direction.
 */
export const dependencyParamsSchema = z.object({ taskId: uuid, otherTaskId: uuid });
export type DependencyParams = z.infer<typeof dependencyParamsSchema>;
