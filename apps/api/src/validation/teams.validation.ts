/**
 * Request validation for `/api/orgs/:orgId/teams`.
 *
 * The team router uses `mergeParams`, so `:orgId` arrives from the parent mount
 * and every params schema here declares BOTH ids — `validate(…, 'params')`
 * replaces the whole params object, and a schema that omitted `orgId` would
 * strip the value `requireOrgRole` is about to read.
 */
import { z } from 'zod';
import {
  createTeamInputSchema,
  replaceTeamMembersInputSchema,
  updateTeamInputSchema,
  uuid,
} from '@flowboard/shared';

/** `/api/orgs/:orgId/teams`. */
export const teamListParamsSchema = z.object({ orgId: uuid });
export type TeamListParams = z.infer<typeof teamListParamsSchema>;

/** `/api/orgs/:orgId/teams/:teamId` and `…/members`. */
export const teamParamsSchema = z.object({ orgId: uuid, teamId: uuid });
export type TeamParams = z.infer<typeof teamParamsSchema>;

export { createTeamInputSchema, replaceTeamMembersInputSchema, updateTeamInputSchema };
export type CreateTeamBody = z.infer<typeof createTeamInputSchema>;
export type UpdateTeamBody = z.infer<typeof updateTeamInputSchema>;
export type ReplaceTeamMembersBody = z.infer<typeof replaceTeamMembersInputSchema>;
