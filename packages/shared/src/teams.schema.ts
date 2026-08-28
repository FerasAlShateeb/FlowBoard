// Team contracts. Teams are an ORGANIZATIONAL grouping, not a permission
// boundary: a project may name an owning team for filtering and reporting, but
// access is still decided by `project_members` + the org-admin widening rule.
// That is deliberate — making teams grant access would give FlowBoard two
// competing permission systems.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { isoDateTime, uuid } from './common';
import { nameSchema, userSummarySchema } from './users.schema';
import { VM_TOO_LONG, VM_UPDATE_AT_LEAST_ONE_FIELD } from './validation-messages';

/** Optional free-text blurb shown under a team's name. */
export const teamDescriptionSchema = z.string().trim().max(500, VM_TOO_LONG).nullable();

/** A team row inside an organization. */
export const teamSchema = z.object({
  id: uuid,
  orgId: uuid,
  name: nameSchema,
  description: teamDescriptionSchema,
  memberCount: z.number().int().nonnegative(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Team = z.infer<typeof teamSchema>;

/** A row of `GET /orgs/:orgId/teams/:teamId/members`. */
export const teamMemberSchema = z.object({
  teamId: uuid,
  user: userSummarySchema,
  joinedAt: isoDateTime,
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

/** `GET /orgs/:orgId/teams/:teamId` — the team plus its roster. */
export const teamDetailSchema = teamSchema.extend({
  members: z.array(teamMemberSchema),
});
export type TeamDetail = z.infer<typeof teamDetailSchema>;

/** `POST /orgs/:orgId/teams`. */
export const createTeamInputSchema = z.object({
  name: nameSchema,
  description: teamDescriptionSchema.default(null),
});
export type CreateTeamInput = z.infer<typeof createTeamInputSchema>;

/** `PATCH /orgs/:orgId/teams/:teamId` — at least one field required. */
export const updateTeamInputSchema = z
  .object({
    name: nameSchema,
    description: teamDescriptionSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: VM_UPDATE_AT_LEAST_ONE_FIELD });
export type UpdateTeamInput = z.infer<typeof updateTeamInputSchema>;

/**
 * `PUT /orgs/:orgId/teams/:teamId/members` — the roster is replaced WHOLESALE
 * rather than diffed with add/remove calls. A multi-select UI produces a final
 * set, and a whole-set PUT makes that one idempotent request instead of a
 * partially-applied burst; an empty array is legal and means "no members".
 */
export const replaceTeamMembersInputSchema = z.object({
  userIds: z.array(uuid),
});
export type ReplaceTeamMembersInput = z.infer<typeof replaceTeamMembersInputSchema>;
