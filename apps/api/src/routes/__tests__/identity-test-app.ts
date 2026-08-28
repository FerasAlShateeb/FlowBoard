/**
 * Shared fixtures for WP2.1's integration suites (auth, invites, admin users).
 *
 * `buildTestApp()` assembles the SAME routers the real `app.ts` mounts, at the
 * same paths, wrapped in the same error handler — so a test that passes here
 * cannot pass for a reason production does not share. It deliberately does not
 * import `app.ts`: that would drag in CORS, the request logger, the socket
 * bootstrap and the global rate limiter, none of which these suites are about,
 * and would couple WP2.1's tests to a file another work package owns.
 *
 * Not named `*.test.ts` on purpose — vitest's `include` glob would treat it as
 * a suite with no tests.
 */
import { eq } from 'drizzle-orm';
import express, { type Express } from 'express';

import { errorHandler, notFound } from '../../middlewares/error-handler';
import {
  db,
  invites,
  organizations,
  orgMembers,
  projectMembers,
  projects,
  users,
  type InviteRow,
  type OrganizationRow,
  type ProjectRow,
  type UserRow,
} from '../../db';
import { hashPassword } from '../../utils/password';
import { signAccessToken, signRefreshToken } from '../../utils/jwt';
import { adminUsersRouter } from '../admin-users.routes';
import { authRouter } from '../auth.routes';
import { invitesRouter } from '../invites.routes';

/** The password every seeded account gets unless a test says otherwise. */
export const TEST_PASSWORD = 'correct-horse-battery';

export function buildTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api/orgs/:orgId/invites', invitesRouter);
  app.use('/api/admin/users', adminUsersRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

interface SeedUserOptions {
  email?: string;
  name?: string;
  password?: string;
  isGlobalAdmin?: boolean;
  isActive?: boolean;
  locale?: string;
}

let emailCounter = 0;

/** Insert a `users` row. Every field has a sane default; override what matters. */
export async function seedUser(options: SeedUserOptions = {}): Promise<UserRow> {
  emailCounter += 1;
  const email = options.email ?? `user${String(emailCounter)}@flowboard.dev`;
  const [row] = await db
    .insert(users)
    .values({
      email,
      name: options.name ?? `User ${String(emailCounter)}`,
      passwordHash: await hashPassword(options.password ?? TEST_PASSWORD),
      isGlobalAdmin: options.isGlobalAdmin ?? false,
      isActive: options.isActive ?? true,
      locale: options.locale ?? 'en',
    })
    .returning();
  if (!row) throw new Error('seedUser: insert returned no row');
  return row;
}

let slugCounter = 0;

/** Insert an `organizations` row. */
export async function seedOrg(
  options: { name?: string; slug?: string; createdById?: string } = {},
): Promise<OrganizationRow> {
  slugCounter += 1;
  const [row] = await db
    .insert(organizations)
    .values({
      name: options.name ?? `Org ${String(slugCounter)}`,
      slug: options.slug ?? `org-${String(slugCounter)}`,
      createdById: options.createdById ?? null,
    })
    .returning();
  if (!row) throw new Error('seedOrg: insert returned no row');
  return row;
}

/** Put a user in an org. */
export async function seedOrgMember(
  orgId: string,
  userId: string,
  role: 'admin' | 'member' = 'member',
): Promise<void> {
  await db.insert(orgMembers).values({ orgId, userId, role }).onConflictDoNothing();
}

let projectCounter = 0;

/** Insert a `projects` row. `key` must match `^[A-Z][A-Z0-9]{1,9}$`. */
export async function seedProject(
  orgId: string,
  options: { key?: string; name?: string } = {},
): Promise<ProjectRow> {
  projectCounter += 1;
  const [row] = await db
    .insert(projects)
    .values({
      orgId,
      key: options.key ?? `PRJ${String(projectCounter)}`,
      name: options.name ?? `Project ${String(projectCounter)}`,
    })
    .returning();
  if (!row) throw new Error('seedProject: insert returned no row');
  return row;
}

/** Insert an `invites` row directly — for the expired / pre-accepted cases. */
export async function seedInvite(
  orgId: string,
  options: {
    token: string;
    email?: string | null;
    orgRole?: 'admin' | 'member';
    projectId?: string | null;
    projectRole?: 'admin' | 'member' | 'viewer' | null;
    invitedById?: string | null;
    expiresAt?: Date;
    acceptedAt?: Date | null;
    acceptedById?: string | null;
  },
): Promise<InviteRow> {
  const [row] = await db
    .insert(invites)
    .values({
      orgId,
      token: options.token,
      email: options.email ?? null,
      orgRole: options.orgRole ?? 'member',
      projectId: options.projectId ?? null,
      projectRole: options.projectRole ?? null,
      invitedById: options.invitedById ?? null,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
      acceptedAt: options.acceptedAt ?? null,
      acceptedById: options.acceptedById ?? null,
    })
    .returning();
  if (!row) throw new Error('seedInvite: insert returned no row');
  return row;
}

/**
 * Mint a token pair for a row WITHOUT going through `/login`.
 *
 * Used when a test cares about what happens after authentication, not about
 * authentication itself — it also skips a scrypt verification per call, which
 * is most of the runtime of a suite this size.
 */
export function tokensFor(row: Pick<UserRow, 'id' | 'tokenVersion' | 'isGlobalAdmin'>): {
  accessToken: string;
  refreshToken: string;
} {
  const claims = {
    sub: row.id,
    tokenVersion: row.tokenVersion,
    isGlobalAdmin: row.isGlobalAdmin,
  };
  return { accessToken: signAccessToken(claims), refreshToken: signRefreshToken(claims) };
}

/** `Authorization` header value for a signed token. */
export function bearer(token: string): string {
  return `Bearer ${token}`;
}

/** Read back the org roles a user holds — asserting invite/provision side effects. */
export async function orgRolesOf(userId: string): Promise<{ orgId: string; role: string }[]> {
  return db
    .select({ orgId: orgMembers.orgId, role: orgMembers.role })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId));
}

/** Read back the project roles a user holds. */
export async function projectRolesOf(
  userId: string,
): Promise<{ projectId: string; role: string }[]> {
  return db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));
}
