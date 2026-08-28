/**
 * The six project reports.
 *
 * Two different sources of truth, chosen per report on purpose:
 *
 *  - **Point reports** (burndown, burnup, velocity, workload) read the CURRENT
 *    task rows plus the sprint's two stamped point columns. Velocity in
 *    particular never re-sums a closed sprint — `committed_points` and
 *    `completed_points` are facts recorded at `/start` and `/complete`.
 *  - **The cumulative-flow diagram REPLAYS THE ACTIVITY STREAM.** There is no
 *    other way to answer "how many tasks were in progress last Tuesday": the
 *    task rows only know where things are now. That is what the append-only
 *    `activity` table exists for, and why `task.created` records the status the
 *    task was born in.
 *
 * Every series is pre-bucketed by CALENDAR DAY (UTC) here rather than in the
 * browser, and the day keys are `isoDate` — never instants. See the note on
 * `isoDate` in the shared package for why that distinction is load-bearing.
 */
import { and, asc, eq, gte, isNull, lte, ne, sql } from 'drizzle-orm';
import type {
  BurndownReport,
  BurnupReport,
  CumulativeFlowReport,
  CycleTimeReport,
  CycleTimeTask,
  StatusCategory,
  VelocityReport,
  WorkloadReport,
} from '@flowboard/shared';

import { activity, db, projects, sprints, statuses, tasks, users } from '../db';
import { ApiError } from '../utils/api-error';

/** How many completed sprints the velocity chart shows. */
const VELOCITY_SPRINT_LIMIT = 8;

const MS_PER_HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// Day arithmetic (UTC — a report bucket is a calendar day, not an instant)
// ---------------------------------------------------------------------------

/** `Date` -> `YYYY-MM-DD`. */
function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The first instant of a calendar day. */
function startOfDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The last instant of a calendar day — the "as of end of D" cut every series uses. */
function endOfDay(day: string): Date {
  return new Date(`${day}T23:59:59.999Z`);
}

/** Every calendar day in `[from, to]`, inclusive. Capped so a typo cannot DoS. */
function daysBetween(from: string, to: string): string[] {
  const start = startOfDay(from).getTime();
  const end = startOfDay(to).getTime();
  if (end < start) throw ApiError.badRequest('`to` must not be before `from`');
  const days: string[] = [];
  const MAX_DAYS = 400;
  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    days.push(dayKey(new Date(cursor)));
    if (days.length > MAX_DAYS) throw ApiError.badRequest('Report window is too wide');
  }
  return days;
}

/** Two decimals — points are halves at most, and float noise reads as a bug. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Burndown / burnup
// ---------------------------------------------------------------------------

interface SprintScope {
  id: string;
  /** `YYYY-MM-DD` — `sprints.start_date` is a `date` column, not an instant. */
  startDate: string | null;
  endDate: string | null;
  committedPoints: number | null;
}

async function requireSprintScope(projectId: string, sprintId: string): Promise<SprintScope> {
  const [row] = await db
    .select({
      id: sprints.id,
      startDate: sprints.startDate,
      endDate: sprints.endDate,
      committedPoints: sprints.committedPoints,
    })
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.projectId, projectId)))
    .limit(1);
  if (!row) throw ApiError.notFound('Sprint not found');
  return row;
}

/** The sprint's current contents: what each task is worth and when it resolved. */
async function sprintTaskPoints(
  projectId: string,
  sprintId: string,
): Promise<{ points: number; resolvedAt: Date | null }[]> {
  const rows = await db
    .select({ points: tasks.storyPoints, resolvedAt: tasks.resolvedAt })
    .from(tasks)
    .where(
      and(eq(tasks.projectId, projectId), eq(tasks.sprintId, sprintId), isNull(tasks.deletedAt)),
    );
  return rows.map((row) => ({ points: row.points ?? 0, resolvedAt: row.resolvedAt }));
}

/**
 * `GET /projects/:projectId/reports/burndown?sprintId=`.
 *
 * `remainingPoints` is what had NOT resolved by the end of each day;
 * `idealPoints` is the straight line from the sprint's commitment to zero,
 * computed here so the two series can never disagree about the sprint's length.
 * A sprint with no planned window has no x-axis, hence no days.
 */
export async function burndown(projectId: string, sprintId: string): Promise<BurndownReport> {
  const sprint = await requireSprintScope(projectId, sprintId);
  if (sprint.startDate === null || sprint.endDate === null) return { days: [] };

  const days = daysBetween(sprint.startDate, sprint.endDate);
  const entries = await sprintTaskPoints(projectId, sprintId);
  const scope = entries.reduce((sum, entry) => sum + entry.points, 0);
  const total = sprint.committedPoints ?? scope;
  const lastIndex = days.length - 1;

  return {
    days: days.map((day, index) => {
      const cut = endOfDay(day);
      const remaining = entries.reduce(
        (sum, entry) =>
          entry.resolvedAt !== null && entry.resolvedAt <= cut ? sum : sum + entry.points,
        0,
      );
      const ideal = lastIndex > 0 ? (total * (lastIndex - index)) / lastIndex : total;
      return {
        date: day,
        remainingPoints: round2(Math.max(0, remaining)),
        idealPoints: round2(Math.max(0, ideal)),
      };
    }),
  };
}

/**
 * `GET /projects/:projectId/reports/burnup?sprintId=`.
 *
 * The pair a burndown hides: `completedPoints` climbing under a `scopePoints`
 * line that should be flat. Scope is the sprint's CURRENT contents — see the
 * gap note in the WP report for why it is not yet replayed day by day.
 */
export async function burnup(projectId: string, sprintId: string): Promise<BurnupReport> {
  const sprint = await requireSprintScope(projectId, sprintId);
  if (sprint.startDate === null || sprint.endDate === null) return { days: [] };

  const days = daysBetween(sprint.startDate, sprint.endDate);
  const entries = await sprintTaskPoints(projectId, sprintId);
  const scope = entries.reduce((sum, entry) => sum + entry.points, 0);

  return {
    days: days.map((day) => {
      const cut = endOfDay(day);
      const completed = entries.reduce(
        (sum, entry) =>
          entry.resolvedAt !== null && entry.resolvedAt <= cut ? sum + entry.points : sum,
        0,
      );
      return {
        date: day,
        completedPoints: round2(completed),
        scopePoints: round2(scope),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Cumulative flow
// ---------------------------------------------------------------------------

/** Every category key, always emitted — the stacked areas must never gap. */
const CATEGORIES: readonly StatusCategory[] = ['todo', 'in_progress', 'done'];

function emptyCounts(): Record<StatusCategory, number> {
  return { todo: 0, in_progress: 0, done: 0 };
}

/**
 * Pull a status id out of an activity row's jsonb.
 *
 * `task.created` stores `{ statusId, type }` while `task.status_changed` stores
 * the bare id, so both shapes are accepted rather than making the writer
 * normalise — the column is `unknown` on the TS side and must be narrowed here,
 * never cast.
 */
function readStatusId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'statusId' in value) {
    const raw = (value as { statusId?: unknown }).statusId;
    return typeof raw === 'string' ? raw : null;
  }
  return null;
}

/**
 * `GET /projects/:projectId/reports/cumulative-flow?from=&to=`.
 *
 * Replays `task.created` / `task.status_changed` / `task.deleted` from the
 * beginning of the project so the state entering the window is correct, then
 * snapshots the per-category totals at the END of each day in it.
 *
 * Counts are keyed by CATEGORY, not status: a CFD has to stay comparable across
 * a workflow edit, and renaming or deleting a column would otherwise punch a
 * hole through the middle of the chart.
 */
export async function cumulativeFlow(
  projectId: string,
  from: string,
  to: string,
): Promise<CumulativeFlowReport> {
  const days = daysBetween(from, to);

  const [statusRows, events] = await Promise.all([
    db
      .select({ id: statuses.id, category: statuses.category })
      .from(statuses)
      .where(eq(statuses.projectId, projectId)),
    db
      .select({
        action: activity.action,
        taskId: activity.taskId,
        newValue: activity.newValue,
        createdAt: activity.createdAt,
      })
      .from(activity)
      .where(
        and(
          eq(activity.projectId, projectId),
          lte(activity.createdAt, endOfDay(to)),
          sql`${activity.action} IN ('task.created', 'task.status_changed', 'task.deleted')`,
        ),
      )
      .orderBy(asc(activity.id)),
  ]);

  const categoryOf = new Map(statusRows.map((row) => [row.id, row.category]));
  /** taskId -> the category it sat in after the last event processed. */
  const state = new Map<string, StatusCategory>();
  let cursor = 0;

  return {
    days: days.map((day) => {
      const cut = endOfDay(day);
      while (cursor < events.length) {
        const event = events[cursor];
        if (event === undefined || event.createdAt > cut) break;
        cursor += 1;
        if (event.taskId === null) continue;

        if (event.action === 'task.deleted') {
          state.delete(event.taskId);
          continue;
        }
        const statusId = readStatusId(event.newValue);
        if (statusId === null) continue;
        // A status deleted since the event leaves no category to attribute to;
        // `todo` is the least misleading fallback for the leftmost bucket.
        state.set(event.taskId, categoryOf.get(statusId) ?? 'todo');
      }

      const counts = emptyCounts();
      for (const category of state.values()) counts[category] += 1;
      return {
        date: day,
        counts: Object.fromEntries(
          CATEGORIES.map((category) => [category, counts[category]]),
        ) as Record<StatusCategory, number>,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

/**
 * `GET /projects/:projectId/reports/velocity` — the last few closed sprints,
 * OLDEST FIRST (the chart reads left to right).
 *
 * Both numbers are the stamps, never a re-sum: that is the entire contract of
 * the two point columns.
 */
export async function velocity(projectId: string): Promise<VelocityReport> {
  const rows = await db
    .select({
      sprintId: sprints.id,
      name: sprints.name,
      committedPoints: sprints.committedPoints,
      completedPoints: sprints.completedPoints,
    })
    .from(sprints)
    .where(and(eq(sprints.projectId, projectId), eq(sprints.state, 'completed')))
    .orderBy(sql`${sprints.completedAt} DESC NULLS LAST`, sql`${sprints.createdAt} DESC`)
    .limit(VELOCITY_SPRINT_LIMIT);

  return {
    sprints: rows.reverse().map((row) => ({
      sprintId: row.sprintId,
      name: row.name,
      committedPoints: row.committedPoints ?? 0,
      completedPoints: row.completedPoints ?? 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// Cycle time
// ---------------------------------------------------------------------------

/**
 * Nearest-rank percentile over an ascending list.
 *
 * Nearest-rank rather than interpolated: every value returned is a real
 * observation, which is what a reference line drawn over a scatter of real
 * points has to be to make sense.
 */
function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? null;
}

/**
 * `GET /projects/:projectId/reports/cycle-time?from=&to=`.
 *
 * The clock starts when a task FIRST entered an `in_progress` column — read out
 * of the activity stream, not from `created_at`, because a year spent in the
 * backlog is not cycle time — and stops at `resolved_at`. Tasks that resolved
 * without ever passing through `in_progress` have no clock and are omitted.
 */
export async function cycleTime(
  projectId: string,
  from: string,
  to: string,
): Promise<CycleTimeReport> {
  const windowStart = startOfDay(from);
  const windowEnd = endOfDay(to);

  const [projectRow] = await db
    .select({ key: projects.key })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!projectRow) throw ApiError.notFound('Project not found');

  const resolved = await db
    .select({ id: tasks.id, number: tasks.number, resolvedAt: tasks.resolvedAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        isNull(tasks.deletedAt),
        gte(tasks.resolvedAt, windowStart),
        lte(tasks.resolvedAt, windowEnd),
      ),
    )
    .orderBy(asc(tasks.number));

  if (resolved.length === 0) return { tasks: [], p50: null, p90: null };

  const inProgressIds = new Set(
    (
      await db
        .select({ id: statuses.id })
        .from(statuses)
        .where(and(eq(statuses.projectId, projectId), eq(statuses.category, 'in_progress')))
    ).map((row) => row.id),
  );

  const events = await db
    .select({
      taskId: activity.taskId,
      action: activity.action,
      newValue: activity.newValue,
      createdAt: activity.createdAt,
    })
    .from(activity)
    .where(
      and(
        eq(activity.projectId, projectId),
        sql`${activity.action} IN ('task.created', 'task.status_changed')`,
      ),
    )
    .orderBy(asc(activity.id));

  /** taskId -> the first instant it was seen in an `in_progress` column. */
  const startedAt = new Map<string, Date>();
  for (const event of events) {
    if (event.taskId === null || startedAt.has(event.taskId)) continue;
    const statusId = readStatusId(event.newValue);
    if (statusId === null || !inProgressIds.has(statusId)) continue;
    startedAt.set(event.taskId, event.createdAt);
  }

  const rows: CycleTimeTask[] = [];
  for (const task of resolved) {
    const started = startedAt.get(task.id);
    if (started === undefined || task.resolvedAt === null) continue;
    const hours = Math.max(0, (task.resolvedAt.getTime() - started.getTime()) / MS_PER_HOUR);
    rows.push({
      taskId: task.id,
      key: `${projectRow.key}-${String(task.number)}`,
      startedAt: started.toISOString(),
      resolvedAt: task.resolvedAt.toISOString(),
      hours: round2(hours),
    });
  }

  const sorted = rows.map((row) => row.hours).sort((left, right) => left - right);
  return {
    tasks: rows,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
  };
}

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

/**
 * `GET /projects/:projectId/reports/workload`.
 *
 * "Open" is every task NOT in a `done` column, and the `null` assignee bucket is
 * a first-class row — unassigned work is exactly what this chart is read to
 * find.
 */
export async function workload(projectId: string): Promise<WorkloadReport> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      avatarUrl: users.avatarUrl,
      openTasks: sql<number>`count(*)::int`,
      openPoints: sql<number>`coalesce(sum(${tasks.storyPoints}), 0)::int`,
    })
    .from(tasks)
    .innerJoin(statuses, eq(tasks.statusId, statuses.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(
      and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), ne(statuses.category, 'done')),
    )
    .groupBy(users.id, users.name, users.avatarUrl)
    .orderBy(sql`coalesce(sum(${tasks.storyPoints}), 0) DESC`, sql`count(*) DESC`);

  return {
    assignees: rows.map((row) => ({
      user:
        row.userId === null || row.name === null
          ? null
          : { id: row.userId, name: row.name, avatarUrl: row.avatarUrl },
      openTasks: row.openTasks,
      openPoints: round2(row.openPoints),
    })),
  };
}
