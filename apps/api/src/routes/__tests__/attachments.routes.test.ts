/**
 * The three-step attachment upload.
 *
 * NOTE ON MinIO. Presigning is pure local arithmetic over the credentials — no
 * network call — so every step this work package owns is fully exercised here
 * without a bucket. What is NOT asserted is the middle step (the browser PUTing
 * bytes to the signed URL), because the test environment signs with deliberately
 * fake credentials: a real PUT would fail the signature check for reasons that
 * say nothing about this code. The byte round-trip belongs to the Playwright
 * suite, which runs against the dev compose's real MinIO.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { MAX_ATTACHMENT_BYTES, type Attachment, type Task } from '@flowboard/shared';

import { activity, attachments, closeDb, db } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  auth,
  captureDomainEvent,
  createTaskTestApp,
  flushAsync,
  seedTask,
  seedWorld,
  stopDomainEvents,
  stopTelemetry,
  type UserRef,
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
  taskId = await seedTask(world, { title: 'With files' });
});

afterEach(() => {
  stopTelemetry();
  stopDomainEvents();
});

afterAll(async () => {
  await closeDb();
});

interface PresignBody {
  uploadUrl: string;
  s3Key: string;
  expiresAt: string;
  attachmentId: string;
}

function presign(body: Record<string, unknown> = {}, actor: UserRef = world.member): request.Test {
  return request(app)
    .post(`/api/tasks/${taskId}/attachments/presign`)
    .set('Authorization', auth(actor))
    .send({
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      ...body,
    });
}

describe('POST /api/tasks/:taskId/attachments/presign', () => {
  it('writes an unconfirmed row and returns a signed PUT', async () => {
    const response = await presign();
    expect(response.status).toBe(201);

    const body = response.body.data as PresignBody;
    expect(body.uploadUrl).toContain('http://localhost:9000/');
    expect(body.uploadUrl).toContain('X-Amz-Signature');
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const rows = await db
      .select({ id: attachments.id, confirmedAt: attachments.confirmedAt })
      .from(attachments);
    expect(rows).toEqual([{ id: body.attachmentId, confirmedAt: null }]);
  });

  it('builds the key as {orgId}/{projectId}/{taskId}/{uuid}-{name}', async () => {
    const response = await presign();
    const { s3Key } = response.body.data as PresignBody;

    const segments = s3Key.split('/');
    expect(segments.slice(0, 3)).toEqual([world.orgId, world.projectId, taskId]);
    expect(segments[3]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-report\.pdf$/u,
    );
  });

  it('sanitizes a hostile file name out of the key but keeps it on the row', async () => {
    const fileName = '../../etc/pass wd?.txt';
    const response = await presign({ fileName });
    const { s3Key } = response.body.data as PresignBody;

    // Four segments: nothing in the name may add a directory level.
    expect(s3Key.split('/')).toHaveLength(4);
    expect(s3Key).not.toContain('..');

    const [row] = await db.select({ fileName: attachments.fileName }).from(attachments);
    expect(row?.fileName).toBe(fileName);
  });

  it('refuses a file over the 25 MB ceiling and a viewer', async () => {
    const tooBig = await presign({ sizeBytes: MAX_ATTACHMENT_BYTES + 1 });
    expect(tooBig.status).toBe(422);

    const viewer = await presign({}, world.viewer);
    expect(viewer.status).toBe(403);
  });

  it('stays invisible until it is confirmed', async () => {
    await presign();

    const list = await request(app)
      .get(`/api/tasks/${taskId}/attachments`)
      .set('Authorization', auth(world.viewer));
    expect(list.body.data).toEqual([]);

    const detail = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.viewer));
    expect((detail.body.data as Task).attachmentCount).toBe(0);
  });
});

describe('POST /api/tasks/:taskId/attachments — confirm', () => {
  it('stamps confirmedAt, records activity and publishes task.updated', async () => {
    const events = captureDomainEvent('task.updated');
    const presigned = (await presign()).body.data as PresignBody;

    const response = await request(app)
      .post(`/api/tasks/${taskId}/attachments`)
      .set('Authorization', auth(world.member))
      .send({ attachmentId: presigned.attachmentId });
    await flushAsync();

    expect(response.status).toBe(201);
    const attachment = response.body.data as Attachment;
    expect(attachment).toMatchObject({
      taskId,
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      s3Key: presigned.s3Key,
    });
    expect(attachment.uploadedBy.id).toBe(world.member.id);

    const rows = await db
      .select({ action: activity.action })
      .from(activity)
      .where(eq(activity.action, 'attachment.added'));
    expect(rows).toHaveLength(1);
    expect(events[0]?.changedFields).toEqual(['attachments']);
  });

  it('accepts the shared contract shape, identified by s3Key', async () => {
    const presigned = (await presign()).body.data as PresignBody;

    const response = await request(app)
      .post(`/api/tasks/${taskId}/attachments`)
      .set('Authorization', auth(world.member))
      .send({
        s3Key: presigned.s3Key,
        fileName: 'renamed.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4096,
      });

    expect(response.status).toBe(201);
    // Metadata is re-validated and re-applied: a presign is not a promise about
    // what was actually uploaded.
    expect(response.body.data).toMatchObject({ fileName: 'renamed.pdf', sizeBytes: 4096 });
  });

  it('shows up in the list and the count once confirmed', async () => {
    const presigned = (await presign()).body.data as PresignBody;
    await request(app)
      .post(`/api/tasks/${taskId}/attachments`)
      .set('Authorization', auth(world.member))
      .send({ attachmentId: presigned.attachmentId });

    const list = await request(app)
      .get(`/api/tasks/${taskId}/attachments`)
      .set('Authorization', auth(world.viewer));
    expect((list.body.data as Attachment[]).map((row) => row.id)).toEqual([presigned.attachmentId]);

    const detail = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.viewer));
    expect((detail.body.data as Task).attachmentCount).toBe(1);
  });

  it('refuses a second confirmation and an unknown key', async () => {
    const presigned = (await presign()).body.data as PresignBody;
    const confirm = (): request.Test =>
      request(app)
        .post(`/api/tasks/${taskId}/attachments`)
        .set('Authorization', auth(world.member))
        .send({ attachmentId: presigned.attachmentId });

    expect((await confirm()).status).toBe(201);
    expect((await confirm()).status).toBe(409);

    const unknown = await request(app)
      .post(`/api/tasks/${taskId}/attachments`)
      .set('Authorization', auth(world.member))
      .send({ s3Key: 'not/a/real/key' });
    expect(unknown.status).toBe(404);
  });

  it('requires one of the two identifiers', async () => {
    const response = await request(app)
      .post(`/api/tasks/${taskId}/attachments`)
      .set('Authorization', auth(world.member))
      .send({ fileName: 'orphan.pdf' });
    expect(response.status).toBe(422);
  });
});

describe('attachment download and deletion', () => {
  async function confirmed(actor: UserRef = world.member): Promise<PresignBody> {
    const presigned = (await presign({}, actor)).body.data as PresignBody;
    await request(app)
      .post(`/api/tasks/${taskId}/attachments`)
      .set('Authorization', auth(actor))
      .send({ attachmentId: presigned.attachmentId });
    return presigned;
  }

  it('presigns a download that restores the original file name', async () => {
    const attachment = await confirmed();

    const response = await request(app)
      .get(`/api/attachments/${attachment.attachmentId}/url`)
      .set('Authorization', auth(world.viewer));

    expect(response.status).toBe(200);
    const url = response.body.data.url as string;
    expect(url).toContain(encodeURIComponent(attachment.s3Key).replace(/%2F/gu, '/'));
    expect(decodeURIComponent(url)).toContain('attachment; filename="report.pdf"');
  });

  it('soft-deletes for the uploader and hides the row', async () => {
    const attachment = await confirmed();

    const response = await request(app)
      .delete(`/api/attachments/${attachment.attachmentId}`)
      .set('Authorization', auth(world.member));
    expect(response.status).toBe(204);

    const rows = await db
      .select({ deletedAt: attachments.deletedAt })
      .from(attachments)
      .where(eq(attachments.id, attachment.attachmentId));
    expect(rows[0]?.deletedAt).not.toBeNull();

    const list = await request(app)
      .get(`/api/tasks/${taskId}/attachments`)
      .set('Authorization', auth(world.viewer));
    expect(list.body.data).toEqual([]);

    const removals = await db
      .select({ action: activity.action })
      .from(activity)
      .where(eq(activity.action, 'attachment.deleted'));
    expect(removals).toHaveLength(1);
  });

  it('refuses a member who did not upload it, but allows a project admin', async () => {
    const mine = await confirmed(world.member);
    const stranger = await request(app)
      .delete(`/api/attachments/${mine.attachmentId}`)
      .set('Authorization', auth(world.viewer));
    expect(stranger.status).toBe(403);

    const admin = await request(app)
      .delete(`/api/attachments/${mine.attachmentId}`)
      .set('Authorization', auth(world.admin));
    expect(admin.status).toBe(204);
  });

  it('404s on an attachment that is already gone', async () => {
    const attachment = await confirmed();
    await request(app)
      .delete(`/api/attachments/${attachment.attachmentId}`)
      .set('Authorization', auth(world.member));

    const response = await request(app)
      .get(`/api/attachments/${attachment.attachmentId}/url`)
      .set('Authorization', auth(world.viewer));
    expect(response.status).toBe(404);
  });
});
