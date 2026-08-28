/**
 * Coverage for the rank utility, in two halves.
 *
 * The PURE half (`sequentialRanksAfter`, the rebalance trigger) needs nothing
 * but the shared generator. The NEIGHBOUR-READING half (`computeRank`,
 * `rebalanceBucket`, `tailRank`, `appendRank`) reads rows, so it runs against
 * the live `flowboard_test` database like every other integration suite.
 *
 * The move/rank ROUTE suite already proves those functions work through HTTP.
 * What it cannot reach — because the API refuses to create the state — is the
 * boundary set this file owns: a column with exactly one task in it, a
 * neighbour that has quietly left the bucket, a key that lands exactly on the
 * rebalance threshold, and a rebalance of a bucket that is empty or that does
 * not contain the task it was told about.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { NEEDS_REBALANCE_LENGTH, needsRebalance, rankBetween } from '@flowboard/shared';

import { closeDb, db, tasks } from '../db';
import { ensureTestDb, truncateAllTables } from '../test/test-db';
import {
  seedSprint,
  seedTask,
  seedWorld,
  type World,
} from '../routes/__tests__/task-domain.fixtures';
import { ApiError } from './api-error';
import {
  appendRank,
  bucketLockKey,
  computeRank,
  lockBuckets,
  rebalanceBucket,
  sequentialRanksAfter,
  tailRank,
  type RankBucket,
} from './rank-rebalance';

describe('sequentialRanksAfter', () => {
  it('returns nothing for a count of zero', () => {
    expect(sequentialRanksAfter(null, 0)).toEqual([]);
    expect(sequentialRanksAfter('a0', 0)).toEqual([]);
  });

  it('produces strictly ascending keys from an empty bucket', () => {
    const ranks = sequentialRanksAfter(null, 5);
    expect(ranks).toHaveLength(5);
    expect([...ranks].sort()).toEqual(ranks);
    expect(new Set(ranks).size).toBe(5);
  });

  it('starts after the tail it is given', () => {
    const tail = 'a5';
    const ranks = sequentialRanksAfter(tail, 3);
    expect(ranks.every((rank) => rank > tail)).toBe(true);
    expect([...ranks].sort()).toEqual(ranks);
  });
});

describe('the rebalance trigger', () => {
  it('does not fire for keys produced by ordinary appends', () => {
    let previous: string | null = null;
    for (let index = 0; index < 50; index += 1) {
      previous = rankBetween(previous, null);
      expect(needsRebalance(previous)).toBe(false);
    }
  });

  it('fires when a key is squeezed into a pathologically narrow gap', () => {
    // Repeatedly inserting into the SAME gap is what grows a key without
    // bound; this is the end state of that loop, reached in one step.
    const narrow = `a0${'0'.repeat(70)}1`;
    const squeezed = rankBetween('a0', narrow);
    expect(squeezed.length).toBeGreaterThanOrEqual(NEEDS_REBALANCE_LENGTH);
    expect(needsRebalance(squeezed)).toBe(true);
    expect(squeezed > 'a0').toBe(true);
    expect(squeezed < narrow).toBe(true);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The neighbour-reading half â€” live database
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let world: World;

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
  world = await seedWorld();
});

afterAll(async () => {
  await closeDb();
});

/** The board bucket of a column in the seeded project. */
function boardBucket(statusId: string): RankBucket {
  return { kind: 'board', projectId: world.projectId, statusId };
}

/** The backlog bucket â€” `sprintId: null` IS the backlog. */
function backlogBucket(sprintId: string | null): RankBucket {
  return { kind: 'backlog', projectId: world.projectId, sprintId };
}

async function boardRankOf(taskId: string): Promise<string> {
  const [row] = await db
    .select({ rank: tasks.boardRank })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row) throw new Error(`no task ${taskId}`);
  return row.rank;
}

/** Board-order ids of a column, straight from the rank column. */
async function columnOrder(statusId: string): Promise<string[]> {
  const rows = await db
    .select({ id: tasks.id, rank: tasks.boardRank })
    .from(tasks)
    .where(eq(tasks.statusId, statusId))
    .orderBy(tasks.boardRank);
  return rows.map((row) => row.id);
}

describe('computeRank â€” the guards, which run before any read', () => {
  it('refuses both neighbours at once', async () => {
    const moving = await seedTask(world, { boardRank: 'a0' });

    await expect(
      computeRank(db, boardBucket(world.statuses.todo), moving, {
        beforeTaskId: 'b',
        afterTaskId: 'c',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each(['beforeTaskId', 'afterTaskId'] as const)(
    'refuses to position a task relative to ITSELF via %s',
    async (key) => {
      const moving = await seedTask(world, { boardRank: 'a0' });

      await expect(
        computeRank(db, boardBucket(world.statuses.todo), moving, { [key]: moving }),
      ).rejects.toBeInstanceOf(ApiError);
    },
  );
});

describe('computeRank â€” a column holding exactly one task', () => {
  it('appends after the only card when no neighbour is named', async () => {
    const only = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a1' });
    const moving = await seedTask(world, { statusId: world.statuses.done, boardRank: 'a0' });

    const computed = await computeRank(db, boardBucket(world.statuses.todo), moving, {});

    expect(computed.rank > 'a1').toBe(true);
    expect(computed.needsRebalance).toBe(false);
    expect(only).toBeTruthy();
  });

  it('prepends when the only card is named as `beforeTaskId`', async () => {
    const only = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a1' });
    const moving = await seedTask(world, { statusId: world.statuses.done, boardRank: 'a0' });

    const computed = await computeRank(db, boardBucket(world.statuses.todo), moving, {
      beforeTaskId: only,
    });

    expect(computed.rank < 'a1').toBe(true);
  });

  it('appends when the only card is named as `afterTaskId` â€” nothing is above it', async () => {
    const only = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a1' });
    const moving = await seedTask(world, { statusId: world.statuses.done, boardRank: 'a0' });

    const computed = await computeRank(db, boardBucket(world.statuses.todo), moving, {
      afterTaskId: only,
    });

    expect(computed.rank > 'a1').toBe(true);
  });

  it('produces the FIRST key of a bucket that is empty once the mover leaves it', async () => {
    // The task being moved is excluded from its own bucket read, so a
    // single-card column re-ranking itself sees an empty tail, not its own key.
    const moving = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a5' });

    const computed = await computeRank(db, boardBucket(world.statuses.todo), moving, {});

    expect(computed.rank).toBe(rankBetween(null, null));
  });
});

describe('computeRank â€” a neighbour that is no longer in the bucket', () => {
  it('answers 409 stale_neighbour for a neighbour in a DIFFERENT column', async () => {
    const elsewhere = await seedTask(world, { statusId: world.statuses.done, boardRank: 'a1' });
    const moving = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a0' });

    await expect(
      computeRank(db, boardBucket(world.statuses.todo), moving, { beforeTaskId: elsewhere }),
    ).rejects.toMatchObject({ status: 409, code: 'stale_neighbour' });
  });

  it('answers 409 for a neighbour that has been soft-deleted', async () => {
    // Soft-deleted rows never take part in ordering, so a drag computed while
    // somebody else deleted the card underneath is a stale read, not a 500.
    const gone = await seedTask(world, {
      statusId: world.statuses.todo,
      boardRank: 'a1',
      deletedAt: new Date(),
    });
    const moving = await seedTask(world, { statusId: world.statuses.done, boardRank: 'a0' });

    await expect(
      computeRank(db, boardBucket(world.statuses.todo), moving, { afterTaskId: gone }),
    ).rejects.toMatchObject({ status: 409, code: 'stale_neighbour' });
  });

  it('answers 409 for a neighbour id that does not exist at all', async () => {
    const moving = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a0' });

    await expect(
      computeRank(db, boardBucket(world.statuses.todo), moving, {
        beforeTaskId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('computeRank â€” the rebalance threshold', () => {
  /** A rank long enough that squeezing a key in below it crosses the trigger. */
  const NARROW = `a0${'0'.repeat(70)}1`;

  it('flags a key that lands ON or past the threshold', async () => {
    await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a0' });
    const narrow = await seedTask(world, { statusId: world.statuses.todo, boardRank: NARROW });
    const moving = await seedTask(world, { statusId: world.statuses.done, boardRank: 'a1' });

    const computed = await computeRank(db, boardBucket(world.statuses.todo), moving, {
      beforeTaskId: narrow,
    });

    expect(computed.rank.length).toBeGreaterThanOrEqual(NEEDS_REBALANCE_LENGTH);
    expect(computed.needsRebalance).toBe(true);
    // Still a correct key, not just a long one: the caller writes it and THEN
    // rebalances, so it has to sort into the right slot in the meantime.
    expect(computed.rank > 'a0').toBe(true);
    expect(computed.rank < NARROW).toBe(true);
  });

  it('does NOT flag an ordinary drop into a healthy column', async () => {
    const first = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a0' });
    await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a2' });
    const moving = await seedTask(world, { statusId: world.statuses.done, boardRank: 'a1' });

    const computed = await computeRank(db, boardBucket(world.statuses.todo), moving, {
      afterTaskId: first,
    });

    expect(computed.needsRebalance).toBe(false);
  });
});

describe('tailRank and appendRank', () => {
  it('read the tail of a bucket and can exclude the task being moved', async () => {
    const first = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a0' });
    const last = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a2' });

    expect(await tailRank(db, boardBucket(world.statuses.todo))).toBe('a2');
    expect(await tailRank(db, boardBucket(world.statuses.todo), last)).toBe('a0');
    expect(await tailRank(db, boardBucket(world.statuses.done))).toBeNull();
    expect(first).toBeTruthy();
  });

  it('appends after the tail, and seeds an empty bucket', async () => {
    expect(await appendRank(db, boardBucket(world.statuses.done))).toBe(rankBetween(null, null));

    await seedTask(world, { statusId: world.statuses.done, boardRank: 'a4' });
    expect((await appendRank(db, boardBucket(world.statuses.done))) > 'a4').toBe(true);
  });

  it('treats the backlog (sprintId null) as its own bucket, separate from a sprint', async () => {
    const sprintId = await seedSprint(world, {});
    await seedTask(world, { sprintId: null, backlogRank: 'a0' });
    await seedTask(world, { sprintId, backlogRank: 'a9' });

    expect(await tailRank(db, backlogBucket(null))).toBe('a0');
    expect(await tailRank(db, backlogBucket(sprintId))).toBe('a9');
  });
});

describe('rebalanceBucket', () => {
  it('returns null for an empty bucket without writing anything', async () => {
    const fresh = await db.transaction((tx) =>
      rebalanceBucket(tx, boardBucket(world.statuses.done), 'anything'),
    );

    expect(fresh).toBeNull();
  });

  it('rewrites a single-task column to the first key and reports it', async () => {
    const only = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a0zzzzzz' });

    const fresh = await db.transaction((tx) =>
      rebalanceBucket(tx, boardBucket(world.statuses.todo), only),
    );

    expect(fresh).toBe(rankBetween(null, null));
    expect(await boardRankOf(only)).toBe(fresh);
  });

  it('PRESERVES the order the rows are already in, shortening every key', async () => {
    const a = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a0' });
    const b = await seedTask(world, {
      statusId: world.statuses.todo,
      boardRank: `a0${'0'.repeat(70)}1`,
    });
    const c = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a1' });

    const fresh = await db.transaction((tx) =>
      rebalanceBucket(tx, boardBucket(world.statuses.todo), b),
    );

    expect(await columnOrder(world.statuses.todo)).toEqual([a, b, c]);
    expect(await boardRankOf(b)).toBe(fresh);
    for (const id of [a, b, c]) {
      expect(needsRebalance(await boardRankOf(id))).toBe(false);
    }
  });

  it('returns null when the caller names no moved task', async () => {
    await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a0' });

    const fresh = await db.transaction((tx) =>
      rebalanceBucket(tx, boardBucket(world.statuses.todo)),
    );

    expect(fresh).toBeNull();
  });

  it('returns null when the named task is not in the bucket it rewrote', async () => {
    await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a0' });
    const elsewhere = await seedTask(world, { statusId: world.statuses.done, boardRank: 'a0' });

    const fresh = await db.transaction((tx) =>
      rebalanceBucket(tx, boardBucket(world.statuses.todo), elsewhere),
    );

    expect(fresh).toBeNull();
  });

  it('leaves soft-deleted rows out of the rewrite entirely', async () => {
    const live = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a1' });
    const gone = await seedTask(world, {
      statusId: world.statuses.todo,
      boardRank: 'a0',
      deletedAt: new Date(),
    });

    await db.transaction((tx) => rebalanceBucket(tx, boardBucket(world.statuses.todo), live));

    expect(await boardRankOf(live)).toBe(rankBetween(null, null));
    // Untouched: a deleted card takes no part in ordering, so renumbering it
    // would be a write nobody asked for on a row nobody reads.
    expect(await boardRankOf(gone)).toBe('a0');
  });

  it('rewrites the BACKLOG rank column when the bucket is a backlog one', async () => {
    const first = await seedTask(world, { sprintId: null, backlogRank: 'a0zzz' });
    const second = await seedTask(world, { sprintId: null, backlogRank: 'a1zzz' });

    const fresh = await db.transaction((tx) => rebalanceBucket(tx, backlogBucket(null), second));

    const rows = await db
      .select({ id: tasks.id, rank: tasks.backlogRank })
      .from(tasks)
      .orderBy(tasks.backlogRank);
    expect(rows.map((row) => row.id)).toEqual([first, second]);
    expect(rows[1]?.rank).toBe(fresh);
    // A backlog rebalance must not have touched the board column.
    expect(needsRebalance(await boardRankOf(first))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// WP5.6 — the bucket lock
// ───────────────────────────────────────────────────────────────────────────

/**
 * THE RANK-COLLISION RACE, staged.
 *
 * Re-reading the neighbours inside the transaction is only enough if the two
 * transactions are serialized. Under READ COMMITTED they are not: both take
 * their snapshot before either commits, both see the same gap, and both compute
 * the SAME key — with no unique constraint on `board_rank` to stop the second
 * one landing. `lockBuckets` is what turns "re-read inside the transaction"
 * into an actual guarantee.
 *
 * These tests drive two REAL concurrent transactions on two pooled connections
 * (`db` has `max: 10`), because the bug does not exist inside one.
 */
describe('lockBuckets — serializing two drops into the same gap', () => {
  it('names a stable, namespaced key per bucket', () => {
    expect(bucketLockKey(boardBucket('s1'))).toBe(`flowboard:rank:board:${world.projectId}:s1`);
    // The backlog is a bucket in its own right and must not collide with a
    // sprint whose id could otherwise interpolate to the same string.
    expect(bucketLockKey(backlogBucket(null))).toBe(
      `flowboard:rank:backlog:${world.projectId}:backlog`,
    );
    expect(bucketLockKey(backlogBucket('sprint-1'))).toBe(
      `flowboard:rank:backlog:${world.projectId}:sprint-1`,
    );
    // Two DIFFERENT buckets never share a key — the whole point of locking the
    // bucket rather than the board.
    expect(bucketLockKey(boardBucket('s1'))).not.toBe(bucketLockKey(boardBucket('s2')));
  });

  /** One drop, exactly as `moveTask` performs it: lock, compute, write. */
  async function drop(bucket: RankBucket, taskId: string, beforeTaskId: string): Promise<string> {
    return db.transaction(async (tx) => {
      await lockBuckets(tx, bucket);
      const computed = await computeRank(tx, bucket, taskId, { beforeTaskId });
      await tx.update(tasks).set({ boardRank: computed.rank }).where(eq(tasks.id, taskId));
      return computed.rank;
    });
  }

  it('gives two simultaneous drops into ONE gap distinct ranks', async () => {
    const anchor = await seedTask(world, { statusId: world.statuses.todo, boardRank: 'a5' });
    const first = await seedTask(world, { statusId: world.statuses.done, boardRank: 'a0' });
    const second = await seedTask(world, { statusId: world.statuses.done, boardRank: 'a1' });
    const bucket = boardBucket(world.statuses.todo);

    // Both name the SAME neighbour, at the same moment: "put me above `anchor`".
    const [rankA, rankB] = await Promise.all([
      db
        .update(tasks)
        .set({ statusId: world.statuses.todo })
        .where(eq(tasks.id, first))
        .then(() => drop(bucket, first, anchor)),
      db
        .update(tasks)
        .set({ statusId: world.statuses.todo })
        .where(eq(tasks.id, second))
        .then(() => drop(bucket, second, anchor)),
    ]);

    expect(rankA).not.toBe(rankB);
    // Both landed above the anchor, and the column has one unambiguous order.
    const order = await columnOrder(world.statuses.todo);
    expect(order).toHaveLength(3);
    expect(order[2]).toBe(anchor);
    expect(new Set(order.slice(0, 2))).toEqual(new Set([first, second]));
  });

  it('survives eight concurrent appends into one empty column', async () => {
    // An append reads the TAIL, which is the case `SELECT … FOR UPDATE` on a
    // boundary row cannot cover at all: an empty bucket has no row to lock.
    const bucket = boardBucket(world.statuses.done);
    const taskIds = await Promise.all(
      Array.from({ length: 8 }, () =>
        seedTask(world, { statusId: world.statuses.done, boardRank: 'a0' }),
      ),
    );

    const ranks = await Promise.all(
      taskIds.map((taskId) =>
        db.transaction(async (tx) => {
          await lockBuckets(tx, bucket);
          const rank = await appendRank(tx, bucket, taskId);
          await tx.update(tasks).set({ boardRank: rank }).where(eq(tasks.id, taskId));
          return rank;
        }),
      ),
    );

    expect(new Set(ranks).size).toBe(8);
  });

  /**
   * A promise plus its resolver, so a test can order two transactions by hand.
   *
   * Racing two `setTimeout`s and hoping the longer one wins is how a
   * concurrency test becomes a flake: which transaction reaches the lock first
   * depends on connection-pool scheduling, not on the hold time. Every test
   * below therefore establishes the order it is asserting about.
   */
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve = (): void => undefined;
    const promise = new Promise<void>((settle) => {
      resolve = settle;
    });
    return { promise, resolve };
  }

  /** How long a blocked transaction is given to (wrongly) get in. */
  const BLOCKED_WINDOW_MS = 250;

  it('makes the second holder WAIT rather than read a stale bucket', async () => {
    // Mutual exclusion IS the property: while A is inside the critical section,
    // B cannot enter it — not "enters later", but does not enter at all.
    const bucket = boardBucket(world.statuses.todo);
    const trace: string[] = [];
    const aInside = deferred();
    const aMayFinish = deferred();

    const first = db.transaction(async (tx) => {
      await lockBuckets(tx, bucket);
      trace.push('a:in');
      aInside.resolve();
      await aMayFinish.promise;
      trace.push('a:out');
    });

    // A provably holds the lock before B is even started.
    await aInside.promise;

    const second = db.transaction(async (tx) => {
      await lockBuckets(tx, bucket);
      trace.push('b:in');
      trace.push('b:out');
    });

    await new Promise((resolve) => setTimeout(resolve, BLOCKED_WINDOW_MS));
    // Blocked, not merely slow: a quarter of a second is orders of magnitude
    // more than the two statements B has to run once it is let through.
    expect(trace).toEqual(['a:in']);

    aMayFinish.resolve();
    await Promise.all([first, second]);

    expect(trace).toEqual(['a:in', 'a:out', 'b:in', 'b:out']);
  });

  it('does NOT serialize two different buckets against each other', async () => {
    // A lock that blocked every drop on the board would be correct and useless.
    const trace: string[] = [];
    const holderInside = deferred();
    const holderMayFinish = deferred();

    const holder = db.transaction(async (tx) => {
      await lockBuckets(tx, boardBucket(world.statuses.todo));
      holderInside.resolve();
      await holderMayFinish.promise;
      trace.push('todo:out');
    });
    await holderInside.promise;

    // A different column, while `todo` is still locked: straight through.
    await db.transaction(async (tx) => {
      await lockBuckets(tx, boardBucket(world.statuses.done));
      trace.push('done:out');
    });
    // And so is the BACKLOG bucket, which shares a project with both of them.
    await db.transaction(async (tx) => {
      await lockBuckets(tx, backlogBucket(null));
      trace.push('backlog:out');
    });

    expect(trace).toEqual(['done:out', 'backlog:out']);

    holderMayFinish.resolve();
    await holder;
    expect(trace).toEqual(['done:out', 'backlog:out', 'todo:out']);
  });

  it('takes several buckets in one sorted acquisition, so a create cannot deadlock', async () => {
    // `createTask` locks a board bucket AND a backlog bucket; `patchTask` can
    // too. Two of those running in opposite orders would deadlock, so
    // `lockBuckets` sorts — and taking the same pair twice, from both argument
    // orders, must simply work.
    const board = boardBucket(world.statuses.todo);
    const backlog = backlogBucket(null);

    await expect(
      Promise.all([
        db.transaction((tx) => lockBuckets(tx, board, backlog)),
        db.transaction((tx) => lockBuckets(tx, backlog, board)),
      ]),
    ).resolves.toHaveLength(2);
  });

  it('releases at commit, so a later transaction is not blocked forever', async () => {
    const bucket = backlogBucket(null);
    await db.transaction((tx) => lockBuckets(tx, bucket));
    await expect(db.transaction((tx) => lockBuckets(tx, bucket))).resolves.toBeUndefined();
  });

  it('releases on ROLLBACK too — a thrown move must not wedge the column', async () => {
    const bucket = backlogBucket(null);
    await expect(
      db.transaction(async (tx) => {
        await lockBuckets(tx, bucket);
        throw new ApiError(409, 'stale_neighbour', 'boom');
      }),
    ).rejects.toBeInstanceOf(ApiError);

    await expect(db.transaction((tx) => lockBuckets(tx, bucket))).resolves.toBeUndefined();
  });
});
