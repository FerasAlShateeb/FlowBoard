/**
 * Auth request/response shapes for the `/api/auth` routes.
 *
 * EVERY schema here now comes from `@flowboard/shared`. This module is a
 * re-export shim, kept for one reason: the quartet convention says a route file
 * imports its validation from `src/validation/<domain>.validation.ts`, so the
 * import site stays stable whether a contract is shared or (temporarily)
 * server-only.
 *
 * WP2.1 originally defined five of these locally, each marked "GAP vs
 * @flowboard/shared". WP2.5 promoted all five — `inviteStatusSchema`, the
 * `status` field on the invite preview, `meResponseSchema`,
 * `logoutResponseSchema`, the optional `email` on the accept-invite register
 * branch, and `acceptInviteResponseSchema` — into the shared package, because
 * every one of them crosses the wire and the web app has to parse it. A
 * contract that only one end knows is not a contract.
 */
export {
  acceptInviteAttachSchema,
  acceptInviteInputSchema,
  acceptInviteRegisterSchema,
  acceptInviteResponseSchema,
  changePasswordInputSchema,
  invitePreviewSchema,
  inviteStatusSchema,
  inviteTokenParamSchema,
  loginInputSchema,
  loginResponseSchema,
  logoutQuerySchema,
  logoutResponseSchema,
  meResponseSchema,
  refreshInputSchema,
  refreshResponseSchema,
  sessionMembershipSchema,
  updateMeInputSchema,
} from '@flowboard/shared';

export type {
  AcceptInviteAttach,
  AcceptInviteInput,
  AcceptInviteRegister,
  AcceptInviteResponse,
  InvitePreview,
  InviteStatus,
  LoginResponse,
  LogoutResponse,
  MeResponse,
  SessionMembership,
} from '@flowboard/shared';

// ── Legacy aliases ──────────────────────────────────────────────────────────
// WP2.1's names for two shapes that are now plain shared contracts. Kept so the
// service and controller layers below did not have to be rewritten alongside a
// contract move, and because both names read correctly at their call sites.
export {
  acceptInviteInputSchema as acceptInviteBodySchema,
  invitePreviewSchema as invitePreviewResponseSchema,
} from '@flowboard/shared';
export type {
  AcceptInviteInput as AcceptInviteBody,
  InvitePreview as InvitePreviewResponse,
} from '@flowboard/shared';
