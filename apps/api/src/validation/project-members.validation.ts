/** Request validation for `/api/projects/:projectId/members`. */
import { z } from 'zod';
import {
  addProjectMemberInputSchema,
  updateProjectMemberInputSchema,
  uuid,
} from '@flowboard/shared';

/** `/api/projects/:projectId/members`. */
export const projectMembersParamsSchema = z.object({ projectId: uuid });
export type ProjectMembersParams = z.infer<typeof projectMembersParamsSchema>;

/** `/api/projects/:projectId/members/:userId`. */
export const projectMemberParamsSchema = z.object({ projectId: uuid, userId: uuid });
export type ProjectMemberParams = z.infer<typeof projectMemberParamsSchema>;

export { addProjectMemberInputSchema, updateProjectMemberInputSchema };
export type AddProjectMemberBody = z.infer<typeof addProjectMemberInputSchema>;
export type UpdateProjectMemberBody = z.infer<typeof updateProjectMemberInputSchema>;
