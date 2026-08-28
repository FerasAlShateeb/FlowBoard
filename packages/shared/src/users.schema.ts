// User contracts: the account row every other contract embeds, plus the
// global-admin provisioning inputs. FlowBoard has NO self-registration — an
// account exists because an admin provisioned it or because someone accepted an
// invite (see `auth.schema.ts`), so the create/update/reset inputs here are all
// admin surface.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { booleanQuery, isoDateTime, uuid } from './common';
import {
  VM_EMAIL_INVALID,
  VM_NAME_MAX,
  VM_NAME_REQUIRED,
  VM_PASSWORD_MAX,
  VM_PASSWORD_MIN,
  VM_UPDATE_AT_LEAST_ONE_FIELD,
  VM_URL_INVALID,
} from './validation-messages';

/** The two shipped UI locales. `ar` implies RTL everywhere in the web app. */
export const localeSchema = z.enum(['en', 'ar']);
export type Locale = z.infer<typeof localeSchema>;

/**
 * Email address, trimmed and lowercased BEFORE the format check (the `users`
 * table has a unique index on `lower(email)`, so the normalized form is the
 * identity). The pipe order matters: normalizing after validating would reject
 * a pasted address with a trailing space.
 */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email(VM_EMAIL_INVALID));
export type Email = z.infer<typeof emailSchema>;

/** A human display name (user, org, team, project, sprint, label, status). */
export const nameSchema = z.string().trim().min(1, VM_NAME_REQUIRED).max(120, VM_NAME_MAX);
export type Name = z.infer<typeof nameSchema>;

/**
 * A plaintext password on its way to the hasher.
 *
 * FlowBoard hashes with **scrypt** (`apps/api/src/utils/password.ts`, stored as
 * `scrypt$N$r$p$salt$hash`), which has no input-length limit — so the 128
 * ceiling is NOT the bcrypt 72-byte truncation this comment used to cite. That
 * rationale described an implementation the project never shipped, and taken at
 * face value it would justify lowering the limit to 72 for a reason that does
 * not apply.
 *
 * What 128 is actually for: an upper bound on work per request. Hashing is
 * deliberately expensive and the input is unauthenticated, so an unbounded
 * field is a cheap way to make the login endpoint do arbitrary work. 128
 * characters is far past any passphrase a person types and far short of
 * anything that costs the server measurably.
 */
export const passwordSchema = z.string().min(8, VM_PASSWORD_MIN).max(128, VM_PASSWORD_MAX);
export type Password = z.infer<typeof passwordSchema>;

/** Avatar image URL, or `null` for "render initials". */
export const avatarUrlSchema = z.url(VM_URL_INVALID).nullable();

/**
 * The full account row as the owner or a global admin sees it. Never carries
 * `passwordHash` or `tokenVersion` — those exist only inside `apps/api`.
 */
export const userSchema = z.object({
  id: uuid,
  email: emailSchema,
  name: nameSchema,
  avatarUrl: avatarUrlSchema,
  isGlobalAdmin: z.boolean(),
  locale: localeSchema,
  isActive: z.boolean(),
  createdAt: isoDateTime,
});
export type User = z.infer<typeof userSchema>;

/**
 * The denormalized user reference embedded in every other payload — assignee,
 * reporter, comment author, activity actor, presence entry.
 *
 * Deliberately three fields: it is embedded in board cards by the hundred, and
 * an avatar plus a name is everything an avatar chip renders. Anything that
 * needs the email fetches the org directory.
 */
export const userSummarySchema = z.object({
  id: uuid,
  name: nameSchema,
  avatarUrl: avatarUrlSchema,
});
export type UserSummary = z.infer<typeof userSummarySchema>;

/** `POST /admin/users` — provision an account (global admin only). */
export const createUserInputSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  password: passwordSchema,
  isGlobalAdmin: z.boolean().default(false),
  locale: localeSchema.default('en'),
});
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

/**
 * `PATCH /admin/users/:userId` — every field optional, at least one required.
 *
 * Flipping `isActive` to `false` also bumps `token_version` server-side, which
 * revokes every issued access AND refresh token for that account; the contract
 * cannot express that, so it is asserted by WP2.1's integration suite instead.
 */
export const updateUserInputSchema = z
  .object({
    email: emailSchema,
    name: nameSchema,
    isGlobalAdmin: z.boolean(),
    isActive: z.boolean(),
    locale: localeSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: VM_UPDATE_AT_LEAST_ONE_FIELD });
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

/**
 * `POST /admin/users/:userId/reset-password` — an admin sets a new password
 * without knowing the old one. Bumps `token_version` (forced re-login).
 */
export const resetPasswordInputSchema = z.object({
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

/** `GET /admin/users` / `GET /orgs/:orgId/users` — list filters. */
export const userListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  isActive: booleanQuery.optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;
