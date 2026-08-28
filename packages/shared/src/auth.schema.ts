// Authentication contracts: login / refresh / me / change-password, the invite
// flow, and the JWT payload both tokens carry.
//
// FlowBoard has no self-registration. An account is born one of two ways — a
// global admin provisions it (`users.schema.ts`), or someone opens an invite
// link and accepts it. Both token types (access, refresh) share one payload
// shape discriminated by `type`, so a refresh token can never be replayed as a
// bearer credential: `requireAuth` checks `type === 'access'`.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { isoDateTime, slugSchema, uuid } from './common';
import { inviteStatusSchema, orgRoleSchema } from './orgs.schema';
import { projectRoleSchema } from './projects.schema';
import {
  emailSchema,
  localeSchema,
  nameSchema,
  passwordSchema,
  userSchema,
  avatarUrlSchema,
} from './users.schema';
import {
  VM_REQUIRED,
  VM_TOKEN_REQUIRED,
  VM_UPDATE_AT_LEAST_ONE_FIELD,
} from './validation-messages';

/**
 * `POST /auth/login`.
 *
 * The password is checked for PRESENCE only, never against the strength policy:
 * telling a user their existing password is "too short" at the login form leaks
 * policy and helps nobody. Strength is enforced where a password is *set*.
 */
export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, VM_REQUIRED),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

/** A signed JWT as it crosses the wire. */
export const jwtSchema = z.string().min(1, VM_REQUIRED);

/** `POST /auth/login` response — the account plus a fresh token pair. */
export const loginResponseSchema = z.object({
  user: userSchema,
  accessToken: jwtSchema,
  refreshToken: jwtSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** `POST /auth/refresh` — spend a refresh token. */
export const refreshInputSchema = z.object({
  refreshToken: jwtSchema,
});
export type RefreshInput = z.infer<typeof refreshInputSchema>;

/**
 * `POST /auth/refresh` response. Both tokens rotate: the spent refresh token is
 * replaced, so a stolen one is usable at most once before the real client's next
 * refresh invalidates it.
 */
export const refreshResponseSchema = z.object({
  accessToken: jwtSchema,
  refreshToken: jwtSchema,
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

/** `POST /auth/change-password` — the self-service path (knows the old one). */
export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1, VM_REQUIRED),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

/**
 * One row of `GET /auth/me`'s `memberships` array — an org plus my role in it.
 *
 * Carries the SLUG as well as the id because the org switcher's links are
 * `/o/:orgSlug`, and a switcher that had to fetch `/orgs` before it could build
 * an href would make every cold boot two round trips.
 */
export const sessionMembershipSchema = z.object({
  orgId: uuid,
  orgSlug: slugSchema,
  orgName: nameSchema,
  role: orgRoleSchema,
  joinedAt: isoDateTime,
});
export type SessionMembership = z.infer<typeof sessionMembershipSchema>;

/**
 * `GET /auth/me` — everything the web shell needs to boot: the account, the org
 * switcher's rows, and the flag that unlocks the admin nav.
 *
 * `isGlobalAdmin` is duplicated out of `user` deliberately: the route guards
 * read it without reaching into the nested object, and the duplication is one
 * boolean written by one server.
 */
export const meResponseSchema = z.object({
  user: userSchema,
  memberships: z.array(sessionMembershipSchema),
  isGlobalAdmin: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** `POST /auth/logout` — reports whether every device was signed out. */
export const logoutResponseSchema = z.object({
  revokedAll: z.boolean(),
});
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;

/** `PATCH /auth/me` — the profile fields a user may change about themselves. */
export const updateMeInputSchema = z
  .object({
    name: nameSchema,
    locale: localeSchema,
    avatarUrl: avatarUrlSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: VM_UPDATE_AT_LEAST_ONE_FIELD });
export type UpdateMeInput = z.infer<typeof updateMeInputSchema>;

/**
 * `GET /auth/invites/:token` — the UNAUTHENTICATED preview the invite landing
 * page renders before asking for anything.
 *
 * Carries no ids: an unauthenticated caller holding a leaked token learns the
 * org's name and who invited them, and nothing that would let them address the
 * org's rows. `requiresAccount` tells the page which form to render — the
 * name+password signup form, or the one-button "join as <you>" attach.
 */
export const invitePreviewSchema = z.object({
  orgName: nameSchema,
  orgRole: orgRoleSchema,
  projectName: nameSchema.nullable(),
  projectRole: projectRoleSchema.nullable(),
  invitedByName: nameSchema,
  /** Set when the invite is locked to one address; `null` when it is open. */
  email: emailSchema.nullable(),
  expiresAt: isoDateTime,
  /** `true` when no account exists for this invite's email yet. */
  requiresAccount: z.boolean(),
  /**
   * `pending` / `accepted` / `expired` — see {@link inviteStatusSchema}. The
   * landing page needs all three to say something useful, and only the server
   * can distinguish the last two.
   */
  status: inviteStatusSchema,
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

/**
 * `POST /auth/invites/:token/accept` — one endpoint, two callers, so the body is
 * a discriminated union rather than a bag of maybe-fields:
 *
 * - `mode: 'register'` — an anonymous visitor creating the account the invite is
 *   for. Supplies name + password.
 * - `mode: 'attach'` — a signed-in user adding an org to their existing account.
 *   Body carries nothing; identity comes from the Authorization header and the
 *   grant from the token in the path.
 */
export const acceptInviteRegisterSchema = z.object({
  mode: z.literal('register'),
  name: nameSchema,
  password: passwordSchema,
  /**
   * ONLY for an UNLOCKED invite (`invites.email IS NULL`), which otherwise has
   * no address to create the account with.
   *
   * When the invite carries its own email lock the server IGNORES this field
   * and uses the locked address — so a shared link still cannot be used as a
   * free account factory for somebody else's address. Supplying a value that
   * disagrees with the lock is refused rather than silently overridden.
   */
  email: emailSchema.optional(),
});
export type AcceptInviteRegister = z.infer<typeof acceptInviteRegisterSchema>;

/** The signed-in half of {@link acceptInviteInputSchema}. */
export const acceptInviteAttachSchema = z.object({
  mode: z.literal('attach'),
});
export type AcceptInviteAttach = z.infer<typeof acceptInviteAttachSchema>;

/** `POST /auth/invites/:token/accept` body — see the two members for the split. */
export const acceptInviteInputSchema = z.discriminatedUnion('mode', [
  acceptInviteRegisterSchema,
  acceptInviteAttachSchema,
]);
export type AcceptInviteInput = z.infer<typeof acceptInviteInputSchema>;

/**
 * `POST /auth/invites/:token/accept` response — ONE shape for both modes.
 *
 * A union was the obvious alternative and it is the wrong one. `register`
 * plainly needs a token pair (the account was just born). `attach` returns one
 * too, because the caller's existing access token was minted BEFORE this org
 * grant and before any `tokenVersion` bump a concurrent admin action may have
 * applied; handing back a freshly-read pair is how the client avoids a
 * guaranteed-stale claim set. Making both answers the same type also means the
 * web parses one schema instead of branching on a mode it already knows.
 *
 * `orgId` / `projectId` tell the client where to navigate — the org it just
 * joined, and the project if the invite carried a direct grant.
 */
export const acceptInviteResponseSchema = loginResponseSchema.extend({
  orgId: uuid,
  projectId: uuid.nullable(),
});
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;

/** The `:token` path param of the invite endpoints. */
export const inviteTokenParamSchema = z.object({
  token: z.string().min(8, VM_TOKEN_REQUIRED).max(128, VM_TOKEN_REQUIRED),
});
export type InviteTokenParam = z.infer<typeof inviteTokenParamSchema>;

/** Which of the two token kinds a JWT is. */
export const tokenTypeSchema = z.enum(['access', 'refresh']);
export type TokenType = z.infer<typeof tokenTypeSchema>;

/**
 * The decoded JWT body, verified on every authenticated request and on the
 * socket handshake.
 *
 * `tokenVersion` is the revocation lever: it is compared against the column on
 * the user row, so bumping that column (deactivate, password reset,
 * logout-everywhere) invalidates every token already in the wild without any
 * server-side session store. `isGlobalAdmin` is denormalized purely to avoid a
 * user lookup on admin routes — it is a cache, and `requireGlobalAdmin` still
 * re-reads the row before a destructive action.
 *
 * `iat`/`exp` are stamped by `jsonwebtoken`, so they are optional on the way in
 * and present on the way out.
 */
export const accessTokenPayloadSchema = z.object({
  sub: uuid,
  tokenVersion: z.number().int().nonnegative(),
  isGlobalAdmin: z.boolean(),
  type: tokenTypeSchema,
  iat: z.number().int().optional(),
  exp: z.number().int().optional(),
});
export type AccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;

/** `POST /auth/logout?all` — `all` revokes every device by bumping tokenVersion. */
export const logoutQuerySchema = z.object({
  all: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
    .transform((raw) => raw === true || raw === 'true' || raw === '1' || raw === '')
    .optional(),
});
export type LogoutQuery = z.infer<typeof logoutQuerySchema>;
