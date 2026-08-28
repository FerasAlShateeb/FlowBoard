/**
 * Invite links — the only way an account is born besides admin provisioning.
 *
 * Two audiences, one table:
 *   - org admins mint / list / revoke invites (`/api/orgs/:orgId/invites`);
 *   - anyone holding the token previews and accepts it (`/api/auth/invites/...`,
 *     public).
 *
 * An invite always grants org membership at `org_role`, and may additionally
 * grant a role on ONE project (the "invite a contractor straight into PROJ"
 * case). Accepting is a single transaction: create-or-attach the account, write
 * both memberships, and stamp the invite consumed.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * The consume step is a CONDITIONAL update (`… WHERE accepted_at IS NULL
 * RETURNING id`). Two concurrent accepts of the same link therefore have
 * exactly one winner at the database level — checking `acceptedAt` in
 * application code first and updating second would let both through under a
 * double-click.
 */
import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import type { CreateInviteInput } from '@flowboard/shared';

import {
  db,
  invites,
  organizations,
  orgMembers,
  projectMembers,
  projects,
  users,
  withTx,
  type InviteRow,
  type Tx,
  type UserRow,
} from '../db';
import { ApiError } from '../utils/api-error';
import { hashPassword } from '../utils/password';
import { toLoginResponse } from './auth.service';
// The `users_email_lower_unique` race — two simultaneous registrations from the
// same open link. The shared predicate walks the Drizzle `cause` chain; the
// local copy this replaced only checked the TOP-LEVEL error, so once Drizzle
// began wrapping driver errors it stopped matching and the loser of that race
// got a 500 instead of a 409. See `pg-errors.ts`.
import { isUniqueViolation } from './pg-errors';
import { findUserByEmail, loadLiveUser, type Executor } from './auth/user-lookup';
import type { InviteResponse } from '../validation/invites.validation';
import type {
  AcceptInviteBody,
  AcceptInviteResponse,
  InvitePreviewResponse,
  InviteStatus,
} from '../validation/auth.validation';

/** Accepted invites stay in the admin list this long, as a "who just joined" trail. */
const ACCEPTED_RETENTION_DAYS = 30;

/** 24 bytes of CSPRNG entropy — 192 bits, URL-safe, 32 characters. */
function generateInviteToken(): string {
  return randomBytes(24).toString('base64url');
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function inviteStatus(row: InviteRow, now = new Date()): InviteStatus {
  if (row.acceptedAt !== null) return 'accepted';
  return row.expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending';
}

/**
 * Reject a link that can no longer be spent.
 *
 * Accepted is a 409 (`conflict`) and expired a 400 (`bad_request`): they are
 * different remedies — "you already have access, sign in" versus "ask for a new
 * link" — and the web landing page branches on the code to say so.
 */
function assertSpendable(row: InviteRow): void {
  const status = inviteStatus(row);
  if (status === 'accepted') {
    throw ApiError.conflict('This invitation has already been accepted');
  }
  if (status === 'expired') {
    throw ApiError.badRequest('This invitation has expired');
  }
}

async function findInviteByToken(
  token: string,
  executor: Executor = db,
): Promise<InviteRow | undefined> {
  const [row] = await executor.select().from(invites).where(eq(invites.token, token)).limit(1);
  return row;
}

// ---------------------------------------------------------------------------
// Org admin surface — /api/orgs/:orgId/invites
// ---------------------------------------------------------------------------

/**
 * `GET /api/orgs/:orgId/invites`.
 *
 * Returns live links plus recently-accepted ones. Expired-and-unaccepted rows
 * are omitted: they are noise on a screen whose job is "who can still get in",
 * and they remain revocable by id.
 */
export async function listInvites(orgId: string): Promise<InviteResponse[]> {
  const now = new Date();
  const acceptedSince = new Date(now.getTime() - ACCEPTED_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.orgId, orgId),
        or(
          and(isNull(invites.acceptedAt), gt(invites.expiresAt, now)),
          and(isNotNull(invites.acceptedAt), gt(invites.acceptedAt, acceptedSince)),
        ),
      ),
    )
    .orderBy(desc(invites.createdAt));

  // Creator summaries in one extra query rather than a LEFT JOIN: the join
  // would nullify every selected `users` column at the type level for a
  // relationship that is null only in the "inviter's row was removed" corner
  // case, and the list is a page of rows, not a stream.
  const creatorIds = [
    ...new Set(rows.map((row) => row.invitedById).filter((id): id is string => id !== null)),
  ];
  const creators =
    creatorIds.length === 0
      ? []
      : await db
          .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
          .from(users)
          .where(inArray(users.id, creatorIds));
  const creatorById = new Map(creators.map((creator) => [creator.id, creator]));

  return rows.map((row) => ({
    ...toInviteResponse(row),
    createdBy: row.invitedById === null ? null : (creatorById.get(row.invitedById) ?? null),
  }));
}

/** Row → wire, minus the `createdBy` join the callers assemble themselves. */
function toInviteResponse(row: InviteRow): Omit<InviteResponse, 'createdBy'> {
  return {
    id: row.id,
    orgId: row.orgId,
    email: row.email,
    orgRole: row.orgRole,
    projectId: row.projectId,
    projectRole: row.projectRole,
    token: row.token,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt === null ? null : row.acceptedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `POST /api/orgs/:orgId/invites` — mint a link.
 *
 * @throws {ApiError} 400 when the optional project grant points outside this
 * org (or at a deleted project) — a cross-org grant would be a privilege
 * escalation dressed up as a typo, and 409 when the address is already a member.
 */
export async function createInvite(
  orgId: string,
  actorId: string,
  input: CreateInviteInput,
): Promise<InviteResponse> {
  if (input.projectId !== null) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.orgId, orgId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (!project) {
      throw ApiError.badRequest('That project does not belong to this organization');
    }
  }

  if (input.email !== null) {
    const existing = await findUserByEmail(input.email);
    if (existing) {
      const [membership] = await db
        .select({ userId: orgMembers.userId })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, existing.id)))
        .limit(1);
      if (membership) {
        throw ApiError.conflict('That person is already a member of this organization');
      }
    }
  }

  const [row] = await db
    .insert(invites)
    .values({
      orgId,
      token: generateInviteToken(),
      email: input.email,
      orgRole: input.orgRole,
      projectId: input.projectId,
      projectRole: input.projectRole,
      invitedById: actorId,
      expiresAt: daysFromNow(input.expiresInDays),
    })
    .returning();
  if (!row) throw ApiError.internal('Failed to create the invitation');

  const [actor] = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);

  return { ...toInviteResponse(row), createdBy: actor ?? null };
}

/**
 * `DELETE /api/orgs/:orgId/invites/:inviteId` — revoke.
 *
 * Hard delete: an unspent invite is a credential, and the right way to store a
 * revoked credential is not at all. The `orgId` predicate is what stops an
 * admin of org A from deleting org B's row through a guessed id.
 *
 * @throws {ApiError} 409 when the link was already accepted — deleting it then
 * would erase the audit trail of how someone got in, and revoking it would not
 * take their membership away anyway.
 */
export async function revokeInvite(orgId: string, inviteId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.orgId, orgId)))
    .limit(1);
  if (!row) throw ApiError.notFound('Invitation not found');
  if (row.acceptedAt !== null) {
    throw ApiError.conflict('This invitation has already been accepted');
  }

  await db.delete(invites).where(and(eq(invites.id, inviteId), eq(invites.orgId, orgId)));
}

// ---------------------------------------------------------------------------
// Public surface — /api/auth/invites/:token
// ---------------------------------------------------------------------------

/**
 * `GET /api/auth/invites/:token` — the UNAUTHENTICATED landing-page preview.
 *
 * Carries no ids by contract (see `invitePreviewSchema`): someone holding a
 * leaked token learns the org's name and who invited them, and nothing they
 * could address a row with. Expired and accepted links still preview — the page
 * has to be able to say *why* it is not offering a form.
 */
export async function previewInvite(token: string): Promise<InvitePreviewResponse> {
  const [row] = await db
    .select({
      invite: invites,
      orgName: organizations.name,
      projectName: projects.name,
      invitedByName: users.name,
    })
    .from(invites)
    .innerJoin(organizations, eq(invites.orgId, organizations.id))
    .leftJoin(projects, eq(invites.projectId, projects.id))
    .leftJoin(users, eq(invites.invitedById, users.id))
    .where(and(eq(invites.token, token), isNull(organizations.deletedAt)))
    .limit(1);

  if (!row) throw ApiError.notFound('Invitation not found');

  // "Does this address already have an account?" decides which form the page
  // renders — signup, or the one-button "join as <you>" attach. An unlocked
  // link cannot know, so it defaults to the signup form.
  const requiresAccount =
    row.invite.email === null ? true : (await findUserByEmail(row.invite.email)) === undefined;

  return {
    orgName: row.orgName,
    orgRole: row.invite.orgRole,
    projectName: row.projectName,
    projectRole: row.invite.projectRole,
    invitedByName: row.invitedByName ?? 'A FlowBoard administrator',
    email: row.invite.email,
    expiresAt: row.invite.expiresAt.toISOString(),
    requiresAccount,
    status: inviteStatus(row.invite),
  };
}

/** Write the org (and optional project) grant. Idempotent — re-accepting is not an error. */
async function grantMemberships(tx: Tx, invite: InviteRow, userId: string): Promise<void> {
  await tx
    .insert(orgMembers)
    .values({ orgId: invite.orgId, userId, role: invite.orgRole })
    .onConflictDoNothing();

  if (invite.projectId !== null && invite.projectRole !== null) {
    await tx
      .insert(projectMembers)
      .values({ projectId: invite.projectId, userId, role: invite.projectRole })
      .onConflictDoNothing();
  }
}

/**
 * Stamp the invite consumed, atomically.
 *
 * @throws {ApiError} 409 when another request got there first — the conditional
 * `WHERE accepted_at IS NULL` is the whole concurrency story.
 */
async function consumeInvite(tx: Tx, inviteId: string, userId: string): Promise<void> {
  const consumed = await tx
    .update(invites)
    .set({ acceptedAt: new Date(), acceptedById: userId })
    .where(and(eq(invites.id, inviteId), isNull(invites.acceptedAt)))
    .returning({ id: invites.id });

  if (consumed.length === 0) {
    throw ApiError.conflict('This invitation has already been accepted');
  }
}

/** `mode: 'register'` — an anonymous visitor creating the account the link is for. */
async function acceptAsNewAccount(
  invite: InviteRow,
  body: Extract<AcceptInviteBody, { mode: 'register' }>,
): Promise<UserRow> {
  // The address comes from the invite whenever it has one. Only an UNLOCKED
  // link reads the body — otherwise the token would be a factory for accounts
  // at arbitrary addresses.
  const email = invite.email ?? body.email;
  if (email === undefined) {
    throw ApiError.badRequest('This invitation requires an email address');
  }
  if (invite.email !== null && body.email !== undefined && body.email !== invite.email) {
    throw ApiError.badRequest('This invitation is locked to a different email address');
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    throw ApiError.conflict('An account with that email already exists — sign in to accept');
  }

  const passwordHash = await hashPassword(body.password);

  try {
    return await withTx(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email, name: body.name, passwordHash })
        .returning();
      if (!created) throw ApiError.internal('Failed to create the account');

      await grantMemberships(tx, invite, created.id);
      await consumeInvite(tx, invite.id, created.id);
      return created;
    });
  } catch (error) {
    // The `lower(email)` unique index is the real arbiter; the lookup above is
    // only a fast path. Two simultaneous registrations lose here, not with a 500.
    if (isUniqueViolation(error)) {
      throw ApiError.conflict('An account with that email already exists — sign in to accept');
    }
    throw error;
  }
}

/** `mode: 'attach'` — a signed-in user adding this org to an account they already have. */
async function acceptAsExistingAccount(
  invite: InviteRow,
  actor: { id: string; tokenVersion: number },
): Promise<UserRow> {
  const user = await loadLiveUser(actor.id, actor.tokenVersion);

  if (invite.email !== null && user.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw ApiError.forbidden('This invitation was issued to a different email address');
  }

  return withTx(async (tx) => {
    await grantMemberships(tx, invite, user.id);
    await consumeInvite(tx, invite.id, user.id);
    // Re-read inside the transaction so the returned row (and therefore the
    // token pair minted from it) cannot be a version behind a concurrent
    // admin action.
    const [fresh] = await tx.select().from(users).where(eq(users.id, user.id)).limit(1);
    return fresh ?? user;
  });
}

/**
 * `POST /api/auth/invites/:token/accept` — public, two modes.
 *
 * @param actor the caller's verified identity when they arrived with a Bearer
 * token, else `null`. `mode: 'attach'` requires one; `mode: 'register'` refuses
 * one, because signing in and then registering a second account from the same
 * link is a mistake, not a workflow.
 */
export async function acceptInvite(
  token: string,
  body: AcceptInviteBody,
  actor: { id: string; tokenVersion: number } | null,
): Promise<AcceptInviteResponse> {
  const invite = await findInviteByToken(token);
  if (!invite) throw ApiError.notFound('Invitation not found');

  // The org must still exist: a link into a deleted org is dead, not pending.
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.id, invite.orgId), isNull(organizations.deletedAt)))
    .limit(1);
  if (!org) throw ApiError.notFound('Invitation not found');

  assertSpendable(invite);

  let row: UserRow;
  if (body.mode === 'attach') {
    if (!actor) {
      throw ApiError.unauthorized('Sign in to accept this invitation with your existing account');
    }
    row = await acceptAsExistingAccount(invite, actor);
  } else {
    if (actor) {
      throw ApiError.badRequest('You are already signed in — accept this invitation as yourself');
    }
    row = await acceptAsNewAccount(invite, body);
  }

  return {
    ...toLoginResponse(row),
    orgId: invite.orgId,
    projectId: invite.projectId,
  };
}
