/**
 * The six project reports, each against a small hand-computed fixture.
 *
 * Every expectation below is a number a person worked out on paper first — that
 * is the only way to catch a report that is self-consistently wrong. The
 * cumulative-flow case in particular writes the ACTIVITY STREAM directly,
 * because that report is a replay of history rather than a read of current
 * state, and seeding today's task rows would prove nothing about last Tuesday.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  BurndownReport,
  BurnupReport,
  CumulativeFlowReport,
  CycleTimeReport,
  VelocityReport,
  WorkloadReport,
} from '@flowboard/shared';

import { eq } from 'drizzle-orm';

import { activity, closeDb, db, statuses } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  auth,
  createTaskTestApp,
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

function reportUrl(name: string): string {
  return `/api/projects/${world.projectId}/reports/${name}`;
}

function get(name: string, query: Record<string, unknown> = {}): request.Test {
  return request(app).get(reportUrl(name)).query(query).set('Authorization', auth(world.viewer));
}

/** Append one audit row with an explicit timestamp — the CFD's raw material. */
async function recordEvent(
  taskId: string,
  action: 'task.created' | 'task.status_changed' | 'task.deleted',
  newValue: unknown,
  createdAt: string,
): Promise<void> {
  await db.insert(activity).values({
    projectId: world.projectId,
    taskId,
    actorId: world.member.id,
    action,
    newValue,
    createdAt: new Date(createdAt),
  });
}

describe('burndown', () => {
  /**
   * A three-day sprint committed at 10 points, half of it resolved midway
   * through day two:
   *
   *   day        remaining   ideal
   *   2026-03-02    10        10     (nothing resolved yet)
   *   2026-03-03     5         5     (5 points resolved at 12:00)
   *   2026-03-04     5         0     (the other 5 never landed)
   */
  async function seedSprintWindow(): Promise<string> {
    const sprintId = await seedSprint(world, {
      state: 'active',
      startDate: '2026-03-02',
      endDate: '2026-03-04',
      committedPoints: 10,
    });
    await seedTask(world, {
      sprintId,
      storyPoints: 5,
      statusId: world.statuses.done,
      resolvedAt: new Date('2026-03-03T12:00:00.000Z'),
    });
    await seedTask(world, { sprintId, storyPoints: 5 });
    return sprintId;
  }

  it('draws remaining against the ideal line', async () => {
    const sprintId = await seedSprintWindow();
    const response = await get('burndown', { sprintId });

    expect(response.status).toBe(200);
    expect((response.body.data as BurndownReport).days).toEqual([
      { date: '2026-03-02', remainingPoints: 10, idealPoints: 10 },
      { date: '2026-03-03', remainingPoints: 5, idealPoints: 5 },
      { date: '2026-03-04', remainingPoints: 5, idealPoints: 0 },
    ]);
  });

  it('has no x-axis for a sprint with no planned window', async () => {
    const sprintId = await seedSprint(world);
    const response = await get('burndown', { sprintId });
    expect((response.body.data as BurndownReport).days).toEqual([]);
  });

  it('404s for a sprint in another project', async () => {
    const other = await seedWorld();
    const sprintId = await seedSprint(other, {
      startDate: '2026-03-02',
      endDate: '2026-03-04',
    });
    const response = await get('burndown', { sprintId });
    expect(response.status).toBe(404);
  });

  it('draws the burnup pair over the same window', async () => {
    const sprintId = await seedSprintWindow();
    const response = await get('burnup', { sprintId });

    expect((response.body.data as BurnupReport).days).toEqual([
      { date: '2026-03-02', completedPoints: 0, scopePoints: 10 },
      { date: '2026-03-03', completedPoints: 5, scopePoints: 10 },
      { date: '2026-03-04', completedPoints: 5, scopePoints: 10 },
    ]);
  });
});

describe('cumulative-flow', () => {
  /**
   * Two tasks, replayed:
   *
   *   2026-03-01  t1 created in To Do
   *   2026-03-02  t1 -> In Progress, t2 created in To Do
   *   2026-03-03  t1 -> Done
   */
  it('replays the activity stream into per-day category counts', async () => {
    const first = await seedTask(world, { statusId: world.statuses.done });
    const second = await seedTask(world);

    await recordEvent(
      first,
      'task.created',
      { statusId: world.statuses.todo },
      '2026-03-01T09:00:00.000Z',
    );
    await recordEvent(
      first,
      'task.status_changed',
      world.statuses.inProgress,
      '2026-03-02T09:00:00.000Z',
    );
    await recordEvent(
      second,
      'task.created',
      { statusId: world.statuses.todo },
      '2026-03-02T10:00:00.000Z',
    );
    await recordEvent(
      first,
      'task.status_changed',
      world.statuses.done,
      '2026-03-03T09:00:00.000Z',
    );

    const response = await get('cumulative-flow', { from: '2026-03-01', to: '2026-03-03' });

    expect((response.body.data as CumulativeFlowReport).days).toEqual([
      { date: '2026-03-01', counts: { todo: 1, in_progress: 0, done: 0 } },
      { date: '2026-03-02', counts: { todo: 1, in_progress: 1, done: 0 } },
      { date: '2026-03-03', counts: { todo: 1, in_progress: 0, done: 1 } },
    ]);
  });

  it('emits all three category keys even when everything is zero', async () => {
    const response = await get('cumulative-flow', { from: '2026-03-01', to: '2026-03-01' });
    const days = (response.body.data as CumulativeFlowReport).days;
    expect(days).toHaveLength(1);
    expect(Object.keys(days[0]?.counts ?? {}).sort()).toEqual(['done', 'in_progress', 'todo']);
    expect(days[0]?.counts).toEqual({ todo: 0, in_progress: 0, done: 0 });
  });

  it('drops a task from the counts once it is deleted', async () => {
    const taskId = await seedTask(world);
    await recordEvent(
      taskId,
      'task.created',
      { statusId: world.statuses.todo },
      '2026-03-01T09:00:00.000Z',
    );
    await recordEvent(taskId, 'task.deleted', null, '2026-03-02T09:00:00.000Z');

    const response = await get('cumulative-flow', { from: '2026-03-01', to: '2026-03-02' });
    expect((response.body.data as CumulativeFlowReport).days).toEqual([
      { date: '2026-03-01', counts: { todo: 1, in_progress: 0, done: 0 } },
      { date: '2026-03-02', counts: { todo: 0, in_progress: 0, done: 0 } },
    ]);
  });

  it('carries state from before the window into its first day', async () => {
    const taskId = await seedTask(world);
    await recordEvent(
      taskId,
      'task.created',
      { statusId: world.statuses.inProgress },
      '2026-02-01T09:00:00.000Z',
    );

    const response = await get('cumulative-flow', { from: '2026-03-01', to: '2026-03-01' });
    expect((response.body.data as CumulativeFlowReport).days[0]?.counts).toEqual({
      todo: 0,
      in_progress: 1,
      done: 0,
    });
  });

  it('refuses an inverted window', async () => {
    const response = await get('cumulative-flow', { from: '2026-03-05', to: '2026-03-01' });
    expect(response.status).toBe(400);
  });
});

describe('velocity', () => {
  it('reads the stamps, oldest first', async () => {
    await seedSprint(world, {
      name: 'Older',
      state: 'completed',
      completedAt: new Date('2026-01-15T00:00:00.000Z'),
      committedPoints: 20,
      completedPoints: 18,
    });
    await seedSprint(world, {
      name: 'Newer',
      state: 'completed',
      completedAt: new Date('2026-02-15T00:00:00.000Z'),
      committedPoints: 25,
      completedPoints: 21,
    });
    await seedSprint(world, { name: 'Running', state: 'active' });

    const response = await get('velocity');
    const sprints = (response.body.data as VelocityReport).sprints;

    expect(sprints.map((sprint) => sprint.name)).toEqual(['Older', 'Newer']);
    expect(sprints[0]).toMatchObject({ committedPoints: 20, completedPoints: 18 });
    expect(sprints[1]).toMatchObject({ committedPoints: 25, completedPoints: 21 });
  });

  it('shows at most the last eight completed sprints', async () => {
    for (let index = 0; index < 10; index += 1) {
      await seedSprint(world, {
        name: `Sprint ${String(index)}`,
        state: 'completed',
        completedAt: new Date(Date.UTC(2026, 0, index + 1)),
        committedPoints: index,
        completedPoints: index,
      });
    }

    const sprints = ((await get('velocity')).body.data as VelocityReport).sprints;
    expect(sprints).toHaveLength(8);
    // The two OLDEST fall off, and what remains is still oldest-first.
    expect(sprints.map((sprint) => sprint.name)).toEqual([
      'Sprint 2',
      'Sprint 3',
      'Sprint 4',
      'Sprint 5',
      'Sprint 6',
      'Sprint 7',
      'Sprint 8',
      'Sprint 9',
    ]);
  });

  it('treats an unstamped sprint as zero rather than dropping it', async () => {
    await seedSprint(world, {
      name: 'Unstamped',
      state: 'completed',
      completedAt: new Date('2026-01-15T00:00:00.000Z'),
    });
    const sprints = ((await get('velocity')).body.data as VelocityReport).sprints;
    expect(sprints[0]).toMatchObject({ committedPoints: 0, completedPoints: 0 });
  });
});

describe('cycle-time', () => {
  /**
   * Two resolved tasks with a known clock, plus one that never passed through
   * an in-progress column:
   *
   *   slow  started 03-01 12:00, resolved 03-03 12:00 -> 48 h
   *   quick started 03-04 00:00, resolved 03-04 12:00 -> 12 h
   *   p50 = 12 (nearest rank over [12, 48]), p90 = 48
   */
  it('clocks from the first in-progress entry to resolution', async () => {
    const slow = await seedTask(world, {
      statusId: world.statuses.done,
      resolvedAt: new Date('2026-03-03T12:00:00.000Z'),
    });
    const quick = await seedTask(world, {
      statusId: world.statuses.done,
      resolvedAt: new Date('2026-03-04T12:00:00.000Z'),
    });
    const neverStarted = await seedTask(world, {
      statusId: world.statuses.done,
      resolvedAt: new Date('2026-03-04T18:00:00.000Z'),
    });

    await recordEvent(
      slow,
      'task.status_changed',
      world.statuses.inProgress,
      '2026-03-01T12:00:00.000Z',
    );
    // A LATER in-progress entry must not win: the clock starts at the first one.
    await recordEvent(
      slow,
      'task.status_changed',
      world.statuses.inProgress,
      '2026-03-02T12:00:00.000Z',
    );
    await recordEvent(
      quick,
      'task.status_changed',
      world.statuses.inProgress,
      '2026-03-04T00:00:00.000Z',
    );
    await recordEvent(
      neverStarted,
      'task.created',
      { statusId: world.statuses.todo },
      '2026-03-01T00:00:00.000Z',
    );

    const response = await get('cycle-time', { from: '2026-03-01', to: '2026-03-05' });
    const report = response.body.data as CycleTimeReport;

    expect(report.tasks.map((task) => task.hours)).toEqual([48, 12]);
    expect(report.tasks[0]?.taskId).toBe(slow);
    expect(report.tasks[0]?.key).toMatch(new RegExp(`^${world.projectKey}-\\d+$`, 'u'));
    expect(report.tasks.map((task) => task.taskId)).not.toContain(neverStarted);
    expect(report.p50).toBe(12);
    expect(report.p90).toBe(48);
  });

  it('counts a task created straight into an in-progress column', async () => {
    const taskId = await seedTask(world, {
      statusId: world.statuses.done,
      resolvedAt: new Date('2026-03-02T00:00:00.000Z'),
    });
    await recordEvent(
      taskId,
      'task.created',
      { statusId: world.statuses.inProgress },
      '2026-03-01T00:00:00.000Z',
    );

    const report = (await get('cycle-time', { from: '2026-03-01', to: '2026-03-05' })).body
      .data as CycleTimeReport;
    expect(report.tasks).toHaveLength(1);
    expect(report.tasks[0]?.hours).toBe(24);
  });

  it('returns null percentiles when nothing resolved in the window', async () => {
    const report = (await get('cycle-time', { from: '2026-03-01', to: '2026-03-05' })).body
      .data as CycleTimeReport;
    expect(report).toEqual({ tasks: [], p50: null, p90: null });
  });

  it('excludes a task resolved outside the window', async () => {
    const taskId = await seedTask(world, {
      statusId: world.statuses.done,
      resolvedAt: new Date('2026-04-10T00:00:00.000Z'),
    });
    await recordEvent(
      taskId,
      'task.status_changed',
      world.statuses.inProgress,
      '2026-04-09T00:00:00.000Z',
    );

    const report = (await get('cycle-time', { from: '2026-03-01', to: '2026-03-05' })).body
      .data as CycleTimeReport;
    expect(report.tasks).toEqual([]);
  });
});

describe('workload', () => {
  it('counts open work per assignee, unassigned included', async () => {
    await seedTask(world, { assigneeId: world.member.id, storyPoints: 3 });
    await seedTask(world, {
      assigneeId: world.member.id,
      storyPoints: 2,
      statusId: world.statuses.inProgress,
    });
    await seedTask(world, { storyPoints: 5 });
    // Done work is not open work.
    await seedTask(world, {
      assigneeId: world.admin.id,
      storyPoints: 8,
      statusId: world.statuses.done,
    });
    // Neither is a deleted task.
    await seedTask(world, {
      assigneeId: world.admin.id,
      storyPoints: 13,
      deletedAt: new Date(),
    });

    const report = ((await get('workload')).body.data as WorkloadReport).assignees;

    expect(report).toHaveLength(2);
    expect(report[0]).toEqual({
      user: { id: world.member.id, name: 'Project Member', avatarUrl: null },
      openTasks: 2,
      openPoints: 5,
    });
    expect(report[1]).toEqual({ user: null, openTasks: 1, openPoints: 5 });
  });

  it('is empty for a project with no open work', async () => {
    const report = ((await get('workload')).body.data as WorkloadReport).assignees;
    expect(report).toEqual([]);
  });
});

describe('report access', () => {
  it('is readable by a viewer and refused to a non-member', async () => {
    expect((await get('workload')).status).toBe(200);

    const response = await request(app)
      .get(reportUrl('workload'))
      .set('Authorization', auth(world.outsider));
    expect(response.status).toBe(403);
  });

  it('validates the query shape of every date-ranged report', async () => {
    expect((await get('cycle-time', { from: 'yesterday', to: '2026-03-01' })).status).toBe(422);
    expect((await get('burndown', { sprintId: 'nope' })).status).toBe(422);
  });
});

/**
 * The four report edges that a hand-computed happy path cannot reach.
 *
 * Each of these is a case where the report is still CORRECT but the number is
 * surprising, and where the correct answer is a decision the service made
 * rather than arithmetic. Left unpinned, the next person to touch the file
 * "fixes" one of them.
 */
describe('report edges', () => {
  describe('burndown when the scope changes mid-sprint', () => {
    it('lets remaining rise ABOVE the ideal line rather than rebasing it', async () => {
      // The ideal line is drawn from `committed_points`, which is stamped at
      // `/start` and never re-summed. Work pulled in on day two therefore shows
      // as remaining ABOVE ideal â€” which is the whole point of the chart: it
      // makes scope creep visible instead of quietly moving the goalposts.
      const sprintId = await seedSprint(world, {
        state: 'active',
        startDate: '2026-03-02',
        endDate: '2026-03-04',
        committedPoints: 10,
      });
      await seedTask(world, { sprintId, storyPoints: 10 });
      // Added after the sprint started, and never finished.
      await seedTask(world, { sprintId, storyPoints: 4 });

      const days = ((await get('burndown', { sprintId })).body.data as BurndownReport).days;

      expect(days).toEqual([
        { date: '2026-03-02', remainingPoints: 14, idealPoints: 10 },
        { date: '2026-03-03', remainingPoints: 14, idealPoints: 5 },
        { date: '2026-03-04', remainingPoints: 14, idealPoints: 0 },
      ]);
    });

    it('falls back to the CURRENT scope for a sprint that was never stamped', async () => {
      // No commitment recorded (a sprint given dates but never started through
      // `/start`), so the ideal line has to start somewhere: current scope is
      // the only honest anchor.
      const sprintId = await seedSprint(world, {
        state: 'planned',
        startDate: '2026-03-02',
        endDate: '2026-03-03',
      });
      await seedTask(world, { sprintId, storyPoints: 8 });

      const days = ((await get('burndown', { sprintId })).body.data as BurndownReport).days;

      expect(days[0]).toEqual({ date: '2026-03-02', remainingPoints: 8, idealPoints: 8 });
      expect(days[1]).toEqual({ date: '2026-03-03', remainingPoints: 8, idealPoints: 0 });
    });

    it('never draws a negative remaining when more was delivered than committed', async () => {
      const sprintId = await seedSprint(world, {
        state: 'active',
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        committedPoints: 3,
      });
      await seedTask(world, {
        sprintId,
        storyPoints: 8,
        statusId: world.statuses.done,
        resolvedAt: new Date('2026-03-02T10:00:00.000Z'),
      });

      const days = ((await get('burndown', { sprintId })).body.data as BurndownReport).days;

      expect(days).toEqual([{ date: '2026-03-02', remainingPoints: 0, idealPoints: 3 }]);
    });

    it('holds a single-day sprint s ideal at the full commitment', async () => {
      // `lastIndex === 0` â€” there is no slope to compute, and dividing by it
      // would be a NaN straight into the chart.
      const sprintId = await seedSprint(world, {
        state: 'active',
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        committedPoints: 6,
      });
      await seedTask(world, { sprintId, storyPoints: 6 });

      expect(((await get('burndown', { sprintId })).body.data as BurndownReport).days).toEqual([
        { date: '2026-03-02', remainingPoints: 6, idealPoints: 6 },
      ]);
    });

    it('keeps the burnup s scope line flat while remaining climbs past it', async () => {
      const sprintId = await seedSprint(world, {
        state: 'active',
        startDate: '2026-03-02',
        endDate: '2026-03-03',
        committedPoints: 10,
      });
      await seedTask(world, {
        sprintId,
        storyPoints: 4,
        statusId: world.statuses.done,
        resolvedAt: new Date('2026-03-03T09:00:00.000Z'),
      });
      await seedTask(world, { sprintId, storyPoints: 6 });

      expect(((await get('burnup', { sprintId })).body.data as BurnupReport).days).toEqual([
        { date: '2026-03-02', completedPoints: 0, scopePoints: 10 },
        { date: '2026-03-03', completedPoints: 4, scopePoints: 10 },
      ]);
    });
  });

  describe('cumulative flow across a status deletion', () => {
    it('attributes a task in a since-DELETED column to todo, never dropping it', async () => {
      // The CFD replays history, and history names status ids that may no
      // longer exist. Skipping the event would make the task vanish from the
      // stack mid-chart â€” a hole an operator reads as lost work. `todo` is the
      // documented least-misleading fallback.
      const [extra] = await db
        .insert(statuses)
        .values({
          projectId: world.projectId,
          name: 'Review',
          category: 'in_progress',
          position: 3,
          color: '#a855f7',
        })
        .returning({ id: statuses.id });
      if (!extra) throw new Error('could not seed the extra column');

      const taskId = await seedTask(world);
      await recordEvent(
        taskId,
        'task.created',
        { statusId: world.statuses.todo },
        '2026-03-01T09:00:00.000Z',
      );
      await recordEvent(taskId, 'task.status_changed', extra.id, '2026-03-02T09:00:00.000Z');

      // The column is removed from the workflow AFTER the fact.
      await db.delete(statuses).where(eq(statuses.id, extra.id));

      const days = (
        (await get('cumulative-flow', { from: '2026-03-01', to: '2026-03-03' })).body
          .data as CumulativeFlowReport
      ).days;

      expect(days).toEqual([
        { date: '2026-03-01', counts: { todo: 1, in_progress: 0, done: 0 } },
        // Was in_progress at the time; the column is gone, so it falls back.
        { date: '2026-03-02', counts: { todo: 1, in_progress: 0, done: 0 } },
        { date: '2026-03-03', counts: { todo: 1, in_progress: 0, done: 0 } },
      ]);
      // Whatever the bucket, the TOTAL is preserved â€” one task is still one task.
      for (const day of days) {
        const total = day.counts.todo + day.counts.in_progress + day.counts.done;
        expect(total).toBe(1);
      }
    });

    it('keeps counting a task whose column was merely RENAMED, in the same category', async () => {
      // The reason counts are keyed by category rather than status: a rename
      // must be invisible to the chart.
      const taskId = await seedTask(world);
      await recordEvent(
        taskId,
        'task.created',
        { statusId: world.statuses.inProgress },
        '2026-03-01T09:00:00.000Z',
      );
      await db
        .update(statuses)
        .set({ name: 'Doing (renamed)' })
        .where(eq(statuses.id, world.statuses.inProgress));

      expect(
        (
          (await get('cumulative-flow', { from: '2026-03-01', to: '2026-03-01' })).body
            .data as CumulativeFlowReport
        ).days[0]?.counts,
      ).toEqual({ todo: 0, in_progress: 1, done: 0 });
    });

    it('ignores an event whose payload names no status at all', async () => {
      const taskId = await seedTask(world);
      await recordEvent(
        taskId,
        'task.created',
        { statusId: world.statuses.todo },
        '2026-03-01T09:00:00.000Z',
      );
      await recordEvent(
        taskId,
        'task.status_changed',
        { note: 'no id here' },
        '2026-03-02T09:00:00.000Z',
      );

      const days = (
        (await get('cumulative-flow', { from: '2026-03-01', to: '2026-03-02' })).body
          .data as CumulativeFlowReport
      ).days;

      // The task stays where the last READABLE event put it.
      expect(days[1]?.counts).toEqual({ todo: 1, in_progress: 0, done: 0 });
    });
  });

  describe('cycle time when a task is reopened', () => {
    it('clocks from the FIRST in-progress entry, spanning the time it sat in done', async () => {
      // Deliberate, and the surprising half of "first entered in_progress":
      // a task that was called finished and then reopened did not have a fresh
      // cycle â€” the lead time a team cares about runs from when work started.
      const taskId = await seedTask(world, {
        statusId: world.statuses.done,
        resolvedAt: new Date('2026-03-05T12:00:00.000Z'),
      });
      await recordEvent(
        taskId,
        'task.created',
        { statusId: world.statuses.todo },
        '2026-03-01T00:00:00.000Z',
      );
      await recordEvent(
        taskId,
        'task.status_changed',
        world.statuses.inProgress,
        '2026-03-01T12:00:00.000Z',
      );
      await recordEvent(
        taskId,
        'task.status_changed',
        world.statuses.done,
        '2026-03-02T12:00:00.000Z',
      );
      // Reopened, worked again, resolved a second time.
      await recordEvent(
        taskId,
        'task.status_changed',
        world.statuses.inProgress,
        '2026-03-04T12:00:00.000Z',
      );
      await recordEvent(
        taskId,
        'task.status_changed',
        world.statuses.done,
        '2026-03-05T12:00:00.000Z',
      );

      const report = (await get('cycle-time', { from: '2026-03-01', to: '2026-03-06' })).body
        .data as CycleTimeReport;

      expect(report.tasks).toHaveLength(1);
      // 03-01 12:00 -> 03-05 12:00 is 96 h, NOT the 24 h of the second pass.
      expect(report.tasks[0]).toMatchObject({ hours: 96 });
      expect(report.tasks[0]?.startedAt).toBe('2026-03-01T12:00:00.000Z');
    });

    it('never reports a negative clock when the stamps disagree', async () => {
      // `resolved_at` is written by the move transaction and the in-progress
      // instant is read from the audit stream; a clock skew between them must
      // floor at zero rather than draw a point below the axis.
      const taskId = await seedTask(world, {
        statusId: world.statuses.done,
        resolvedAt: new Date('2026-03-01T00:00:00.000Z'),
      });
      await recordEvent(
        taskId,
        'task.status_changed',
        world.statuses.inProgress,
        '2026-03-01T06:00:00.000Z',
      );

      const report = (await get('cycle-time', { from: '2026-03-01', to: '2026-03-02' })).body
        .data as CycleTimeReport;

      expect(report.tasks[0]?.hours).toBe(0);
      expect(report.p50).toBe(0);
    });

    it('omits a reopened task that is currently unresolved', async () => {
      // No `resolved_at` means no clock to stop; it is work in flight, not a
      // zero-length cycle.
      const taskId = await seedTask(world, { statusId: world.statuses.inProgress });
      await recordEvent(
        taskId,
        'task.status_changed',
        world.statuses.inProgress,
        '2026-03-01T06:00:00.000Z',
      );

      expect(
        (
          (await get('cycle-time', { from: '2026-03-01', to: '2026-03-02' })).body
            .data as CycleTimeReport
        ).tasks,
      ).toEqual([]);
    });
  });

  describe('velocity with zero-point sprints', () => {
    it('keeps a sprint that committed and delivered nothing on the chart', async () => {
      // A zero bar is a data point â€” a sprint spent entirely on unestimated
      // work or on an incident. Dropping it would silently shorten the series
      // and flatter the average.
      await seedSprint(world, {
        name: 'Firefighting',
        state: 'completed',
        completedAt: new Date('2026-01-10T00:00:00.000Z'),
        committedPoints: 0,
        completedPoints: 0,
      });
      await seedSprint(world, {
        name: 'Normal',
        state: 'completed',
        completedAt: new Date('2026-01-20T00:00:00.000Z'),
        committedPoints: 20,
        completedPoints: 18,
      });

      const sprints = ((await get('velocity')).body.data as VelocityReport).sprints;

      expect(sprints.map((sprint) => sprint.name)).toEqual(['Firefighting', 'Normal']);
      expect(sprints[0]).toMatchObject({ committedPoints: 0, completedPoints: 0 });
    });

    it('reports a committed sprint that delivered zero, not a missing row', async () => {
      await seedSprint(world, {
        name: 'Missed',
        state: 'completed',
        completedAt: new Date('2026-01-10T00:00:00.000Z'),
        committedPoints: 13,
        completedPoints: 0,
      });

      expect(((await get('velocity')).body.data as VelocityReport).sprints[0]).toMatchObject({
        committedPoints: 13,
        completedPoints: 0,
      });
    });

    it('never re-sums a closed sprint from its tasks â€” the stamps are the fact', async () => {
      // The sprint says it delivered 5; its tasks currently say something else
      // (they were moved out afterwards). The stamp wins, because it is what
      // was true when the sprint closed.
      const sprintId = await seedSprint(world, {
        name: 'Stamped',
        state: 'completed',
        completedAt: new Date('2026-01-10T00:00:00.000Z'),
        committedPoints: 8,
        completedPoints: 5,
      });
      await seedTask(world, { sprintId, storyPoints: 99, statusId: world.statuses.done });

      expect(((await get('velocity')).body.data as VelocityReport).sprints[0]).toMatchObject({
        committedPoints: 8,
        completedPoints: 5,
      });
    });

    it('is empty for a project whose sprints have all been planned but never closed', async () => {
      await seedSprint(world, { state: 'active' });
      await seedSprint(world, { state: 'planned' });

      expect(((await get('velocity')).body.data as VelocityReport).sprints).toEqual([]);
    });
  });
});
