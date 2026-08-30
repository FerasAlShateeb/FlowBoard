// Global-admin account administration (`/admin/users`).
//
// WHY ITS OWN MODULE rather than living in `users.schema.ts`: provisioning an
// account can also drop it into organizations, so the input needs BOTH the user
// field contracts and `orgRoleSchema`. Putting it in `users.schema.ts` would
// make that file import `orgs.schema.ts`, which already imports it — and a zod
// module cycle is not the harmless kind. Schema constants are evaluated EAGERLY
// at import time, so whichever file the loader reaches second would build its
// objects out of `undefined` fields. This module sits downstream of both and
// closes nothing.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { paginationQuerySchema, slugSchema, uuid } from './common';
import { orgRoleSchema } from './orgs.schema';
import {
  createUserInputSchema,
  emailSchema,
  localeSchema,
  nameSchema,
  userListQuerySchema,
  userSchema,
} from './users.schema';
import { VM_UPDATE_AT_LEAST_ONE_FIELD } from './validation-messages';

/** `GET /admin/users?page&pageSize&q&isActive`. */
export const adminUserListQuerySchema = paginationQuerySchema.extend(userListQuerySchema.shape);
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

/**
 * One organization an account belongs to, as the admin user directory shows it.
 *
 * DENORMALIZED (name + slug, not just the id) because the memberships column
 * renders a row of org chips and the membership dialog links to each org. The
 * alternative — ids plus a client-side join against `GET /orgs` — makes the
 * user table depend on a second query that a non-multi-org deployment may not
 * even populate, and renders raw UUIDs for the beat before it resolves.
 */
export const adminUserMembershipSchema = z.object({
  orgId: uuid,
  orgName: nameSchema,
  orgSlug: slugSchema,
  role: orgRoleSchema,
});
export type AdminUserMembership = z.infer<typeof adminUserMembershipSchema>;

/**
 * A row of `GET /admin/users` — the account plus every organization it is in.
 *
 * WHY THE LIST CARRIES THIS AT ALL. "Which orgs is this person in?" is the
 * question the admin directory exists to answer, and before this row existed
 * `AdminUsersPage` hardcoded `orgMemberships: []` because nothing could tell
 * it. Fetching per row is N+1 on a page that already paginates at 25; the list
 * query joins once and the column is free.
 *
 * Empty is a real, common answer: a freshly provisioned global admin belongs to
 * no organization, and the table must render "none" rather than a spinner.
 */
export const adminUserRowSchema = userSchema.extend({
  memberships: z.array(adminUserMembershipSchema),
});
export type AdminUserRow = z.infer<typeof adminUserRowSchema>;

/**
 * `DELETE /admin/users/:userId` — the result of an ANONYMIZE-AND-DEACTIVATE.
 *
 * FlowBoard never hard-deletes an account. A user id is the author of comments,
 * the actor on activity rows and the assignee of history that has to keep
 * reading correctly; dropping the row would either cascade that history away or
 * leave dangling references. So the row survives with its identity scrubbed —
 * name becomes "Deleted user", the email is rewritten to a unique
 * `deleted+<uuid>@flowboard.invalid` (the address column is unique, so it
 * cannot simply be nulled), the avatar is cleared, `isActive` goes false and
 * `token_version` is bumped, which revokes every live session immediately.
 *
 * The response returns the SCRUBBED row so the client can patch its cache in
 * place instead of refetching, and `membershipsRemoved` so the confirmation can
 * say what access was actually revoked — "removed from 3 organizations" is the
 * part an admin needs to be able to double-check.
 */
export const deleteUserResponseSchema = z.object({
  user: userSchema,
  membershipsRemoved: z.number().int().nonnegative(),
});
export type DeleteUserResponse = z.infer<typeof deleteUserResponseSchema>;

/** One org the new account is dropped into at provisioning time. */
export const provisionMembershipSchema = z.object({
  orgId: uuid,
  role: orgRoleSchema.default('member'),
});
export type ProvisionMembership = z.infer<typeof provisionMembershipSchema>;

/**
 * `POST /admin/users` — {@link createUserInputSchema} plus the org grants the
 * provisioning admin hands out in the same request.
 *
 * One transaction rather than "create, then add member, then add member": the
 * multi-request version has two chances to half-succeed and leave an account
 * that exists but belongs nowhere, which is invisible until the new user signs
 * in to an empty org switcher.
 */
export const provisionUserInputSchema = createUserInputSchema.extend({
  orgMemberships: z.array(provisionMembershipSchema).max(50).default([]),
});
export type ProvisionUserInput = z.infer<typeof provisionUserInputSchema>;

/**
 * `PATCH /admin/users/:userId` — every field optional, at least one required.
 *
 * The field list is RESTATED rather than derived from
 * `updateUserInputSchema`: that schema is `.refine()`d, and a ZodEffects cannot
 * be `.extend()`ed. Keeping the two in sync is the cost of the `forceLogout`
 * lever, which has no place in a self-service profile update.
 *
 * `forceLogout` bumps `token_version`, revoking every access AND refresh token
 * for the account immediately. Setting `isActive: false` does the same thing as
 * a consequence — that is a service-side rule, not a second flag.
 */
export const adminUpdateUserInputSchema = z
  .object({
    email: emailSchema,
    name: nameSchema,
    isGlobalAdmin: z.boolean(),
    isActive: z.boolean(),
    locale: localeSchema,
    /** Revoke every access + refresh token for this account, right now. */
    forceLogout: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: VM_UPDATE_AT_LEAST_ONE_FIELD });
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserInputSchema>;
