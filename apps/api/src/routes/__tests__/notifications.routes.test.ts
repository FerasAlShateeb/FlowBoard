/**
 * WP4.2 — the HTTP surface: `/api/notifications`.
 *
 * THE APP UNDER TEST MOUNTS ONE ROUTER. `routes/index.ts` is owned by the
 * integrator (WP4.7), so this suite must not depend on the mount having landed
 * — it builds the same three-piece app every other route suite does (JSON
 * parsing, the 404 fallthrough, the single error-envelope formatter) and mounts
 * `notificationsRouter` at the path the registry will use. When the mount
 * lands, `router-mounting.test.ts` proves reachability; this file proves
 * behaviour either way.
 *
 * EVERY ENDPOINT IS SELF-SCOPED, so the interesting authorization case is not a
 * role matrix — it is "can I touch a row addressed to somebody else", which is
 * asserted below and answers 404 rather than 403 on purpose.
 */
import express, { type Express } from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Notification, NotificationType, UnreadCount } from '@flowboard/shared';

import { db, notifications } from '../../db';
import { closeDb } from '../../db/client';
import { errorHandler, notFound } from '../../middlewares/error-handler';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { notificationsRouter } from '../notifications.routes';
import {
  auth,
  captureTelemetry,
  seedUser,
  stopTelemetry,
  type CapturedTelemetry,
  type UserRef,
} from './task-domain.fixtures';

function createNotificationsTestApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use('/api/notifications', notificationsRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

const app = createNotificationsTestApp();

interface NotificationFixture {
  type?: NotificationType;
  readAt?: Date | null;
  createdAt?: Date;
  taskKey?: string;
}

/**
 * Insert one notification row directly.
 *
 * Rows, not endpoints: nothing in the API creates a notification on request —
 * they are a side effect of somebody else's mutation — so there is no endpoint
 * to arrange with in the first place.
 */
async function seedNotification(
  recipient: UserRef,
  options: NotificationFixture = {},
): Promise<string> {
  const [row] = await db
    .insert(notifications)
    .values({
      recipientId: recipient.id,
      type: options.type ?? 'comment_added',
      readAt: options.readAt ?? null,
      payload: {
        taskKey: options.taskKey ?? 'FLOW-1',
        taskTitle: 'Rebalance fractional ranks',
        projectKey: 'FLOW',
        orgSlug: 'acme',
      },
      ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    })
    .returning({ id: notifications.id });
  if (!row) throw new Error('notification insert returned nothing');
  return row.id;
}

let ada: UserRef;
let grace: UserRef;
let telemetry: CapturedTelemetry[];

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
  [ada, grace] = await Promise.all([seedUser({ name: 'Ada' }), seedUser({ name: 'Grace' })]);
  telemetry = captureTelemetry();
});

afterEach(() => {
  stopTelemetry();
});

afterAll(async () => {
  await closeDb();
});

/** Let `record()`'s fire-and-forget sink run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

// ───────────────────────────────────────────────────────────────────────────

describe('GET /api/notifications', () => {
  it('rejects a request with no bearer token', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('answers only the caller’s own rows, newest first', async () => {
    await seedNotification(ada, { taskKey: 'FLOW-1', createdAt: new Date('2026-03-01T09:00:00Z') });
    await seedNotification(ada, { taskKey: 'FLOW-2', createdAt: new Date('2026-03-02T09:00:00Z') });
    await seedNotification(grace, { taskKey: 'FLOW-9' });

    const res = await request(app).get('/api/notifications').set('Authorization', auth(ada));

    expect(res.status).toBe(200);
    const items = res.body.data as Notification[];
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.payload.taskKey)).toEqual(['FLOW-2', 'FLOW-1']);
    expect(items.every((item) => item.recipientId === ada.id)).toBe(true);
  });

  it('filters to unread with `?unread=true`', async () => {
    await seedNotification(ada, { taskKey: 'READ', readAt: new Date() });
    await seedNotification(ada, { taskKey: 'UNREAD' });

    const res = await request(app)
      .get('/api/notifications?unread=true')
      .set('Authorization', auth(ada));

    const items = res.body.data as Notification[];
    expect(items).toHaveLength(1);
    expect(items[0]?.payload.taskKey).toBe('UNREAD');
    expect(items[0]?.readAt).toBeNull();
  });

  it('filters by type', async () => {
    await seedNotification(ada, { type: 'mentioned' });
    await seedNotification(ada, { type: 'comment_added' });

    const res = await request(app)
      .get('/api/notifications?type=mentioned')
      .set('Authorization', auth(ada));

    expect((res.body.data as Notification[]).map((item) => item.type)).toEqual(['mentioned']);
  });

  it('paginates, and reports the totals in the envelope meta', async () => {
    for (let index = 0; index < 5; index += 1) {
      await seedNotification(ada, {
        taskKey: `FLOW-${String(index)}`,
        createdAt: new Date(Date.UTC(2026, 2, index + 1)),
      });
    }

    const first = await request(app)
      .get('/api/notifications?page=1&pageSize=2')
      .set('Authorization', auth(ada));
    const second = await request(app)
      .get('/api/notifications?page=2&pageSize=2')
      .set('Authorization', auth(ada));

    expect(first.body.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    expect((first.body.data as Notification[]).map((item) => item.payload.taskKey)).toEqual([
      'FLOW-4',
      'FLOW-3',
    ]);
    expect((second.body.data as Notification[]).map((item) => item.payload.taskKey)).toEqual([
      'FLOW-2',
      'FLOW-1',
    ]);
  });

  it('refuses a page size past the hard ceiling', async () => {
    const res = await request(app)
      .get('/api/notifications?pageSize=500')
      .set('Authorization', auth(ada));
    expect(res.status).toBe(422);
  });
});

describe('GET /api/notifications/unread-count', () => {
  it('counts only the caller’s unread rows', async () => {
    await seedNotification(ada);
    await seedNotification(ada);
    await seedNotification(ada, { readAt: new Date() });
    await seedNotification(grace);

    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', auth(ada));

    expect(res.status).toBe(200);
    expect((res.body.data as UnreadCount).count).toBe(2);
  });

  it('answers zero rather than 404 for a user with nothing', async () => {
    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', auth(ada));
    expect((res.body.data as UnreadCount).count).toBe(0);
  });
});

describe('POST /api/notifications/:notificationId/read', () => {
  it('stamps `readAt` and answers the updated row', async () => {
    const id = await seedNotification(ada);

    const res = await request(app)
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', auth(ada));

    expect(res.status).toBe(200);
    expect((res.body.data as Notification).readAt).not.toBeNull();

    const [row] = await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.id, id));
    expect(row?.readAt).not.toBeNull();
  });

  it('is idempotent — a second click is not an error', async () => {
    const id = await seedNotification(ada);
    const first = await request(app)
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', auth(ada));
    const second = await request(app)
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', auth(ada));

    expect(second.status).toBe(200);
    expect((second.body.data as Notification).readAt).toBe(
      (first.body.data as Notification).readAt,
    );
  });

  it('records `notification_opened`', async () => {
    const id = await seedNotification(ada, { type: 'mentioned' });

    await request(app).post(`/api/notifications/${id}/read`).set('Authorization', auth(ada));
    await flush();

    const event = telemetry.find((entry) => entry.type === 'notification_opened');
    expect(event?.payload).toMatchObject({ notificationId: id, type: 'mentioned' });
  });

  it('answers 404 for somebody else’s notification, and leaves it unread', async () => {
    const id = await seedNotification(grace);

    const res = await request(app)
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', auth(ada));

    expect(res.status).toBe(404);
    const [row] = await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.id, id));
    expect(row?.readAt).toBeNull();
  });

  it('refuses an id that is not a uuid', async () => {
    const res = await request(app)
      .post('/api/notifications/not-a-uuid/read')
      .set('Authorization', auth(ada));
    expect(res.status).toBe(422);
  });
});

describe('POST /api/notifications/read', () => {
  it('marks the named set read and answers the remaining unread count', async () => {
    const first = await seedNotification(ada);
    await seedNotification(ada);
    await seedNotification(ada);

    const res = await request(app)
      .post('/api/notifications/read')
      .set('Authorization', auth(ada))
      .send({ ids: [first] });

    expect(res.status).toBe(200);
    expect((res.body.data as UnreadCount).count).toBe(2);
  });

  it('cannot reach into another user’s rows', async () => {
    const mine = await seedNotification(ada);
    const theirs = await seedNotification(grace);

    await request(app)
      .post('/api/notifications/read')
      .set('Authorization', auth(ada))
      .send({ ids: [mine, theirs] });

    const [row] = await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.id, theirs));
    expect(row?.readAt).toBeNull();
  });

  it('refuses an empty id list', async () => {
    const res = await request(app)
      .post('/api/notifications/read')
      .set('Authorization', auth(ada))
      .send({ ids: [] });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/notifications/read-all', () => {
  it('clears the badge and reports how many rows it stamped', async () => {
    await seedNotification(ada);
    await seedNotification(ada);
    await seedNotification(ada, { readAt: new Date() });
    await seedNotification(grace);

    const res = await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', auth(ada));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ marked: 2 });

    const count = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', auth(ada));
    expect((count.body.data as UnreadCount).count).toBe(0);

    // Grace's row is untouched.
    const [hers] = await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.recipientId, grace.id)));
    expect(hers?.readAt).toBeNull();
  });

  it('answers zero when there was nothing to mark', async () => {
    const res = await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', auth(ada));
    expect(res.body.data).toEqual({ marked: 0 });
  });
});
