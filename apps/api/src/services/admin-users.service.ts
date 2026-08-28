/**
 * Global-admin account administration (`/api/admin/users`).
 *
 * FlowBoard has no self-registration, so this is one of only two doors into the
 * `users` table (the other is invite acceptance). Three rules shape everything
 * below:
 *
 *  1. **Accounts are never deleted.** Activity rows, comments and attachments
 *     must keep pointing at a real person. Deactivation (`is_active = false`)
 *     is the delete, and it is accompanied by a `token_version` bump so the
 *     account's live sessions die with it rather than surviving until their
 *     access tokens expire.
 *
 *     The bump alone is not the whole story: it is checked on the next HTTP
 *     request and on the next socket HANDSHAKE, which leaves an ALREADY-OPEN
 *     socket streaming board and notification traffic to a revoked account until
 *     it happens to reconnect. Every bump therefore also publishes
 *     `user.revoked`, which the realtime bridge turns into a forced disconnect
 *     of `user:{userId}`. Published AFTER the transaction commits, like every
 *     other domain event — a rolled-back deactivation must not drop sessions.
 *  2. **Email identity is `lower(email)`**, matching the unique index. Every
 *     conflict check goes through `findUserByEmail`.
 *  3. **An admin cannot lock themselves out.** Self-deactivation and
 *     self-demotion are refused — recovering from either needs another global
 *     admin or a database console, and in a single-admin deployment there is no
 *     other admin.
 */
import { and, count, desc, eq, ilike, ne, or, type SQL } from 'drizzle-orm';
import type { PaginationMeta, ResetPasswordInput, User } from '@flowboard/shared';

import { db, orgMembers, organizations, users, withTx } from '../db';
import { ApiError } from '../utils/api-error';
import { publishDomainEvent } from '../utils/domain-events';
import { hashPassword } from '../utils/password';
import { bumpTokenVersion, findUserByEmail, findUserById, toUser } from './auth/user-lookup';
import { isUniqueViolation } from './pg-errors';
import type {
  AdminUpdateUserInput,
  AdminUserListQuery,
  ProvisionUserInput,
} from '../validation/admin-users.validation';

/** A page of accounts plus the envelope's `meta` block. */
export interface UserPage {
  rows: User[];
  meta: PaginationMeta;
}

/**
 * `GET /api/admin/users?page&pageSize&q&isActive`.
 *
 * `q` matches name OR email, case-insensitively and anywhere in the string —
 * an admin searching for a person types a fragment, not a prefix.
 */
export async function listUsers(query: AdminUserListQuery): Promise<UserPage> {
  const filters: SQL[] = [];
  if (query.q !== undefined && query.q.length > 0) {
    const pattern = `%${query.q}%`;
    const match = or(ilike(users.name, pattern), ilike(users.email, pattern));
    if (match) filters.push(match);
  }
  if (query.isActive !== undefined) {
    filters.push(eq(users.isActive, query.isActive));
  }
  const where = filters.length === 0 ? undefined : and(...filters);

  const [totalRow] = await db.select({ value: count() }).from(users).where(where);
  const total = totalRow?.value ?? 0;

  const rows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    rows: rows.map(toUser),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

/**
 * `POST /api/admin/users` — provision an account, optionally already inside
 * some orgs.
 *
 * The account and its memberships are written in ONE transaction: an account
 * that exists but landed in none of its orgs is a support ticket, and half of
 * that work committing is how you get one.
 *
 * @throws {ApiError} 409 when the address is taken, 400 when an `orgId` in the
 * membership list does not exist.
 */
export async function provisionUser(input: ProvisionUserInput): Promise<User> {
  const existing = await findUserByEmail(input.email);
  if (existing) {
    throw ApiError.conflict('An account with that email already exists');
  }

  const passwordHash = await hashPassword(input.password);

  try {
    return await provisionUserRow(input, passwordHash);
  } catch (error) {
    // The pre-check above is a fast path for a good message; the
    // `users_email_lower_unique` index is the real arbiter. Two admins
    // provisioning the same address at once both pass the check, and the loser
    // must get a 409 rather than a 500.
    if (isUniqueViolation(error)) {
      throw ApiError.conflict('An account with that email already exists');
    }
    throw error;
  }
}

/** The write half of {@link provisionUser} — account + org grants, one transaction. */
async function provisionUserRow(input: ProvisionUserInput, passwordHash: string): Promise<User> {
  return withTx(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({
        email: input.email,
        name: input.name,
        passwordHash,
        isGlobalAdmin: input.isGlobalAdmin,
        locale: input.locale,
      })
      .returning();
    if (!created) throw ApiError.internal('Failed to create the account');

    for (const membership of input.orgMemberships) {
      const [org] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, membership.orgId))
        .limit(1);
      if (!org) throw ApiError.badRequest(`Organization ${membership.orgId} does not exist`);

      await tx
        .insert(orgMembers)
        .values({ orgId: membership.orgId, userId: created.id, role: membership.role })
        .onConflictDoNothing();
    }

    return toUser(created);
  });
}

/**
 * `PATCH /api/admin/users/:userId`.
 *
 * Two of the fields have a side effect the contract cannot show: `isActive:
 * false` and `forceLogout: true` both bump `token_version`, revoking every
 * access AND refresh token the account holds. They collapse into a single bump
 * when both are sent.
 */
export async function updateUser(
  actorId: string,
  userId: string,
  input: AdminUpdateUserInput,
): Promise<User> {
  const target = await findUserById(userId);
  if (!target) throw ApiError.notFound('User not found');

  if (userId === actorId && input.isActive === false) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }
  if (userId === actorId && input.isGlobalAdmin === false) {
    throw ApiError.badRequest('You cannot revoke your own global administrator access');
  }

  if (input.email !== undefined && input.email !== target.email.toLowerCase()) {
    const [clash] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(ilike(users.email, input.email), ne(users.id, userId)))
      .limit(1);
    if (clash) throw ApiError.conflict('An account with that email already exists');
  }

  const revokeSessions = input.isActive === false || input.forceLogout === true;

  // `forceLogout` is the one field that is NOT a column, so a body carrying
  // only that leaves nothing to assign — and Drizzle rejects an empty `.set({})`
  // rather than emitting a no-op UPDATE. Build the patch first and skip the
  // statement when it is empty; the token bump below is the whole request.
  const columnPatch = {
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.locale !== undefined ? { locale: input.locale } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.isGlobalAdmin !== undefined ? { isGlobalAdmin: input.isGlobalAdmin } : {}),
  };

  let updated;
  try {
    updated = await withTx(async (tx) => {
      let row = target;

      if (Object.keys(columnPatch).length > 0) {
        const [patched] = await tx
          .update(users)
          .set(columnPatch)
          .where(eq(users.id, userId))
          .returning();
        if (!patched) throw ApiError.notFound('User not found');
        row = patched;
      }

      if (!revokeSessions) return row;

      const bumped = await bumpTokenVersion(userId, tx);
      return bumped ?? row;
    });
  } catch (error) {
    // Same race as provisioning: the clash check above is a fast path, the
    // unique index is the arbiter.
    if (isUniqueViolation(error)) {
      throw ApiError.conflict('An account with that email already exists');
    }
    throw error;
  }

  if (revokeSessions) publishDomainEvent('user.revoked', { userId });

  return toUser(updated);
}

/**
 * `POST /api/admin/users/:userId/reset-password`.
 *
 * Always revokes: whoever knew the old password (including whoever should not
 * have) keeps no live session. The new password is handed to the user out of
 * band — FlowBoard sends no email.
 */
export async function resetPassword(userId: string, input: ResetPasswordInput): Promise<void> {
  const target = await findUserById(userId);
  if (!target) throw ApiError.notFound('User not found');

  const passwordHash = await hashPassword(input.password);

  await withTx(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    await bumpTokenVersion(userId, tx);
  });

  publishDomainEvent('user.revoked', { userId });
}
