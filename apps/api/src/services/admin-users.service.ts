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
import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type {
  AdminUserMembership,
  AdminUserRow,
  DeleteUserResponse,
  PaginationMeta,
  ResetPasswordInput,
  User,
} from '@flowboard/shared';

import {
  comments,
  db,
  orgMembers,
  organizations,
  projectMembers,
  tasks,
  users,
  withTx,
  type Tx,
} from '../db';
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
  rows: AdminUserRow[];
  meta: PaginationMeta;
}

/**
 * The display name a deleted account wears.
 *
 * A LITERAL, not a translated string: the API has no locale for the person
 * READING the admin table (only for the person the row describes), and a name
 * column that changed language depending on who deleted the account would be
 * worse than one that is consistently English. The web renders it as-is.
 */
const DELETED_USER_NAME = 'Deleted user';

/**
 * The domain a scrubbed address is rewritten into.
 *
 * `.invalid` is reserved by RFC 2606 precisely for this: it can never resolve,
 * so a scrubbed row can never be mailed by accident. The address cannot simply
 * be nulled — `users_email_lower_unique` is a unique index on a NOT NULL column
 * — so it is `deleted+<uuid>@` to stay unique across any number of deletions.
 */
const DELETED_EMAIL_DOMAIN = 'flowboard.invalid';

/** Has this account already been through {@link deleteUser}? */
function isAnonymized(email: string): boolean {
  return email.toLowerCase().endsWith(`@${DELETED_EMAIL_DOMAIN}`);
}

/**
 * Every organization a page of accounts belongs to, in ONE query.
 *
 * "Which orgs is this person in?" is the question the admin directory exists to
 * answer, and it used to be unanswerable — `AdminUsersPage` hardcoded
 * `orgMemberships: []`. Fetching per row would be N+1 on a page that paginates
 * at 25; this joins once for the whole page and hands back a lookup the caller
 * indexes by user id.
 *
 * Archived organizations are excluded. A membership of an org that no longer
 * resolves is not access the admin can act on, and rendering a chip that links
 * to a 404 is worse than rendering nothing.
 */
async function membershipsByUser(
  userIds: readonly string[],
): Promise<Map<string, AdminUserMembership[]>> {
  const byUser = new Map<string, AdminUserMembership[]>();
  if (userIds.length === 0) return byUser;

  const rows = await db
    .select({
      userId: orgMembers.userId,
      orgId: organizations.id,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(and(inArray(orgMembers.userId, [...userIds]), isNull(organizations.deletedAt)))
    .orderBy(asc(organizations.name));

  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push({
      orgId: row.orgId,
      orgName: row.orgName,
      orgSlug: row.orgSlug,
      role: row.role,
    });
    byUser.set(row.userId, list);
  }
  return byUser;
}

/**
 * `GET /api/admin/users?page&pageSize&q&isActive`.
 *
 * `q` matches name OR email, case-insensitively and anywhere in the string —
 * an admin searching for a person types a fragment, not a prefix.
 *
 * Two queries per page and no more: the count, the page, and one grouped join
 * for the memberships column (see {@link membershipsByUser}).
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

  const memberships = await membershipsByUser(rows.map((row) => row.id));

  return {
    rows: rows.map((row) => ({ ...toUser(row), memberships: memberships.get(row.id) ?? [] })),
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
 * membership list does not exist or has been archived.
 */
export async function provisionUser(input: ProvisionUserInput): Promise<AdminUserRow> {
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

/**
 * The write half of {@link provisionUser} — account + org grants, one
 * transaction.
 *
 * Each `orgId` is resolved against LIVE organizations only. Granting membership
 * of an archived org would create access to something that does not resolve —
 * invisible until the org is restored, and impossible for the new account to
 * make sense of in the meantime.
 *
 * The response carries the memberships this call created, in the same shape the
 * list rows use, so the admin table can prepend the new row without refetching.
 */
async function provisionUserRow(
  input: ProvisionUserInput,
  passwordHash: string,
): Promise<AdminUserRow> {
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

    const memberships: AdminUserMembership[] = [];
    for (const membership of input.orgMemberships) {
      const [org] = await tx
        .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
        .from(organizations)
        .where(and(eq(organizations.id, membership.orgId), isNull(organizations.deletedAt)))
        .limit(1);
      if (!org) throw ApiError.badRequest(`Organization ${membership.orgId} does not exist`);

      await tx
        .insert(orgMembers)
        .values({ orgId: membership.orgId, userId: created.id, role: membership.role })
        .onConflictDoNothing();

      memberships.push({
        orgId: org.id,
        orgName: org.name,
        orgSlug: org.slug,
        role: membership.role,
      });
    }

    return { ...toUser(created), memberships };
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

/**
 * Rewrite every `@[<name>](<userId>)` mention of this account to
 * `@[Deleted user](<userId>)`, in `comments.body` and `tasks.description`.
 *
 * ═══ WHY THIS IS PART OF THE DELETION AND NOT A NICETY (R2 W3.5) ════════════
 *
 * The mention encoding (`packages/shared/comments.schema.ts`) stores the display
 * name captured at WRITE time next to the stable id, precisely so an old comment
 * still reads correctly after a rename. That is exactly the property that made
 * {@link deleteUser} a deletion that deleted nothing visible: the `users` row was
 * scrubbed to "Deleted user", every membership was dropped — and the person's
 * real name went on rendering, verbatim, inside every comment and task
 * description that had ever @-mentioned them. A deletion request that leaves the
 * name on screen in the place people actually read is not a deletion.
 *
 * ═══ WHY SQL AND NOT A READ-MODIFY-WRITE LOOP ══════════════════════════════
 *
 * Two `UPDATE … regexp_replace` statements inside the same transaction as the
 * scrub, so the identity is gone atomically or not at all. Fetching the rows
 * into Node to run {@link MENTION_PATTERN} over them would mean an unbounded
 * result set (a busy instance's `comments` table) held in memory inside an open
 * transaction, and a second source of truth for the encoding.
 *
 * ═══ THE PATTERN IS SCOPED TO ONE ID, AND MIRRORS THE SHARED ONE ═══════════
 *
 * The id half is pinned to THIS user, so a comment mentioning three people loses
 * exactly one name. The name half is `[^\]]{1,120}` — character class and bound
 * copied from `MENTION_PATTERN` — so this rewrites precisely what the renderer
 * and `extractMentionUserIds` treat as a mention, and nothing that merely looks
 * like one. `'gi'`: every occurrence in a body, and case-insensitively, because
 * the shared pattern accepts `[0-9a-fA-F]` in the uuid while Postgres renders
 * ids lowercase.
 *
 * Both the pattern and the replacement are BOUND PARAMETERS, never interpolated
 * into SQL text. `userId` reaches here as a zod-parsed uuid, but a value that is
 * concatenated into a statement is a value that can only be safe by inspection.
 * The replacement contains no `\` or `&`, the two characters `regexp_replace`
 * gives meaning to on the right-hand side.
 *
 * The `WHERE` is the same regex, so only rows that actually carry the mention
 * are written — this touches `updated_at`, and rewriting every comment in the
 * instance on every account deletion would be a lie in every activity feed.
 * `edited_at` is deliberately NOT touched: a scrub is a system write, and the
 * comment thread's "edited" marker means a human changed the text.
 */
async function scrubMentions(userId: string, tx: Tx): Promise<void> {
  const pattern = `@\\[[^\\]]{1,120}\\]\\(${userId}\\)`;
  const replacement = `@[${DELETED_USER_NAME}](${userId})`;

  await tx
    .update(comments)
    .set({ body: sql`regexp_replace(${comments.body}, ${pattern}, ${replacement}, 'gi')` })
    .where(sql`${comments.body} ~* ${pattern}`);

  await tx
    .update(tasks)
    .set({
      description: sql`regexp_replace(${tasks.description}, ${pattern}, ${replacement}, 'gi')`,
    })
    .where(sql`${tasks.description} ~* ${pattern}`);
}

/** Drop every org and project membership the account holds. Returns the org count. */
async function dropMemberships(userId: string, tx: Tx): Promise<number> {
  const removedOrgs = await tx
    .delete(orgMembers)
    .where(eq(orgMembers.userId, userId))
    .returning({ orgId: orgMembers.orgId });

  // Project roles are a SEPARATE grant, not a projection of org membership, so
  // leaving them would keep the account on project member lists and in assignee
  // pickers after it had been removed from the organization entirely.
  await tx.delete(projectMembers).where(eq(projectMembers.userId, userId));

  return removedOrgs.length;
}

/**
 * `DELETE /api/admin/users/:userId` — ANONYMIZE AND DEACTIVATE.
 *
 * FlowBoard never hard-deletes an account, and the reason is referential rather
 * than sentimental: a user id is the author of comments, the actor on activity
 * rows and the assignee of history the reports replay. Dropping the row would
 * either cascade that history away or leave dangling references that make a task
 * feed unrenderable. So the row survives with its identity scrubbed.
 *
 * What the transaction does, and why each part is not optional:
 *
 *   - **name → "Deleted user", email → `deleted+<uuid>@flowboard.invalid`,
 *     avatar → null.** The identity is what a deletion request is actually
 *     about. The address is REWRITTEN rather than nulled because the column is
 *     NOT NULL and unique on `lower(email)`; the uuid keeps any number of
 *     deletions distinct, and `.invalid` can never resolve.
 *   - **`is_active = false` + `token_version + 1`.** The flag stops the next
 *     sign-in; the bump kills every access AND refresh token already issued.
 *   - **memberships deleted.** Scrubbing a name while leaving the account on
 *     three org member lists would be a deletion that deleted nothing that
 *     mattered.
 *   - **`@[Name](id)` mentions rewritten** in every comment body and task
 *     description ({@link scrubMentions}). The mention encoding stores the
 *     display name captured at write time, so without this the account's real
 *     name survived, rendered, in the one place people actually read — see that
 *     function's header.
 *
 * `user.revoked` is published AFTER the commit, like every other domain event:
 * the bump is only re-checked on the next HTTP request and the next socket
 * HANDSHAKE, which leaves an ALREADY-OPEN socket streaming board and
 * notification traffic to the deleted account until it happens to reconnect. The
 * realtime bridge turns the event into a forced disconnect. Publishing before
 * the commit would let a rolled-back deletion drop live sessions.
 *
 * @throws {ApiError} 404 unknown account, 400 on self-deletion, 409 when the
 * account has already been anonymized.
 */
export async function deleteUser(actorId: string, userId: string): Promise<DeleteUserResponse> {
  const target = await findUserById(userId);
  if (!target) throw ApiError.notFound('User not found');

  // Same rule as self-deactivation, one step further: recovering from it needs
  // another global admin or a database console, and a single-admin deployment
  // has neither.
  if (userId === actorId) {
    throw ApiError.badRequest('You cannot delete your own account');
  }
  if (isAnonymized(target.email)) {
    throw ApiError.conflict('That account has already been deleted');
  }

  const result = await withTx(async (tx) => {
    const membershipsRemoved = await dropMemberships(userId, tx);
    await scrubMentions(userId, tx);

    const [scrubbed] = await tx
      .update(users)
      .set({
        name: DELETED_USER_NAME,
        email: `deleted+${randomUUID()}@${DELETED_EMAIL_DOMAIN}`,
        avatarUrl: null,
        isActive: false,
      })
      .where(eq(users.id, userId))
      .returning();
    if (!scrubbed) throw ApiError.notFound('User not found');

    const revoked = await bumpTokenVersion(userId, tx);
    return { user: toUser(revoked ?? scrubbed), membershipsRemoved };
  });

  publishDomainEvent('user.revoked', { userId });

  return result;
}
