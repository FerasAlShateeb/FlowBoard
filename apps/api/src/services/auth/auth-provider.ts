/**
 * `AuthProvider` — the credential-check seam, and FlowBoard's designated
 * LDAP/Active-Directory swap point.
 *
 * The whole point of this interface is that ONLY the "is this password right?"
 * question is pluggable. Everything else about a session — minting the JWT
 * pair, `tokenVersion` revocation, org/project role resolution — stays
 * FlowBoard's, because a directory server has no opinion about any of it. A
 * future `LdapAuthProvider` binds against the directory, upserts a local
 * `users` row to hang memberships and activity off, and returns it; the rest of
 * `auth.service.ts` never learns that anything changed.
 *
 * Contract notes:
 *   - `verifyCredentials` returns `null` for EVERY failure — unknown address,
 *     wrong password, deactivated account. Distinguishing them is the caller's
 *     job, and the caller (deliberately) does not, so the login endpoint cannot
 *     be used to enumerate accounts.
 *   - It returns a `UserRow`, not a boolean, so a provider that resolves the
 *     account itself (a directory lookup, a case-folded email match) does not
 *     force the service into a second query.
 *   - It must not throw for a bad credential. A thrown error means the provider
 *     itself is broken (directory unreachable), and that is a 5xx, not a 401.
 */
import type { UserRow } from '../../db';

export interface AuthProvider {
  /**
   * Stable identifier, stamped on the `auth_login` telemetry event so a mixed
   * local/LDAP deployment can chart adoption of the directory rollout.
   */
  readonly id: string;

  /**
   * `false` when the provider owns the password (LDAP/AD), which makes
   * `POST /auth/change-password` a 400 pointing the user at the directory
   * instead of silently writing a hash nothing will ever read.
   */
  readonly supportsPasswordChange: boolean;

  /** The account behind these credentials, or `null` if there is not one. */
  verifyCredentials(email: string, password: string): Promise<UserRow | null>;
}
