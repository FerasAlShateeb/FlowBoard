/**
 * Sprints — the scrum cycle, and the two point stamps velocity is built on.
 *
 * `committedPoints` is written AT START and `completedPoints` AT COMPLETE, and
 * neither is ever recomputed. That is the whole reason velocity means anything:
 * re-estimating a task after its sprint closed must not rewrite the number the
 * team used to plan the next one.
 *
 * ONE ACTIVE SPRINT PER PROJECT is enforced by the partial unique index
 * `sprints_one_active_per_project`, not by a check-then-write. Two concurrent
 * `/start` calls race in the database and the loser's `23505` is translated
 * here into a 409 — application locking would only move the race, not remove
 * it.
 *
 * Sprint window columns are `date` and the contract carries calendar days
 * (`isoDate`), so the two agree byte for byte and nothing in this file converts
 * a date. `startedAt` / `completedAt` are the instants, and those are
 * `timestamptz`.
 */
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type {
  CompleteSprintInput,
  CreateSprintInput,
  Sprint,
  SprintState,
  StartSprintInput,
  UpdateSprintInput,
} from '@flowboard/shared';

import { db, sprints, statuses, tasks, withTx, type Db, type Tx } from '../db';
import { ApiError } from '../utils/api-error';
import { publishDomainEvent } from '../utils/domain-events';
import {
  lockBuckets,
  sequentialRanksAfter,
  tailRank,
  type RankBucket,
} from '../utils/rank-rebalance';
import { recordActivity } from './activity.service';
// `23505` is the signal the `sprints_one_active_per_project` partial unique
// index emits when two `/start` calls race. The shared predicate walks the
// Drizzle `cause` chain — see `pg-errors.ts` for why that matters.
import { isUniqueViolation } from './pg-errors';
import { record } from './telemetry.service';
import { toIsoDateTime, type ProjectScope, type TaskActor } from './tasks.service';

type Executor = Db | Tx;

/*
 * NO DATE CONVERSION HAPPENS IN THIS FILE, and that is the point.
 *
 * `sprints.start_date` / `end_date` are `date` columns (WP2.5 changed them from
 * `timestamptz`, per the plan), so postgres-js hands them over as the same
 * `YYYY-MM-DD` string the shared `isoDate` contract carries. The pair of
 * `toDateOnly` / `fromDateOnly` helpers this replaced existed only to bridge a
 * column type that should never have been an instant: every round trip through
 * them was a chance for a sprint boundary to shift a day under a non-UTC
 * reader, which is how a two-week sprint renders as thirteen on a burndown.
 */

const sprintSelection = {
  id: sprints.id,
  projectId: sprints.projectId,
  name: sprints.name,
  goal: sprints.goal,
  state: sprints.state,
  startDate: sprints.startDate,
  endDate: sprints.endDate,
  startedAt: sprints.startedAt,
  completedAt: sprints.completedAt,
  committedPoints: sprints.committedPoints,
  completedPoints: sprints.completedPoints,
  createdAt: sprints.createdAt,
  updatedAt: sprints.updatedAt,
};

function toSprint(row: {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  state: SprintState;
  /** `YYYY-MM-DD` — a `date` column, straight through to the contract. */
  startDate: string | null;
  endDate: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  committedPoints: number | null;
  completedPoints: number | null;
  createdAt: Date;
  updatedAt: Date;
}): Sprint {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    goal: row.goal,
    state: row.state,
    startDate: row.startDate,
    endDate: row.endDate,
    startedAt: row.startedAt === null ? null : toIsoDateTime(row.startedAt),
    completedAt: row.completedAt === null ? null : toIsoDateTime(row.completedAt),
    committedPoints: row.committedPoints,
    completedPoints: row.completedPoints,
    createdAt: toIsoDateTime(row.createdAt),
    updatedAt: toIsoDateTime(row.updatedAt),
  };
}

/** Load one sprint of THIS project, or 404. */
export async function requireSprint(
  executor: Executor,
  projectId: string,
  sprintId: string,
): Promise<Sprint> {
  const [row] = await executor
    .select(sprintSelection)
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.projectId, projectId)))
    .limit(1);
  if (!row) throw ApiError.notFound('Sprint not found');
  return toSprint(row);
}

/** The project a sprint id belongs to — the route only carries `:sprintId`. */
export async function requireSprintProject(executor: Executor, sprintId: string): Promise<string> {
  const [row] = await executor
    .select({ projectId: sprints.projectId })
    .from(sprints)
    .where(eq(sprints.id, sprintId))
    .limit(1);
  if (!row) throw ApiError.notFound('Sprint not found');
  return row.projectId;
}

/** `GET /projects/:projectId/sprints?state=`. */
export async function listSprints(projectId: string, state?: SprintState): Promise<Sprint[]> {
  const rows = await db
    .select(sprintSelection)
    .from(sprints)
    .where(
      state === undefined
        ? eq(sprints.projectId, projectId)
        : and(eq(sprints.projectId, projectId), eq(sprints.state, state)),
    )
    .orderBy(asc(sprints.createdAt), asc(sprints.id));
  return rows.map(toSprint);
}

function publishSprint(
  scope: ProjectScope,
  actor: TaskActor,
  sprintId: string,
  action: 'created' | 'updated' | 'started' | 'completed' | 'deleted',
): void {
  publishDomainEvent('sprint.changed', {
    projectId: scope.projectId,
    actorId: actor.userId,
    originSocketId: actor.socketId,
    sprintId,
    action,
  });
}

/** `POST /projects/:projectId/sprints` — always born `planned`. */
export async function createSprint(
  scope: ProjectScope,
  actor: TaskActor,
  input: CreateSprintInput,
): Promise<Sprint> {
  const sprint = await withTx(async (tx) => {
    const [row] = await tx
      .insert(sprints)
      .values({
        projectId: scope.projectId,
        name: input.name,
        goal: input.goal,
        state: 'planned',
        startDate: input.startDate,
        endDate: input.endDate,
      })
      .returning(sprintSelection);
    if (!row) throw ApiError.internal('Sprint insert returned no row');

    await recordActivity(
      {
        projectId: scope.projectId,
        actorId: actor.userId,
        action: 'sprint.created',
        newValue: { sprintId: row.id, name: row.name },
      },
      tx,
    );
    return toSprint(row);
  });

  publishSprint(scope, actor, sprint.id, 'created');
  return sprint;
}

/** `PATCH /sprints/:sprintId` — name / goal / planned window only. */
export async function updateSprint(
  scope: ProjectScope,
  actor: TaskActor,
  sprintId: string,
  input: UpdateSprintInput,
): Promise<Sprint> {
  const sprint = await withTx(async (tx) => {
    const current = await requireSprint(tx, scope.projectId, sprintId);
    const updates: Record<string, unknown> = {};
    if (input.name !== undefined) updates['name'] = input.name;
    if (input.goal !== undefined) updates['goal'] = input.goal;
    if (input.startDate !== undefined) updates['startDate'] = input.startDate;
    if (input.endDate !== undefined) updates['endDate'] = input.endDate;

    // The window is check-constrained in the database; keep the two halves
    // consistent when only one of them is being edited.
    const nextStart = input.startDate === undefined ? current.startDate : input.startDate;
    const nextEnd = input.endDate === undefined ? current.endDate : input.endDate;
    if (nextStart !== null && nextEnd !== null && nextEnd < nextStart) {
      throw ApiError.badRequest('endDate must not be before startDate');
    }

    const [row] = await tx
      .update(sprints)
      .set(updates)
      .where(eq(sprints.id, sprintId))
      .returning(sprintSelection);
    if (!row) throw ApiError.notFound('Sprint not found');
    return toSprint(row);
  });

  publishSprint(scope, actor, sprintId, 'updated');
  return sprint;
}

/**
 * Move a set of tasks into a backlog bucket, appending them in a stable order.
 *
 * Shared by `/complete` and by sprint deletion — both have to put work
 * somewhere, and both must leave the destination's existing order untouched.
 *
 * Takes the destination's bucket lock first, like every other rank computation:
 * emptying a sprint into the backlog reads ONE tail and derives N keys from it,
 * so a backlog drag committing in the middle of that would collide with all of
 * them at once. See `rank-rebalance.lockBuckets`.
 */
async function moveTasksToBucket(
  tx: Tx,
  projectId: string,
  taskIds: readonly string[],
  destinationSprintId: string | null,
): Promise<void> {
  if (taskIds.length === 0) return;
  const bucket: RankBucket = { kind: 'backlog', projectId, sprintId: destinationSprintId };
  await lockBuckets(tx, bucket);
  const tail = await tailRank(tx, bucket);
  const ranks = sequentialRanksAfter(tail, taskIds.length);

  for (const [index, taskId] of taskIds.entries()) {
    const rank = ranks[index];
    if (rank === undefined) throw ApiError.internal('Rank sequence was too short');
    await tx
      .update(tasks)
      .set({ sprintId: destinationSprintId, backlogRank: rank })
      .where(eq(tasks.id, taskId));
  }
}

/** Tasks that still belong to a sprint, oldest rank first. */
async function sprintTaskIds(
  tx: Tx,
  projectId: string,
  sprintId: string,
  onlyCategory?: 'incomplete',
): Promise<string[]> {
  const rows = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(statuses, eq(tasks.statusId, statuses.id))
    .where(
      and(
        eq(tasks.projectId, projectId),
        eq(tasks.sprintId, sprintId),
        isNull(tasks.deletedAt),
        onlyCategory === undefined ? undefined : ne(statuses.category, 'done'),
      ),
    )
    .orderBy(asc(tasks.backlogRank), asc(tasks.id));
  return rows.map((row) => row.id);
}

/**
 * `DELETE /sprints/:sprintId` — hard delete, after emptying it.
 *
 * Sprints carry no `deleted_at` (see database.md); the guard that makes that
 * safe is this one: every task is returned to the backlog inside the same
 * transaction, so no work can be orphaned by the delete.
 */
export async function deleteSprint(
  scope: ProjectScope,
  actor: TaskActor,
  sprintId: string,
): Promise<void> {
  await withTx(async (tx) => {
    await requireSprint(tx, scope.projectId, sprintId);
    const taskIds = await sprintTaskIds(tx, scope.projectId, sprintId);
    await moveTasksToBucket(tx, scope.projectId, taskIds, null);
    await tx.delete(sprints).where(eq(sprints.id, sprintId));

    await recordActivity(
      {
        projectId: scope.projectId,
        actorId: actor.userId,
        action: 'sprint.deleted',
        oldValue: { sprintId, movedTasks: taskIds.length },
      },
      tx,
    );
  });

  publishSprint(scope, actor, sprintId, 'deleted');
}

/** Sum of story points over a set of tasks, `0` when nothing is estimated. */
async function sumPoints(tx: Tx, condition: ReturnType<typeof and>): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`coalesce(sum(${tasks.storyPoints}), 0)::int` })
    .from(tasks)
    .innerJoin(statuses, eq(tasks.statusId, statuses.id))
    .where(condition);
  return row?.value ?? 0;
}

/**
 * `POST /sprints/:sprintId/start` — stamps the commitment.
 *
 * The 409 comes from the partial unique index, caught outside the transaction
 * because the failed INSERT/UPDATE has already aborted it.
 */
export async function startSprint(
  scope: ProjectScope,
  actor: TaskActor,
  sprintId: string,
  input: StartSprintInput,
): Promise<Sprint> {
  let sprint: Sprint;
  try {
    sprint = await withTx(async (tx) => {
      const current = await requireSprint(tx, scope.projectId, sprintId);
      if (current.state !== 'planned') {
        throw ApiError.conflict('Only a planned sprint can be started');
      }

      const committedPoints = await sumPoints(
        tx,
        and(
          eq(tasks.projectId, scope.projectId),
          eq(tasks.sprintId, sprintId),
          isNull(tasks.deletedAt),
        ),
      );

      const [row] = await tx
        .update(sprints)
        .set({
          state: 'active',
          startDate: input.startDate,
          endDate: input.endDate,
          startedAt: new Date(),
          committedPoints,
        })
        .where(eq(sprints.id, sprintId))
        .returning(sprintSelection);
      if (!row) throw ApiError.notFound('Sprint not found');

      await recordActivity(
        {
          projectId: scope.projectId,
          actorId: actor.userId,
          action: 'sprint.started',
          newValue: { sprintId, committedPoints },
        },
        tx,
      );
      return toSprint(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, 'sprint_already_active', 'This project already has an active sprint');
    }
    throw error;
  }

  record(
    'sprint_started',
    { sprintId, committedPoints: sprint.committedPoints },
    {
      userId: actor.userId,
      orgId: scope.orgId,
      projectId: scope.projectId,
    },
  );
  publishSprint(scope, actor, sprintId, 'started');
  return sprint;
}

/** `POST /sprints/:sprintId/complete` — stamps velocity and rehomes the leftovers. */
export async function completeSprint(
  scope: ProjectScope,
  actor: TaskActor,
  sprintId: string,
  input: CompleteSprintInput,
): Promise<Sprint> {
  const result = await withTx(async (tx) => {
    const current = await requireSprint(tx, scope.projectId, sprintId);
    if (current.state !== 'active') {
      throw ApiError.conflict('Only an active sprint can be completed');
    }

    const destination = input.moveIncompleteTo === 'backlog' ? null : input.moveIncompleteTo;
    if (destination !== null) {
      if (destination === sprintId) {
        throw ApiError.badRequest('Incomplete work cannot be moved into the sprint being closed');
      }
      const target = await requireSprint(tx, scope.projectId, destination);
      if (target.state === 'completed') {
        throw ApiError.badRequest('Cannot move work into a completed sprint');
      }
    }

    // Points are counted BEFORE the move, while the sprint still holds its work.
    const completedPoints = await sumPoints(
      tx,
      and(
        eq(tasks.projectId, scope.projectId),
        eq(tasks.sprintId, sprintId),
        isNull(tasks.deletedAt),
        eq(statuses.category, 'done'),
      ),
    );

    const incomplete = await sprintTaskIds(tx, scope.projectId, sprintId, 'incomplete');
    await moveTasksToBucket(tx, scope.projectId, incomplete, destination);

    const [row] = await tx
      .update(sprints)
      .set({ state: 'completed', completedAt: new Date(), completedPoints })
      .where(eq(sprints.id, sprintId))
      .returning(sprintSelection);
    if (!row) throw ApiError.notFound('Sprint not found');

    await recordActivity(
      {
        projectId: scope.projectId,
        actorId: actor.userId,
        action: 'sprint.completed',
        newValue: { sprintId, completedPoints, movedTasks: incomplete.length },
      },
      tx,
    );

    return { sprint: toSprint(row), moved: incomplete.length };
  });

  record(
    'sprint_completed',
    {
      sprintId,
      completedPoints: result.sprint.completedPoints,
      movedTasks: result.moved,
    },
    { userId: actor.userId, orgId: scope.orgId, projectId: scope.projectId },
  );
  publishSprint(scope, actor, sprintId, 'completed');
  return result.sprint;
}

/** Exported for the reports service, which formats the same rows. */
export { toSprint, sprintSelection };

/** Kept for callers that need the raw id set (tests, future bulk tooling). */
export type SprintIdList = ReturnType<typeof inArray>;
