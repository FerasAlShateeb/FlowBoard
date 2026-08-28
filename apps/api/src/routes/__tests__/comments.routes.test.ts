/**
 * Comment threads and the mention fan-out.
 *
 * The mention assertions are the load-bearing ones: recipients are DERIVED from
 * the stored body, never taken from the request, so a body that names nobody
 * notifies nobody no matter what the client claims — and a body that names
 * somebody outside the project is refused outright.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Comment, Task } from '@flowboard/shared';

import { activity, closeDb, comments, db } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  auth,
  captureDomainEvent,
  captureTelemetry,
  createTaskTestApp,
  flushAsync,
  seedTask,
  seedWorld,
  stopDomainEvents,
  stopTelemetry,
  type World,
} from './task-domain.fixtures';

const app = createTaskTestApp();
let world: World;
let taskId: string;

beforeAll(async () => {
  await ensureTestDb();
}, 60_000);

beforeEach(async () => {
  await truncateAllTables();
  world = await seedWorld();
  taskId = await seedTask(world, { title: 'Discussed' });
});

afterEach(() => {
  stopTelemetry();
  stopDomainEvents();
});

afterAll(async () => {
  await closeDb();
});

function post(body: string, actor = world.member): request.Test {
  return request(app)
    .post(`/api/tasks/${taskId}/comments`)
    .set('Authorization', auth(actor))
    .send({ body });
}

describe('GET/POST /api/tasks/:taskId/comments', () => {
  it('starts empty and reads oldest first with pagination meta', async () => {
    const empty = await request(app)
      .get(`/api/tasks/${taskId}/comments`)
      .set('Authorization', auth(world.viewer));
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);
    expect(empty.body.meta).toEqual({ page: 1, pageSize: 25, total: 0, totalPages: 0 });

    await post('first');
    await post('second');

    const response = await request(app)
      .get(`/api/tasks/${taskId}/comments`)
      .set('Authorization', auth(world.viewer));
    expect((response.body.data as Comment[]).map((comment) => comment.body)).toEqual([
      'first',
      'second',
    ]);
    expect(response.body.meta.total).toBe(2);
  });

  it('creates a comment with the author expanded', async () => {
    const response = await post('Looks good to me');
    expect(response.status).toBe(201);

    const comment = response.body.data as Comment;
    expect(comment).toMatchObject({
      taskId,
      body: 'Looks good to me',
      editedAt: null,
    });
    expect(comment.author).toMatchObject({ id: world.member.id, name: 'Project Member' });
  });

  it('records activity, telemetry and a domain event', async () => {
    const telemetry = captureTelemetry();
    const events = captureDomainEvent('comment.created');

    const response = await post('Observed');
    await flushAsync();

    const rows = await db
      .select({ action: activity.action })
      .from(activity)
      .where(eq(activity.taskId, taskId));
    expect(rows.map((row) => row.action)).toEqual(['comment.added']);
    expect(telemetry.map((event) => event.type)).toContain('comment_added');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      taskId,
      commentId: (response.body.data as Comment).id,
      projectId: world.projectId,
    });
  });

  it('stores the body verbatim and derives the mention list from it', async () => {
    const events = captureDomainEvent('comment.created');
    const body = `cc @[Project Admin](${world.admin.id}) please look`;

    const response = await post(body);
    await flushAsync();

    expect((response.body.data as Comment).body).toBe(body);
    expect(events[0]?.mentionedUserIds).toEqual([world.admin.id]);
  });

  it('mentions nobody when the body names nobody', async () => {
    const events = captureDomainEvent('comment.created');
    await post('an @ordinary mention of nobody in particular');
    await flushAsync();
    expect(events[0]?.mentionedUserIds).toEqual([]);
  });

  it('refuses a mention of somebody outside the project', async () => {
    const response = await post(`hi @[Org Outsider](${world.outsider.id})`);
    expect(response.status).toBe(400);
    expect(await db.select({ id: comments.id }).from(comments)).toHaveLength(0);
  });

  it('rejects an empty body and refuses a viewer', async () => {
    expect((await post('   ')).status).toBe(422);
    expect((await post('nope', world.viewer)).status).toBe(403);
  });

  it('is reflected in the task detail comment count', async () => {
    await post('one');
    await post('two');

    const response = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.viewer));
    expect((response.body.data as Task).commentCount).toBe(2);
  });
});

describe('PATCH/DELETE /api/comments/:commentId', () => {
  async function seedComment(actor = world.member): Promise<string> {
    const response = await post('original', actor);
    return (response.body.data as Comment).id;
  }

  it('lets the author edit and stamps editedAt', async () => {
    const commentId = await seedComment();

    const response = await request(app)
      .patch(`/api/comments/${commentId}`)
      .set('Authorization', auth(world.member))
      .send({ body: 'revised' });

    expect(response.status).toBe(200);
    const comment = response.body.data as Comment;
    expect(comment.body).toBe('revised');
    expect(comment.editedAt).not.toBeNull();

    const rows = await db
      .select({ action: activity.action })
      .from(activity)
      .where(eq(activity.action, 'comment.edited'));
    expect(rows).toHaveLength(1);
  });

  it('refuses another member but allows a project admin', async () => {
    const commentId = await seedComment();

    const stranger = await request(app)
      .patch(`/api/comments/${commentId}`)
      .set('Authorization', auth(world.viewer))
      .send({ body: 'not mine' });
    // Viewer is below the write floor before the ownership rule is even reached.
    expect(stranger.status).toBe(403);

    const moderator = await request(app)
      .patch(`/api/comments/${commentId}`)
      .set('Authorization', auth(world.admin))
      .send({ body: 'moderated' });
    expect(moderator.status).toBe(200);
  });

  it('refuses a member who is not the author', async () => {
    const commentId = await seedComment(world.admin);

    const response = await request(app)
      .patch(`/api/comments/${commentId}`)
      .set('Authorization', auth(world.member))
      .send({ body: 'not mine' });
    expect(response.status).toBe(403);
  });

  it('re-derives mentions on edit', async () => {
    const events = captureDomainEvent('comment.updated');
    const commentId = await seedComment();

    await request(app)
      .patch(`/api/comments/${commentId}`)
      .set('Authorization', auth(world.member))
      .send({ body: `now with @[Project Admin](${world.admin.id})` });
    await flushAsync();

    expect(events[0]?.mentionedUserIds).toEqual([world.admin.id]);
  });

  it('soft-deletes, drops the row from the thread and publishes the event', async () => {
    const events = captureDomainEvent('comment.deleted');
    const commentId = await seedComment();

    const response = await request(app)
      .delete(`/api/comments/${commentId}`)
      .set('Authorization', auth(world.member));
    expect(response.status).toBe(204);
    await flushAsync();

    const rows = await db.select({ id: comments.id, deletedAt: comments.deletedAt }).from(comments);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).not.toBeNull();

    const thread = await request(app)
      .get(`/api/tasks/${taskId}/comments`)
      .set('Authorization', auth(world.viewer));
    expect(thread.body.data).toEqual([]);
    expect(events[0]).toMatchObject({ commentId, taskId });

    const deleted = await request(app)
      .patch(`/api/comments/${commentId}`)
      .set('Authorization', auth(world.member))
      .send({ body: 'ghost' });
    expect(deleted.status).toBe(404);
  });

  it('lets a project admin delete somebody else s comment', async () => {
    const commentId = await seedComment();
    const response = await request(app)
      .delete(`/api/comments/${commentId}`)
      .set('Authorization', auth(world.admin));
    expect(response.status).toBe(204);
  });
});
