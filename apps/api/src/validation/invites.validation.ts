/**
 * Org-invite management shapes (`/api/orgs/:orgId/invites`).
 *
 * Bodies and responses are `@flowboard/shared`'s. WP2.1 kept a local
 * `inviteResponseSchema` that widened `createdBy` to nullable because
 * `invites.invited_by_id` is `ON DELETE SET NULL`; WP2.5 fixed that in the
 * shared contract instead, so the local widening is gone and `InviteResponse`
 * is now just `Invite`.
 *
 * What is left here is the only server-side part: the route params.
 */
import { z } from 'zod';
import { uuid } from '@flowboard/shared';

export { createInviteInputSchema, inviteSchema, inviteStatusSchema } from '@flowboard/shared';
export type { CreateInviteInput, InviteStatus } from '@flowboard/shared';

/** `/api/orgs/:orgId/invites` — the router is `mergeParams`, so `orgId` is present. */
export const orgInviteParamsSchema = z.object({
  orgId: uuid,
});
export type OrgInviteParams = z.infer<typeof orgInviteParamsSchema>;

/** `/api/orgs/:orgId/invites/:inviteId` — revoke. */
export const orgInviteIdParamsSchema = z.object({
  orgId: uuid,
  inviteId: uuid,
});
export type OrgInviteIdParams = z.infer<typeof orgInviteIdParamsSchema>;

/** An invite row as the admin list returns it. */
export { inviteSchema as inviteResponseSchema } from '@flowboard/shared';
export type { Invite as InviteResponse } from '@flowboard/shared';
