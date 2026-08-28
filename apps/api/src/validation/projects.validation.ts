/**
 * Request validation for the project routes, which live on two different mounts:
 * `/api/orgs/:orgId/projects` (list + create, org-scoped) and
 * `/api/projects/:projectId` (read + update + delete, project-scoped).
 */
import { z } from 'zod';
import {
  booleanQuery,
  createProjectInputSchema,
  updateProjectInputSchema,
  uuid,
} from '@flowboard/shared';

/** `/api/orgs/:orgId/projects`. */
export const orgProjectsParamsSchema = z.object({ orgId: uuid });
export type OrgProjectsParams = z.infer<typeof orgProjectsParamsSchema>;

/** `/api/projects/:projectId` and everything nested under it. */
export const projectParamsSchema = z.object({ projectId: uuid });
export type ProjectParams = z.infer<typeof projectParamsSchema>;

/**
 * `GET /api/orgs/:orgId/projects?includeArchived=`.
 *
 * "Archived" is FlowBoard's user-facing word for a soft-deleted project: the row
 * keeps its tasks and history, it just leaves the project picker. Default
 * `false` is what makes every ordinary list call filter `deleted_at IS NULL`
 * without asking.
 */
export const projectListQuerySchema = z.object({
  includeArchived: booleanQuery.default(false),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export { createProjectInputSchema, updateProjectInputSchema };
export type CreateProjectBody = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectInputSchema>;
