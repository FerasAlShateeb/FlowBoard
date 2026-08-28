/**
 * `LocalAuthProvider` — credentials checked against the `users` table's own
 * scrypt hashes. FlowBoard's default, and the reference implementation of the
 * {@link AuthProvider} contract.
 *
 * Every rejection path returns `null` rather than a reason: an unknown address,
 * a wrong password and a deactivated account are indistinguishable to the
 * caller by design (see the interface docs).
 *
 * One deliberate non-obvious detail: when no account matches, the provider
 * still runs a scrypt verification against a throwaway hash before returning.
 * Without it, "unknown address" answers in microseconds while "wrong password"
 * takes the full KDF cost, and the difference is a reliable, remotely
 * measurable account-enumeration oracle — the rate limiter slows that down but
 * does not close it.
 */
import { hashPassword, verifyPassword } from '../../utils/password';
import type { UserRow } from '../../db';
import type { AuthProvider } from './auth-provider';
import { findUserByEmail } from './user-lookup';

/**
 * A hash of a value nothing can supply, computed once, used only to burn the
 * same CPU time a real verification would.
 */
let decoyHash: Promise<string> | null = null;

function getDecoyHash(): Promise<string> {
  decoyHash ??= hashPassword('flowboard::no-such-account::timing-decoy');
  return decoyHash;
}

class LocalAuthProvider implements AuthProvider {
  readonly id = 'local';

  /** The hash lives in our own column, so we can rewrite it. */
  readonly supportsPasswordChange = true;

  async verifyCredentials(email: string, password: string): Promise<UserRow | null> {
    const row = await findUserByEmail(email);

    if (!row) {
      await verifyPassword(password, await getDecoyHash());
      return null;
    }

    // Checked BEFORE the hash comparison would be a timing tell of its own, so
    // a deactivated account still pays the KDF cost like everyone else.
    const matches = await verifyPassword(password, row.passwordHash);
    if (!matches || !row.isActive) return null;

    return row;
  }
}

/** The default provider. Swapped at boot via `setAuthProvider()`. */
export const localAuthProvider: AuthProvider = new LocalAuthProvider();
