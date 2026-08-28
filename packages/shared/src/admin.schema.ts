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
import { paginationQuerySchema, uuid } from './common';
import { orgRoleSchema } from './orgs.schema';
import {
  createUserInputSchema,
  emailSchema,
  localeSchema,
  nameSchema,
  userListQuerySchema,
} from './users.schema';
import { VM_UPDATE_AT_LEAST_ONE_FIELD } from './validation-messages';

/** `GET /admin/users?page&pageSize&q&isActive`. */
export const adminUserListQuerySchema = paginationQuerySchema.extend(userListQuerySchema.shape);
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

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
