/**
 * `/api/projects/:projectId/labels` integration suite.
 *
 * The one deliberate difference from the rest of project configuration: writes
 * sit at the `member` floor, because tagging is part of doing the work. The
 * matrix therefore asserts that a VIEWER is refused and a MEMBER succeeds — the
 * opposite of the workflow suite, and easy to get wrong.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { closeDb, db, labels, taskLabels } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { clearDomainEventHandlers, onDomainEvent } from '../../utils/domain-events';
import type { DomainEventMap } from '../../utils/domain-events';
import { bearer, createLabel, createProjectWorld, createTask, createTestApp } from './fixtures';

const app = createTestApp();

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterEach(() => {
  clearDomainEventHandlers();
});

afterAll(async () => {
  await closeDb();
});

describe('GET /api/projects/:projectId/labels', () => {
  it('lists labels to a viewer', async () => {
    const world = await createProjectWorld();
    await createLabel(world.project.id, { name: 'backend', color: '#123456' });

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/labels`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: expect.any(String), projectId: world.project.id, name: 'backend', color: '#123456' },
    ]);
  });

  it('403s an org member with no project role', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/labels`)
      .set('Authorization', bearer(world.orgMember));

    expect(res.status).toBe(403);
  });
});

describe('POST /api/projects/:projectId/labels', () => {
  it('403s a viewer', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/projects/${world.project.id}/labels`)
      .set('Authorization', bearer(world.projectViewer))
      .send({ name: 'backend', color: '#123456' });

    expect(res.status).toBe(403);
  });

  it('creates for a project member and announces a labels change', async () => {
    const world = await createProjectWorld();
    const seen: DomainEventMap['workflow.changed'][] = [];
    onDomainEvent('workflow.changed', (payload) => {
      seen.push(payload);
    });

    const res = await request(app)
      .post(`/api/projects/${world.project.id}/labels`)
      .set('Authorization', bearer(world.projectMember))
      .send({ name: 'backend', color: '#123456' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'backend', color: '#123456' });
    expect(seen).toEqual([
      {
        projectId: world.project.id,
        actorId: world.projectMember.id,
        originSocketId: null,
        change: 'labels',
      },
    ]);
  });

  it('409s a duplicate label name in the same project', async () => {
    const world = await createProjectWorld();
    await createLabel(world.project.id, { name: 'backend' });

    const res = await request(app)
      .post(`/api/projects/${world.project.id}/labels`)
      .set('Authorization', bearer(world.projectMember))
      .send({ name: 'backend', color: '#000000' });

    expect(res.status).toBe(409);
  });

  it('422s a colour that is not hex', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/projects/${world.project.id}/labels`)
      .set('Authorization', bearer(world.projectMember))
      .send({ name: 'backend', color: 'slate' });

    expect(res.status).toBe(422);
  });
});

describe('PATCH /api/projects/:projectId/labels/:labelId', () => {
  it('403s a viewer', async () => {
    const world = await createProjectWorld();
    const label = await createLabel(world.project.id);

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}/labels/${label.id}`)
      .set('Authorization', bearer(world.projectViewer))
      .send({ name: 'renamed' });

    expect(res.status).toBe(403);
  });

  it('updates for a project member', async () => {
    const world = await createProjectWorld();
    const label = await createLabel(world.project.id);

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}/labels/${label.id}`)
      .set('Authorization', bearer(world.projectMember))
      .send({ name: 'renamed', color: '#abcdef' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: label.id, name: 'renamed', color: '#abcdef' });
  });

  it('404s a label from another project', async () => {
    const world = await createProjectWorld();
    const otherLabel = await createLabel((await createProjectWorld()).project.id);

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}/labels/${otherLabel.id}`)
      .set('Authorization', bearer(world.projectMember))
      .send({ name: 'renamed' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/projects/:projectId/labels/:labelId', () => {
  it('403s a viewer', async () => {
    const world = await createProjectWorld();
    const label = await createLabel(world.project.id);

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/labels/${label.id}`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(403);
  });

  it('deletes for a project member and cascades the task assignments', async () => {
    const world = await createProjectWorld();
    const label = await createLabel(world.project.id);
    const task = await createTask(world.project.id, world.project.statusIds[0]);
    await db.insert(taskLabels).values({ taskId: task.id, labelId: label.id });

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/labels/${label.id}`)
      .set('Authorization', bearer(world.projectMember));

    expect(res.status).toBe(204);
    expect(await db.select().from(labels).where(eq(labels.id, label.id))).toEqual([]);
    expect(await db.select().from(taskLabels).where(eq(taskLabels.taskId, task.id))).toEqual([]);
  });
});
