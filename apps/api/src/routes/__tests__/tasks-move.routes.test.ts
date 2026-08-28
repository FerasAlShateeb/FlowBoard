/**
 * `POST /api/tasks/:taskId/move` and `/rank` — the workflow rules and the
 * fractional-index mechanics.
 *
 * Three properties matter here and are hard to get right by accident:
 *   - the transition whitelist's ZERO-ROWS-MEANS-OPEN semantic;
 *   - a WIP limit that blocks a move INTO a column but never a reorder inside
 *     one;
 *   - a rank recomputed from the neighbours as they are IN THE TRANSACTION,
 *     with the whole column rewritten when the key degenerates.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { NEEDS_REBALANCE_LENGTH } from '@flowboard/shared';
import type { BoardResponse, MoveTaskResponse, Task } from '@flowboard/shared';

import { activity, closeDb, db, tasks } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  auth,
  captureDomainEvent,
  captureTelemetry,
  createTaskTestApp,
  flushAsync,
  seedSprint,
  seedTask,
  seedWorld,
  stopDomainEvents,
  stopTelemetry,
  type World,
} from './task-domain.fixtures';

const app = createTaskTestApp();
let world: World;

beforeAll(async () => {
  await ensureTestDb();
}, 60_000);

beforeEach(async () => {
  await truncateAllTables();
  world = await seedWorld();
});

afterEach(() => {
  stopTelemetry();
  stopDomainEvents();
});

afterAll(async () => {
  await closeDb();
});

function move(taskId: string, body: Record<string, unknown>, actor = world.member): request.Test {
  return request(app)
    .post(`/api/tasks/${taskId}/move`)
    .set('Authorization', auth(actor))
    .send(body);
}

/** The ids of one board column, in rank order, straight from the database. */
async function columnOrder(statusId: string): Promise<string[]> {
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.statusId, statusId))
    .orderBy(asc(tasks.boardRank));
  return rows.map((row) => row.id);
}

describe('POST /api/tasks/:taskId/move — placement', () => {
  it('appends to the destination column when no neighbour is given', async () => {
    const existing = await seedTask(world, { statusId: world.statuses.inProgress });
    const moving = await seedTask(world);

    const response = await move(moving, { statusId: world.statuses.inProgress });

    expect(response.status).toBe(200);
    const body = response.body as { data: MoveTaskResponse };
    expect(body.data.task.statusId).toBe(world.statuses.inProgress);
    expect(body.data.rebalanced).toBe(false);
    expect(await columnOrder(world.statuses.inProgress)).toEqual([existing, moving]);
  });

  it('lands immediately before the task named by beforeTaskId', async () => {
    const first = await seedTask(world, { statusId: world.statuses.inProgress });
    const second = await seedTask(world, { statusId: world.statuses.inProgress });
    const moving = await seedTask(world);

    await move(moving, { statusId: world.statuses.inProgress, beforeTaskId: second });

    expect(await columnOrder(world.statuses.inProgress)).toEqual([first, moving, second]);
  });

  it('lands immediately after the task named by afterTaskId', async () => {
    const first = await seedTask(world, { statusId: world.statuses.inProgress });
    const second = await seedTask(world, { statusId: world.statuses.inProgress });
    const moving = await seedTask(world);

    await move(moving, { statusId: world.statuses.inProgress, afterTaskId: first });

    expect(await columnOrder(world.statuses.inProgress)).toEqual([first, moving, second]);
  });

  it('reorders within one column and records task.ranked, not a status change', async () => {
    const first = await seedTask(world);
    const second = await seedTask(world);

    await move(second, { statusId: world.statuses.todo, beforeTaskId: first });

    expect(await columnOrder(world.statuses.todo)).toEqual([second, first]);
    const rows = await db
      .select({ action: activity.action })
      .from(activity)
      .where(eq(activity.taskId, second));
    expect(rows.map((row) => row.action)).toEqual(['task.ranked']);
  });

  it('refuses both neighbours at once', async () => {
    const a = await seedTask(world);
    const b = await seedTask(world);
    const moving = await seedTask(world);

    const response = await move(moving, {
      statusId: world.statuses.todo,
      beforeTaskId: a,
      afterTaskId: b,
    });
    expect(response.status).toBe(422);
  });

  it('refuses a neighbour that is not in the destination column', async () => {
    const elsewhere = await seedTask(world, { statusId: world.statuses.done });
    const moving = await seedTask(world);

    const response = await move(moving, {
      statusId: world.statuses.inProgress,
      beforeTaskId: elsewhere,
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('stale_neighbour');
  });

  it('ignores a clientRank that would contradict the neighbours', async () => {
    const first = await seedTask(world, { statusId: world.statuses.inProgress });
    const second = await seedTask(world, { statusId: world.statuses.inProgress });
    const moving = await seedTask(world);

    // The client claims a key that sorts last, while asking to land first.
    await move(moving, {
      statusId: world.statuses.inProgress,
      beforeTaskId: first,
      clientRank: 'zz',
    });

    expect(await columnOrder(world.statuses.inProgress)).toEqual([moving, first, second]);
  });
});

describe('POST /api/tasks/:taskId/move — workflow rules', () => {
  it('allows any target when the source status has no transition rows', async () => {
    const taskId = await seedTask(world);
    const response = await move(taskId, { statusId: world.statuses.done });
    expect(response.status).toBe(200);
  });

  it('enforces the whitelist once a source status has rows', async () => {
    const restricted = await seedWorld({ restrictTransitions: true });
    const taskId = await seedTask(restricted, { statusId: restricted.statuses.todo });

    const skipping = await request(app)
      .post(`/api/tasks/${taskId}/move`)
      .set('Authorization', auth(restricted.member))
      .send({ statusId: restricted.statuses.done });
    expect(skipping.status).toBe(409);
    expect(skipping.body.error.code).toBe('transition_not_allowed');

    const allowed = await request(app)
      .post(`/api/tasks/${taskId}/move`)
      .set('Authorization', auth(restricted.member))
      .send({ statusId: restricted.statuses.inProgress });
    expect(allowed.status).toBe(200);
  });

  it('still allows a reorder inside a whitelisted column', async () => {
    const restricted = await seedWorld({ restrictTransitions: true });
    const first = await seedTask(restricted);
    const second = await seedTask(restricted);

    const response = await request(app)
      .post(`/api/tasks/${second}/move`)
      .set('Authorization', auth(restricted.member))
      .send({ statusId: restricted.statuses.todo, beforeTaskId: first });
    expect(response.status).toBe(200);
  });

  it('blocks a move into a column that is at its WIP limit', async () => {
    const limited = await seedWorld({ inProgressWipLimit: 1 });
    await seedTask(limited, { statusId: limited.statuses.inProgress });
    const moving = await seedTask(limited);

    const response = await request(app)
      .post(`/api/tasks/${moving}/move`)
      .set('Authorization', auth(limited.member))
      .send({ statusId: limited.statuses.inProgress });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('wip_limit_exceeded');
    expect(response.body.error.details).toMatchObject({ wipLimit: 1, current: 1 });
  });

  it('exempts a reorder INSIDE the full column from the WIP limit', async () => {
    const limited = await seedWorld({ inProgressWipLimit: 2 });
    const first = await seedTask(limited, { statusId: limited.statuses.inProgress });
    const second = await seedTask(limited, { statusId: limited.statuses.inProgress });

    const response = await request(app)
      .post(`/api/tasks/${second}/move`)
      .set('Authorization', auth(limited.member))
      .send({ statusId: limited.statuses.inProgress, beforeTaskId: first });

    expect(response.status).toBe(200);
    expect(await columnOrder(limited.statuses.inProgress)).toEqual([second, first]);
  });

  it('applies the same rules to a status change made through PATCH', async () => {
    const limited = await seedWorld({ inProgressWipLimit: 1, restrictTransitions: true });
    await seedTask(limited, { statusId: limited.statuses.inProgress });
    const taskId = await seedTask(limited);

    const wip = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(limited.member))
      .send({ statusId: limited.statuses.inProgress });
    expect(wip.body.error.code).toBe('wip_limit_exceeded');

    const transition = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(limited.member))
      .send({ statusId: limited.statuses.done });
    expect(transition.body.error.code).toBe('transition_not_allowed');
  });

  it('stamps resolvedAt, records telemetry and publishes task.moved', async () => {
    const telemetry = captureTelemetry();
    const events = captureDomainEvent('task.moved');
    const taskId = await seedTask(world);

    const response = await move(taskId, { statusId: world.statuses.done });
    await flushAsync();

    expect((response.body.data as MoveTaskResponse).task.resolvedAt).not.toBeNull();
    const types = telemetry.map((event) => event.type);
    expect(types).toContain('task_moved');
    expect(types).toContain('task_completed');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ taskId, statusId: world.statuses.done, rebalanced: false });
  });

  it('CLEARS resolvedAt when a done task is dragged back out of done', async () => {
    // Cycle time, velocity and the CFD all read `resolved_at`. A stamp left
    // behind on a reopened task keeps counting work that is back in flight, and
    // the number is wrong quietly — nothing on the board shows it.
    const resolvedAt = new Date('2026-03-01T10:00:00.000Z');
    const taskId = await seedTask(world, { statusId: world.statuses.done, resolvedAt });

    const response = await move(taskId, { statusId: world.statuses.inProgress });

    expect(response.status).toBe(200);
    expect((response.body.data as MoveTaskResponse).task.resolvedAt).toBeNull();
    const [row] = await db
      .select({ resolvedAt: tasks.resolvedAt })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(row?.resolvedAt).toBeNull();
  });

  it('does NOT re-stamp resolvedAt for a reorder inside the done column', async () => {
    // Same column is a reorder, not a completion: the original date stands.
    const resolvedAt = new Date('2026-03-01T10:00:00.000Z');
    const other = await seedTask(world, { statusId: world.statuses.done });
    const taskId = await seedTask(world, { statusId: world.statuses.done, resolvedAt });

    const response = await move(taskId, {
      statusId: world.statuses.done,
      beforeTaskId: other,
    });

    expect(response.status).toBe(200);
    expect((response.body.data as MoveTaskResponse).task.resolvedAt).toBe(resolvedAt.toISOString());
  });

  it('marks a same-column reorder as NOT a status change on the domain event', async () => {
    // `statusChanged` is what decides whether watchers get a bell. A drag that
    // only reorders a busy column must not notify anybody, and the flag — not a
    // read-back of the last activity row — is what says so.
    const events = captureDomainEvent('task.moved');
    const other = await seedTask(world, { statusId: world.statuses.todo });
    const taskId = await seedTask(world, { statusId: world.statuses.todo });

    await move(taskId, { statusId: world.statuses.todo, beforeTaskId: other });
    await flushAsync();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ taskId, statusChanged: false });
  });

  it('marks a cross-column drop as a status change on the domain event', async () => {
    const events = captureDomainEvent('task.moved');
    const taskId = await seedTask(world, { statusId: world.statuses.todo });

    await move(taskId, { statusId: world.statuses.inProgress });
    await flushAsync();

    expect(events[0]).toMatchObject({ taskId, statusChanged: true });
  });

  /**
   * The stamp the web orders the board splice against.
   *
   * It must be the row's COMMITTED `updated_at`, not a time the publisher made
   * up: the browser compares it against the `updatedAt` on the mutation
   * response for the very same drop, and a stamp that disagreed with the row
   * would make one of the two writes look permanently stale.
   */
  it('publishes the committed updatedAt on task.moved', async () => {
    const events = captureDomainEvent('task.moved');
    const taskId = await seedTask(world, { statusId: world.statuses.todo });

    const response = await move(taskId, { statusId: world.statuses.inProgress });
    await flushAsync();

    const committed = (response.body.data as MoveTaskResponse).task.updatedAt;
    expect(events[0]?.updatedAt).toBe(committed);

    const [row] = await db
      .select({ updatedAt: tasks.updatedAt })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(row?.updatedAt.toISOString()).toBe(committed);
  });

  it('exempts a reorder inside a column whose WIP limit is already EXCEEDED', async () => {
    // A limit lowered after the fact (or raised work-in-progress) leaves a
    // column over its ceiling. Refusing to reorder it would strand the very
    // team that most needs to triage what is in there.
    const limited = await seedWorld({ inProgressWipLimit: 1 });
    const first = await seedTask(limited, { statusId: limited.statuses.inProgress });
    const second = await seedTask(limited, { statusId: limited.statuses.inProgress });
    const third = await seedTask(limited, { statusId: limited.statuses.inProgress });

    const response = await request(app)
      .post(`/api/tasks/${third}/move`)
      .set('Authorization', auth(limited.member))
      .send({ statusId: limited.statuses.inProgress, beforeTaskId: first });

    expect(response.status).toBe(200);
    expect(await columnOrder(limited.statuses.inProgress)).toEqual([third, first, second]);
  });

  it('refuses a viewer', async () => {
    const taskId = await seedTask(world);
    const response = await move(taskId, { statusId: world.statuses.done }, world.viewer);
    expect(response.status).toBe(403);
  });
});

describe('POST /api/tasks/:taskId/move — rebalance', () => {
  it('rewrites the whole column when the computed key degenerates', async () => {
    // Two neighbours whose gap is pathologically narrow: any key between them
    // is far longer than the 60-character trigger.
    const narrow = `a0${'0'.repeat(70)}1`;
    const low = await seedTask(world, { statusId: world.statuses.inProgress, boardRank: 'a0' });
    const high = await seedTask(world, {
      statusId: world.statuses.inProgress,
      boardRank: narrow,
    });
    const trailing = await seedTask(world, {
      statusId: world.statuses.inProgress,
      boardRank: 'a1',
    });
    const moving = await seedTask(world);

    const response = await move(moving, {
      statusId: world.statuses.inProgress,
      beforeTaskId: high,
    });

    expect(response.status).toBe(200);
    const body = response.body.data as MoveTaskResponse;
    expect(body.rebalanced).toBe(true);

    // Order preserved, every key short again.
    expect(await columnOrder(world.statuses.inProgress)).toEqual([low, moving, high, trailing]);
    const rows = await db
      .select({ boardRank: tasks.boardRank })
      .from(tasks)
      .where(eq(tasks.statusId, world.statuses.inProgress));
    expect(rows.every((row) => row.boardRank.length < NEEDS_REBALANCE_LENGTH)).toBe(true);
    expect(body.task.boardRank.length).toBeLessThan(NEEDS_REBALANCE_LENGTH);
  });

  it('flags the rebalance on the published domain event', async () => {
    const events = captureDomainEvent('task.moved');
    const narrow = `a0${'0'.repeat(70)}1`;
    await seedTask(world, { statusId: world.statuses.inProgress, boardRank: 'a0' });
    const high = await seedTask(world, {
      statusId: world.statuses.inProgress,
      boardRank: narrow,
    });
    const moving = await seedTask(world);

    await move(moving, { statusId: world.statuses.inProgress, beforeTaskId: high });
    await flushAsync();

    expect(events[0]?.rebalanced).toBe(true);
  });

  /**
   * The published `updatedAt` must still match the row AFTER a rebalance.
   *
   * The stamp is captured by the move's own `UPDATE … RETURNING`, and the
   * rebalance that may follow it rewrites the whole column through raw SQL
   * (`tx.execute`), which never runs Drizzle's `$onUpdate` hook. That is why one
   * capture is enough. If the rebalance ever starts bumping `updated_at` — by
   * switching to the query builder, or by a Postgres trigger — the published
   * stamp silently falls behind the row and every listener starts treating a
   * fresh broadcast as stale. This test is the tripwire for that change.
   */
  it('publishes a stamp that still matches the row after a rebalance', async () => {
    const events = captureDomainEvent('task.moved');
    const narrow = `a0${'0'.repeat(70)}1`;
    await seedTask(world, { statusId: world.statuses.inProgress, boardRank: 'a0' });
    const high = await seedTask(world, {
      statusId: world.statuses.inProgress,
      boardRank: narrow,
    });
    const moving = await seedTask(world);

    await move(moving, { statusId: world.statuses.inProgress, beforeTaskId: high });
    await flushAsync();

    expect(events[0]?.rebalanced).toBe(true);
    const [row] = await db
      .select({ updatedAt: tasks.updatedAt })
      .from(tasks)
      .where(eq(tasks.id, moving));
    expect(events[0]?.updatedAt).toBe(row?.updatedAt.toISOString());
  });
});

/**
 * WP5.6 — TWO PEOPLE DROPPING INTO THE SAME GAP AT THE SAME MOMENT.
 *
 * `computeRank` re-reads the neighbours inside the move transaction, which is
 * only a guarantee if the two transactions are serialized. Under READ COMMITTED
 * they were not: both snapshots predate either commit, both see the same gap,
 * and both write the SAME key — with no unique index on `board_rank` to refuse
 * the second one. A column then has two cards with one key, and every client
 * resolves the tie by `id`, which is not an order anybody chose.
 *
 * `lockBuckets` (a transaction-scoped advisory lock on the destination bucket)
 * is the fix, and this is the end-to-end proof: two real HTTP requests in
 * flight together, through the real controller and the real transaction.
 */
describe('POST /api/tasks/:taskId/move — concurrent drops', () => {
  it('gives two simultaneous drops into one gap DISTINCT ranks', async () => {
    const anchor = await seedTask(world, { statusId: world.statuses.inProgress });
    const first = await seedTask(world);
    const second = await seedTask(world);

    const [a, b] = await Promise.all([
      move(first, { statusId: world.statuses.inProgress, beforeTaskId: anchor }),
      move(second, { statusId: world.statuses.inProgress, beforeTaskId: anchor }),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    const rankA = (a.body.data as MoveTaskResponse).task.boardRank;
    const rankB = (b.body.data as MoveTaskResponse).task.boardRank;
    expect(rankA).not.toBe(rankB);

    // The column has ONE unambiguous order: both movers above the anchor, and
    // no two cards sharing a key.
    const order = await columnOrder(world.statuses.inProgress);
    expect(order).toHaveLength(3);
    expect(order[2]).toBe(anchor);
    const ranks = await db
      .select({ boardRank: tasks.boardRank })
      .from(tasks)
      .where(eq(tasks.statusId, world.statuses.inProgress));
    expect(new Set(ranks.map((row) => row.boardRank)).size).toBe(3);
  });

  it('gives five simultaneous appends into an EMPTY column distinct ranks', async () => {
    // The case a row lock cannot cover: there is no boundary row to lock,
    // because the destination starts empty.
    const movers = await Promise.all(Array.from({ length: 5 }, () => seedTask(world)));

    const responses = await Promise.all(
      movers.map((taskId) => move(taskId, { statusId: world.statuses.done })),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    const ranks = await db
      .select({ boardRank: tasks.boardRank })
      .from(tasks)
      .where(eq(tasks.statusId, world.statuses.done));
    expect(ranks).toHaveLength(5);
    expect(new Set(ranks.map((row) => row.boardRank)).size).toBe(5);
  });
});

describe('POST /api/tasks/:taskId/rank', () => {
  async function backlogOrder(sprintId: string | null): Promise<string[]> {
    const rows = await db
      .select({ id: tasks.id, sprintId: tasks.sprintId })
      .from(tasks)
      .orderBy(asc(tasks.backlogRank));
    return rows.filter((row) => row.sprintId === sprintId).map((row) => row.id);
  }

  it('reorders inside the backlog', async () => {
    const first = await seedTask(world);
    const second = await seedTask(world);

    const response = await request(app)
      .post(`/api/tasks/${second}/rank`)
      .set('Authorization', auth(world.member))
      .send({ sprintId: null, beforeTaskId: first });

    expect(response.status).toBe(200);
    expect((response.body.data as MoveTaskResponse).rebalanced).toBe(false);
    expect(await backlogOrder(null)).toEqual([second, first]);
  });

  it('moves a task into a sprint and records task.moved_sprint', async () => {
    const sprintId = await seedSprint(world);
    const inSprint = await seedTask(world, { sprintId });
    const moving = await seedTask(world);

    const response = await request(app)
      .post(`/api/tasks/${moving}/rank`)
      .set('Authorization', auth(world.member))
      .send({ sprintId, beforeTaskId: inSprint });

    expect((response.body.data as MoveTaskResponse).task.sprintId).toBe(sprintId);
    expect(await backlogOrder(sprintId)).toEqual([moving, inSprint]);

    const actions = await db
      .select({ action: activity.action })
      .from(activity)
      .where(eq(activity.taskId, moving));
    expect(actions.map((row) => row.action)).toEqual(['task.moved_sprint', 'task.ranked']);
  });

  it('rebalances the backlog bucket when the key degenerates', async () => {
    const narrow = `a0${'0'.repeat(70)}1`;
    await seedTask(world, { backlogRank: 'a0' });
    const high = await seedTask(world, { backlogRank: narrow });
    const moving = await seedTask(world);

    const response = await request(app)
      .post(`/api/tasks/${moving}/rank`)
      .set('Authorization', auth(world.member))
      .send({ sprintId: null, beforeTaskId: high });

    expect((response.body.data as MoveTaskResponse).rebalanced).toBe(true);
    const rows = await db.select({ backlogRank: tasks.backlogRank }).from(tasks);
    expect(rows.every((row) => row.backlogRank.length < NEEDS_REBALANCE_LENGTH)).toBe(true);
  });

  it('refuses a viewer', async () => {
    const taskId = await seedTask(world);
    const response = await request(app)
      .post(`/api/tasks/${taskId}/rank`)
      .set('Authorization', auth(world.viewer))
      .send({ sprintId: null });
    expect(response.status).toBe(403);
  });
});

describe('board reads reflect every move', () => {
  it('keeps the board response in rank order after a sequence of drops', async () => {
    const a = await seedTask(world, { title: 'A' });
    const b = await seedTask(world, { title: 'B' });
    const c = await seedTask(world, { title: 'C' });

    await move(c, { statusId: world.statuses.todo, beforeTaskId: a });
    await move(b, { statusId: world.statuses.inProgress });

    const response = await request(app)
      .get(`/api/projects/${world.projectId}/tasks`)
      .query({ view: 'board' })
      .set('Authorization', auth(world.viewer));

    const board = response.body.data as BoardResponse;
    expect(board.columns[world.statuses.todo]?.map((task) => task.title)).toEqual(['C', 'A']);
    expect(board.columns[world.statuses.inProgress]?.map((task) => task.title)).toEqual(['B']);

    const detail = await request(app)
      .get(`/api/tasks/${b}`)
      .set('Authorization', auth(world.viewer));
    expect((detail.body.data as Task).statusId).toBe(world.statuses.inProgress);
  });
});
