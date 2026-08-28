/**
 * Session lifecycle: login, refresh, logout, profile, password change.
 *
 * The credential check is delegated to an {@link AuthProvider} (the LDAP swap
 * point); everything below that line — minting the JWT pair, `tokenVersion`
 * revocation, the membership list the web shell boots from — is FlowBoard's own
 * and stays here.
 *
 * Revocation model, in one place so it is not rediscovered per endpoint: both
 * tokens carry the `token_version` they were minted with. Bumping the column
 * (`logout?all=true`, change-password, admin deactivate/force-logout) makes
 * every outstanding token stale without a server-side session store. It is
 * enforced wherever the user row is read anyway — here, and in
 * `middlewares/require-roles.ts`.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type {
  ChangePasswordInput,
  LoginInput,
  LoginResponse,
  RefreshInput,
  RefreshResponse,
  UpdateMeInput,
  User,
} from '@flowboard/shared';

import { db, organizations, orgMembers, users, type UserRow } from '../db';
import { ApiError } from '../utils/api-error';
import { hashPassword } from '../utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { record } from './telemetry.service';
import type { AuthProvider } from './auth/auth-provider';
import { localAuthProvider } from './auth/local-auth.provider';
import { bumpTokenVersion, loadLiveUser, toUser, type Executor } from './auth/user-lookup';
import type { MeResponse, SessionMembership } from '../validation/auth.validation';

/**
 * The active provider. A module-level binding behind a getter rather than a
 * constructor argument: `auth.service` is imported by controllers as a module,
 * and threading a container through four layers to swap one method is ceremony
 * that buys nothing here.
 */
let provider: AuthProvider = localAuthProvider;

/**
 * Swap the credential backend.
 *
 * INJECTION POINT — a future LDAP deployment calls this once from the
 * composition root. Pass `null` to restore the local provider (tests).
 */
export function setAuthProvider(next: AuthProvider | null): void {
  provider = next ?? localAuthProvider;
}

/** The provider currently answering `verifyCredentials`. */
export function getAuthProvider(): AuthProvider {
  return provider;
}

/** Mint a matched access/refresh pair from a freshly-read user row. */
function signTokenPair(row: UserRow): { accessToken: string; refreshToken: string } {
  const claims = {
    sub: row.id,
    tokenVersion: row.tokenVersion,
    isGlobalAdmin: row.isGlobalAdmin,
  };
  return {
    accessToken: signAccessToken(claims),
    refreshToken: signRefreshToken(claims),
  };
}

/** Build the `{ user, accessToken, refreshToken }` payload login-shaped endpoints return. */
export function toLoginResponse(row: UserRow): LoginResponse {
  return { user: toUser(row), ...signTokenPair(row) };
}

/**
 * `POST /api/auth/login`.
 *
 * @throws {ApiError} 401 for every failure, with one message. Distinguishing
 * "no such account" from "wrong password" turns the login form into an account
 * directory.
 */
export async function login(input: LoginInput): Promise<LoginResponse> {
  const row = await provider.verifyCredentials(input.email, input.password);
  if (!row) {
    // `invalid_credentials`, not the generic `unauthorized` the guards throw:
    // the login form branches on the code to say "that email and password do
    // not match" rather than a shrug. One message for both halves regardless.
    throw ApiError.invalidCredentials();
  }

  record('auth_login', { provider: provider.id }, { userId: row.id });

  return toLoginResponse(row);
}

/**
 * `POST /api/auth/refresh` — spend a refresh token for a NEW pair.
 *
 * Both halves rotate. The spent refresh token is not denylisted (there is no
 * store to deny it in), but the account state is re-read on every refresh, so a
 * stolen token dies the moment the real user changes their password or an admin
 * revokes the session.
 */
export async function refresh(input: RefreshInput): Promise<RefreshResponse> {
  const payload = verifyRefreshToken(input.refreshToken);
  const row = await loadLiveUser(payload.sub, payload.tokenVersion);
  return signTokenPair(row);
}

/**
 * `POST /api/auth/logout`.
 *
 * Without `?all=true` this is a NO-OP server-side, and honestly so: a stateless
 * JWT cannot be un-issued, so the client dropping its tokens *is* the logout.
 * `?all=true` is the real revocation — it bumps `token_version` and kills every
 * device.
 */
export async function logout(
  user: { id: string; tokenVersion: number },
  all: boolean,
): Promise<{ revokedAll: boolean }> {
  if (!all) return { revokedAll: false };

  const row = await loadLiveUser(user.id, user.tokenVersion);
  await bumpTokenVersion(row.id);
  return { revokedAll: true };
}

/** The org rows the switcher renders, newest membership last. */
async function listMemberships(
  userId: string,
  executor: Executor = db,
): Promise<SessionMembership[]> {
  const rows = await executor
    .select({
      orgId: organizations.id,
      orgSlug: organizations.slug,
      orgName: organizations.name,
      role: orgMembers.role,
      joinedAt: orgMembers.createdAt,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(and(eq(orgMembers.userId, userId), isNull(organizations.deletedAt)))
    .orderBy(asc(organizations.name));

  return rows.map((row) => ({
    orgId: row.orgId,
    orgSlug: row.orgSlug,
    orgName: row.orgName,
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
  }));
}

/**
 * `GET /api/auth/me` — the web shell's boot payload.
 *
 * Re-reads the row (rather than trusting the token's claims), so a session
 * revoked seconds ago fails here instead of rendering a stale shell.
 */
export async function getMe(user: { id: string; tokenVersion: number }): Promise<MeResponse> {
  const row = await loadLiveUser(user.id, user.tokenVersion);
  const memberships = await listMemberships(row.id);
  return { user: toUser(row), memberships, isGlobalAdmin: row.isGlobalAdmin };
}

/** `PATCH /api/auth/me` — the three fields a user owns about themselves. */
export async function updateMe(
  user: { id: string; tokenVersion: number },
  input: UpdateMeInput,
): Promise<User> {
  await loadLiveUser(user.id, user.tokenVersion);

  const [row] = await db
    .update(users)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    })
    .where(eq(users.id, user.id))
    .returning();

  if (!row) throw ApiError.notFound('User not found');
  return toUser(row);
}

/**
 * `POST /api/auth/change-password`.
 *
 * Bumps `token_version` — which revokes the caller's own tokens too — and then
 * returns a FRESH pair so the person who just changed their password is not
 * signed out of the tab they did it in. Every other device is.
 *
 * @throws {ApiError} 400 when the current password is wrong. Deliberately not a
 * 401: the caller's session is fine, and a 401 would make the web client's
 * interceptor bounce them to /login over a typo.
 */
export async function changePassword(
  user: { id: string; tokenVersion: number },
  input: ChangePasswordInput,
): Promise<LoginResponse> {
  if (!provider.supportsPasswordChange) {
    throw ApiError.badRequest('Passwords are managed by your organization directory');
  }

  const current = await loadLiveUser(user.id, user.tokenVersion);

  const verified = await provider.verifyCredentials(current.email, input.currentPassword);
  if (!verified || verified.id !== current.id) {
    throw ApiError.badRequest('Current password is incorrect');
  }

  if (input.currentPassword === input.newPassword) {
    throw ApiError.badRequest('The new password must differ from the current one');
  }

  const passwordHash = await hashPassword(input.newPassword);
  const [row] = await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, current.id))
    .returning();
  if (!row) throw ApiError.notFound('User not found');

  const rotated = await bumpTokenVersion(row.id);
  if (!rotated) throw ApiError.notFound('User not found');

  return toLoginResponse(rotated);
}
