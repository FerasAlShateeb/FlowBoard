/**
 * ARCHIVING AN ORGANIZATION REVOKES ITS PROJECTS — the regression suite for the
 * R2 W3.5 finding documented at the top of `middlewares/require-roles.ts`.
 *
 * The archive is ONE `UPDATE organizations SET deleted_at` (see
 * `orgs.service.softDeleteOrg`): no project, task, comment or membership row is
 * touched, deliberately, so a restore needs no compensating write. That design
 * puts the whole burden of "this org is switched off" on the READ paths — and
 * the project guards were not carrying it. `requireOrgRole` filtered on
 * `deleted_at` because it had an `:orgId`; `requireProjectRole` never looked at
 * the org at all, so every project-scoped route stayed fully open to the
 * archived org's members, and to global admins, for reads AND writes.
 *
 * Two layers are asserted here, because they fail independently:
 *
 *  1. **`resolveProjectRef`, on all five param sources.** The `guardApp` below
 *     mounts `requireProjectRole` five times, once per {@link ProjectIdSource},
 *     against a route that does nothing but echo the resolved access. That is
 *     the narrowest possible probe of the function that changed, and it is what
 *     stops a future edit from fixing four joins and forgetting the fifth.
 *  2. **The real routers.** A ref check that 404s but a role check that still
 *     says `admin` would be a latent hole the moment something resolves a ref
 *     another way, so the task and project routers are driven end to end for a
 *     read and a write.
 *
 * The restore half is asserted in the same test as the revocation, never in a
 * separate one: "archiving revokes" and "restoring returns" are the same claim
 * about the same reversible flag, and splitting them lets a fix that revokes
 * permanently pass one of them.
 */
import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  attachments,
  closeDb,
  comments,
  db,
  organizations,
  orgMembers,
  projectMembers,
} from '../../db';
import { errorHandler, notFound } from '../../middlewares/error-handler';
import { requireAuth } from '../../middlewares/require-auth';
import { getProjectAccess, requireProjectRole } from '../../middlewares/require-roles';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { projectsRouter } from '../projects.routes';
import {
  auth,
  createTaskTestApp,
  seedSprint,
  seedTask,
  seedUser,
  seedWorld,
  type World,
} from './task-domain.fixtures';

/**
 * A router whose only job is to run `requireProjectRole` and report what it
 * resolved, one route per param source.
 *
 * `viewer` is the floor everywhere: the point of this app is the REF lookup, and
 * asking for the lowest role keeps a failure unambiguously about resolution
 * rather than about a rank comparison.
 */
function createGuardApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(requireAuth);

  const echo = (path: string, source: Parameters<typeof requireProjectRole>[1]) => {
    app.get(path, requireProjectRole('viewer', source), (_req, res) => {
      res.json({ success: true, data: getProjectAccess(res) });
    });
  };

  echo('/by-project/:projectId', 'projectId');
  echo('/by-task/:taskId', 'taskId');
  echo('/by-sprint/:sprintId', 'sprintId');
  echo('/by-comment/:commentId', 'commentId');
  echo('/by-attachment/:attachmentId', 'attachmentId');

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

const guardApp = createGuardApp();
const taskApp = createTaskTestApp();

/** The projects router on its own — `GET/PATCH /api/projects/:projectId`. */
function createProjectApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use('/api/projects', projectsRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

const projectApp = createProjectApp();

/** Flip the org's `deleted_at`. `null` restores it. */
async function setOrgArchived(orgId: string, archived: boolean): Promise<void> {
  await db
    .update(organizations)
    .set({ deletedAt: archived ? new Date() : null })
    .where(eq(organizations.id, orgId));
}

/** One comment and one attachment on `taskId`, for the last two sources. */
async function seedCommentAndAttachment(
  world: World,
  taskId: string,
): Promise<{ commentId: string; attachmentId: string }> {
  const [comment] = await db
    .insert(comments)
    .values({ taskId, authorId: world.member.id, body: 'still readable?' })
    .returning({ id: comments.id });
  const [attachment] = await db
    .insert(attachments)
    .values({
      taskId,
      uploadedById: world.member.id,
      fileName: 'spec.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      s3Key: `k/${taskId}/spec.pdf`,
      confirmedAt: new Date(),
    })
    .returning({ id: attachments.id });
  if (!comment || !attachment) throw new Error('comment/attachment fixture inserted nothing');
  return { commentId: comment.id, attachmentId: attachment.id };
}

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await closeDb();
});

describe('resolveProjectRef — org liveness on every param source', () => {
  it('resolves all five sources while the org is live, none while it is archived, and all five again after a restore', async () => {
    const world = await seedWorld();
    const taskId = await seedTask(world);
    const sprintId = await seedSprint(world);
    const { commentId, attachmentId } = await seedCommentAndAttachment(world, taskId);

    const paths = [
      `/by-project/${world.projectId}`,
      `/by-task/${taskId}`,
      `/by-sprint/${sprintId}`,
      `/by-comment/${commentId}`,
      `/by-attachment/${attachmentId}`,
    ];
    const statuses = async (): Promise<number[]> => {
      const responses = await Promise.all(
        paths.map((path) => request(guardApp).get(path).set('Authorization', auth(world.member))),
      );
      return responses.map((response) => response.status);
    };

    expect(await statuses()).toEqual([200, 200, 200, 200, 200]);

    await setOrgArchived(world.orgId, true);
    // 404 and not 403: a project in an archived org does not RESOLVE, which is
    // the same answer the guards already gave for a soft-deleted project.
    expect(await statuses()).toEqual([404, 404, 404, 404, 404]);

    await setOrgArchived(world.orgId, false);
    expect(await statuses()).toEqual([200, 200, 200, 200, 200]);
  });

  it('refuses a GLOBAL ADMIN too — the ref check runs before any role is considered', async () => {
    const world = await seedWorld();
    const admin = await seedUser({ isGlobalAdmin: true });

    await setOrgArchived(world.orgId, true);

    const res = await request(guardApp)
      .get(`/by-project/${world.projectId}`)
      .set('Authorization', auth(admin));

    expect(res.status).toBe(404);
  });

  it('refuses an ORG ADMIN — an org_members row in an archived org grants nothing', async () => {
    const world = await seedWorld();
    await db
      .update(orgMembers)
      .set({ role: 'admin' })
      .where(eq(orgMembers.userId, world.outsider.id));

    await setOrgArchived(world.orgId, true);

    const res = await request(guardApp)
      .get(`/by-project/${world.projectId}`)
      .set('Authorization', auth(world.outsider));

    expect(res.status).toBe(404);
  });
});

describe('the real routers, once the org is archived', () => {
  it("404s a member's task READ and task WRITE, and lets both through again after a restore", async () => {
    const world = await seedWorld();
    const taskId = await seedTask(world, { title: 'Before the archive' });

    await setOrgArchived(world.orgId, true);

    const read = await request(taskApp)
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member));
    expect(read.status).toBe(404);

    const write = await request(taskApp)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member))
      .send({ title: 'After the archive' });
    expect(write.status).toBe(404);
    expect(write.body.success).toBe(false);

    // A move is the write that also broadcasts and writes activity — the one
    // that would have leaked a live board to an org that is switched off.
    const move = await request(taskApp)
      .post(`/api/tasks/${taskId}/move`)
      .set('Authorization', auth(world.member))
      .send({ statusId: world.statuses.inProgress });
    expect(move.status).toBe(404);

    await setOrgArchived(world.orgId, false);

    const readAgain = await request(taskApp)
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member));
    expect(readAgain.status).toBe(200);
    // The archive changed nothing about the row — the title is still the one
    // the refused PATCH never got to write.
    expect(readAgain.body.data.title).toBe('Before the archive');
  });

  it('404s the project detail endpoint for a project admin', async () => {
    const world = await seedWorld();
    await db
      .update(projectMembers)
      .set({ role: 'admin' })
      .where(eq(projectMembers.userId, world.admin.id));

    await setOrgArchived(world.orgId, true);

    const res = await request(projectApp)
      .get(`/api/projects/${world.projectId}`)
      .set('Authorization', auth(world.admin));

    expect(res.status).toBe(404);
  });

  it('leaves a LIVE sibling org untouched — the filter is per org, not global', async () => {
    const archived = await seedWorld();
    const live = await seedWorld();

    await setOrgArchived(archived.orgId, true);

    const blocked = await request(projectApp)
      .get(`/api/projects/${archived.projectId}`)
      .set('Authorization', auth(archived.member));
    const allowed = await request(projectApp)
      .get(`/api/projects/${live.projectId}`)
      .set('Authorization', auth(live.member));

    expect(blocked.status).toBe(404);
    expect(allowed.status).toBe(200);
  });
});
