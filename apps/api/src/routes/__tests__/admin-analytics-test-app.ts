/**
 * Fixtures for W1.2's analytics suite.
 *
 * `buildAnalyticsTestApp()` mounts `adminAnalyticsRouter` at the SAME prefix
 * `routes/index.ts` uses, behind the same error handler, so a path that resolves
 * here resolves in production. It deliberately does not import `app.ts`: that
 * would drag in CORS, the global rate limiter and — fatally for this suite — the
 * request-logger middleware, which would write `request_logs` rows of its own
 * and corrupt every traffic fixture below.
 *
 * EVERY SEEDER TAKES AN EXPLICIT `createdAt`. That is the whole point of this
 * module rather than the two it borrows from: the aggregations are about time,
 * and `identity-test-app.ts`'s builders stamp `now`, which cannot express a
 * bucket boundary, a window edge or an org that was created eleven months ago.
 * The two seeders that already take an instant (`seedEvent`, `seedRequestLog`)
 * are re-exported from `telemetry-test-app.ts` rather than copied — one
 * definition of "a telemetry row" for both suites.
 *
 * Not named `*.test.ts`: vitest's `include` glob would treat it as a suite with
 * no tests.
 */
import express, { type Express } from 'express';
import { eq, sql } from 'drizzle-orm';
import { rankBetween } from '@flowboard/shared';

import {
  db,
  invites,
  organizations,
  orgMembers,
  projects,
  statuses,
  tasks,
  users,
  type OrganizationRow,
  type ProjectRow,
  type UserRow,
} from '../../db';
import { errorHandler, notFound } from '../../middlewares/error-handler';
import { adminAnalyticsRouter } from '../admin-analytics.routes';

export { bearer, tokensFor } from './identity-test-app';
export { at, daysFrom, hoursFrom, seedEvent, seedRequestLog } from './telemetry-test-app';

export function buildAnalyticsTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/analytics', adminAnalyticsRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

let sequence = 0;
/** Monotonic suffix so emails, slugs and project keys stay unique in a suite. */
function nextId(): number {
  sequence += 1;
  return sequence;
}

/**
 * A `users` row with a controllable `created_at` — the signups series reads that
 * column, so "a user who signed up three days ago" has to be expressible.
 *
 * The password hash is a bcrypt-shaped constant: nothing in this suite verifies
 * a password, and hashing one per fixture would dominate its runtime.
 */
export async function seedAnalyticsUser(
  options: { name?: string; isGlobalAdmin?: boolean; createdAt?: Date } = {},
): Promise<UserRow> {
  const id = nextId();
  const [row] = await db
    .insert(users)
    .values({
      email: `w12-user${String(id)}@flowboard.dev`,
      name: options.name ?? `User ${String(id)}`,
      passwordHash: '$2b$10$abcdefghijklmnopqrstuv0123456789012345678901234567890',
      isGlobalAdmin: options.isGlobalAdmin ?? false,
      ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    })
    .returning();
  if (!row) throw new Error('seedAnalyticsUser inserted nothing');
  return row;
}

/** An `organizations` row, optionally back-dated and/or soft-deleted. */
export async function seedAnalyticsOrg(
  options: { name?: string; createdAt?: Date; deletedAt?: Date | null } = {},
): Promise<OrganizationRow> {
  const id = nextId();
  const [row] = await db
    .insert(organizations)
    .values({
      slug: `w12-org-${String(id)}`,
      name: options.name ?? `Org ${String(id)}`,
      deletedAt: options.deletedAt ?? null,
      ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    })
    .returning();
  if (!row) throw new Error('seedAnalyticsOrg inserted nothing');
  return row;
}

/** Put a user in an org — the `memberCount` column of the growth table. */
export async function seedMembership(orgId: string, userId: string): Promise<void> {
  await db.insert(orgMembers).values({ orgId, userId, role: 'member' }).onConflictDoNothing();
}

/** A `projects` row, optionally soft-deleted. */
export async function seedAnalyticsProject(
  orgId: string,
  options: { key?: string; name?: string; deletedAt?: Date | null } = {},
): Promise<ProjectRow> {
  const id = nextId();
  const [row] = await db
    .insert(projects)
    .values({
      orgId,
      key: `W${String(id)}`,
      name: options.name ?? `Project ${String(id)}`,
      deletedAt: options.deletedAt ?? null,
    })
    .returning();
  if (!row) throw new Error('seedAnalyticsProject inserted nothing');
  return row;
}

/** The one `done` column every fixture project needs — `tasks.status_id` is NOT NULL. */
export async function seedDoneStatus(projectId: string): Promise<string> {
  const [row] = await db
    .insert(statuses)
    .values({ projectId, name: 'Done', category: 'done', position: 0, color: '#22c55e' })
    .returning({ id: statuses.id });
  if (!row) throw new Error('seedDoneStatus inserted nothing');
  return row.id;
}

let lastRank: string | null = null;

/** The next ascending fractional index — chained through the shared generator. */
function nextRank(): string {
  lastRank = rankBetween(lastRank, null);
  return lastRank;
}

/** Everything a task fixture needs, with the project's status resolved once. */
export interface ProjectRef {
  id: string;
  key: string;
  orgId: string;
  statusId: string;
}

/** An org-less convenience: a live project with a `done` column, ready for tasks. */
export async function seedProjectRef(
  orgId: string,
  options: { name?: string; deletedAt?: Date | null } = {},
): Promise<ProjectRef> {
  const project = await seedAnalyticsProject(orgId, options);
  return {
    id: project.id,
    key: project.key,
    orgId,
    statusId: await seedDoneStatus(project.id),
  };
}

/**
 * One `tasks` row with an explicit lifetime.
 *
 * `resolvedAt` is the completion clock the work domain reads — there is no
 * `completed_at` column — and `createdAt` is the other end of the cycle-time
 * measurement, so both are first-class options here.
 */
export async function seedAnalyticsTask(
  project: ProjectRef,
  options: {
    createdAt: Date;
    resolvedAt?: Date | null;
    storyPoints?: number | null;
    deletedAt?: Date | null;
    title?: string;
  },
): Promise<string> {
  const [counter] = await db
    .update(projects)
    .set({ taskCounter: sql`${projects.taskCounter} + 1` })
    .where(eq(projects.id, project.id))
    .returning({ number: projects.taskCounter });
  if (!counter) throw new Error('seedAnalyticsTask could not allocate a number');

  const [row] = await db
    .insert(tasks)
    .values({
      projectId: project.id,
      number: counter.number,
      title: options.title ?? `Task ${String(counter.number)}`,
      statusId: project.statusId,
      boardRank: nextRank(),
      backlogRank: nextRank(),
      createdAt: options.createdAt,
      resolvedAt: options.resolvedAt ?? null,
      storyPoints: options.storyPoints ?? null,
      deletedAt: options.deletedAt ?? null,
    })
    .returning({ id: tasks.id });
  if (!row) throw new Error('seedAnalyticsTask inserted nothing');
  return row.id;
}

/** One `invites` row with both of its instants under the test's control. */
export async function seedAnalyticsInvite(
  orgId: string,
  options: { createdAt: Date; acceptedAt?: Date | null },
): Promise<void> {
  const id = nextId();
  await db.insert(invites).values({
    orgId,
    token: `w12-token-${String(id)}`,
    expiresAt: new Date(options.createdAt.getTime() + 7 * 86_400_000),
    createdAt: options.createdAt,
    acceptedAt: options.acceptedAt ?? null,
  });
}
