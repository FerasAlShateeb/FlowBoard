/**
 * The `users`-table reads and writes that all three identity services share:
 * auth (login/me/change-password), invites (accept) and admin-users (CRUD).
 *
 * It lives under `services/auth/` rather than in each service because the
 * `lower(email)` lookup and the "is this session still live?" check are exactly
 * the two places a subtle divergence would become a security bug — a login that
 * folds case and an invite that does not means one address, two accounts.
 */
import { eq, sql } from 'drizzle-orm';
import type { Locale, User } from '@flowboard/shared';

import { db, users, type Db, type Tx, type UserRow } from '../../db';
import { ApiError } from '../../utils/api-error';

/** `db` or an open transaction — every helper here accepts either. */
export type Executor = Db | Tx;

/**
 * Narrow the free-text `users.locale` column to the shipped UI locales.
 *
 * The column is text on purpose (adding a locale must not be a migration), so
 * a row can legitimately hold a value the current build has no catalog for.
 * Falling back to `en` beats failing the response.
 */
export function toLocale(value: string): Locale {
  return value === 'ar' ? 'ar' : 'en';
}

/** Map a database row onto the shared `userSchema` wire shape. */
export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email.toLowerCase(),
    name: row.name,
    avatarUrl: row.avatarUrl,
    isGlobalAdmin: row.isGlobalAdmin,
    locale: toLocale(row.locale),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Case-insensitive account lookup — the only correct way to resolve an address,
 * because `users` is unique on `lower(email)`, not on `email`.
 */
export async function findUserByEmail(
  email: string,
  executor: Executor = db,
): Promise<UserRow | undefined> {
  const [row] = await executor
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  return row;
}

/** Plain id lookup. `undefined` rather than a throw — callers choose the error. */
export async function findUserById(
  userId: string,
  executor: Executor = db,
): Promise<UserRow | undefined> {
  const [row] = await executor.select().from(users).where(eq(users.id, userId)).limit(1);
  return row;
}

/**
 * Re-read the account behind a verified token and prove the session is still
 * valid: the row exists, is active, and its `token_version` still matches the
 * one baked into the token.
 *
 * This is the lazy revocation check `requireAuth` deliberately skips (it would
 * put a SELECT in front of every request); endpoints that already touch the
 * user row — `/auth/me`, `/auth/refresh`, `change-password`, invite attach —
 * pay nothing extra for it.
 *
 * @throws {ApiError} 401 when the session has been revoked or the account
 * deactivated. Same message either way: which of the two happened is not the
 * client's business.
 */
export async function loadLiveUser(
  userId: string,
  tokenVersion: number,
  executor: Executor = db,
): Promise<UserRow> {
  const row = await findUserById(userId, executor);
  if (!row || !row.isActive || row.tokenVersion !== tokenVersion) {
    throw ApiError.unauthorized('Session has been revoked');
  }
  return row;
}

/**
 * Invalidate every token ever minted for this account by bumping the column
 * both halves of the pair carry.
 *
 * `token_version + 1` is computed IN the statement, never read-then-written: a
 * concurrent password change and force-revoke must both land.
 *
 * @returns the new row, so the caller can immediately mint a replacement pair.
 */
export async function bumpTokenVersion(
  userId: string,
  executor: Executor = db,
): Promise<UserRow | undefined> {
  const [row] = await executor
    .update(users)
    // `updated_at` is maintained by the column's own `$onUpdate` hook.
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId))
    .returning();
  return row;
}
