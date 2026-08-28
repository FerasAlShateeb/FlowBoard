/**
 * Authoritative fractional-rank computation and the in-transaction rebalance.
 *
 * THE RULE (plan → "Ordering strategy"): a client sends the DESTINATION
 * NEIGHBOURS of a drop, never a final key. This module re-reads those
 * neighbours' ranks **inside the move transaction** and generates the key from
 * what it actually finds, so two people dropping into the same gap at the same
 * moment cannot produce the same string — the second one reads the first one's
 * committed row and lands after it.
 *
 * …PROVIDED THE TWO TRANSACTIONS ARE SERIALIZED, which is what
 * {@link lockBuckets} is for. Re-reading inside the transaction is necessary but
 * not sufficient: FlowBoard runs at Postgres' default READ COMMITTED, where two
 * concurrent drops into the same gap both take their snapshot before either
 * commits, both see the same neighbours, and both generate the SAME key. There
 * is no unique constraint on `board_rank` / `backlog_rank` to catch it (a
 * rebalance rewrites a whole column, so a unique index would have to be
 * DEFERRABLE and every rebalance would have to order its updates), so the
 * duplicate simply lands and the column's order becomes ambiguous — resolved
 * arbitrarily by the `id` tie-break, differently on different clients.
 *
 * Every transaction that COMPUTES a rank therefore takes a transaction-scoped
 * advisory lock on its destination bucket first. See {@link lockBuckets}.
 *
 * Two independent orderings share one implementation, discriminated by
 * {@link RankBucket}:
 *   - `board`   — `tasks.board_rank` within `(project_id, status_id)`;
 *   - `backlog` — `tasks.backlog_rank` within `(project_id, sprint_id)`,
 *                 where `sprintId: null` is the backlog itself.
 *
 * REBALANCE. Every insert into the same gap makes the key at least one
 * character longer, so a pathological drag loop grows keys without bound. When
 * a generated key crosses `NEEDS_REBALANCE_LENGTH` (60), the caller applies the
 * move and then calls {@link rebalanceBucket}, which rewrites EVERY rank in
 * that bucket with `initialRanks()` in the same transaction and answers
 * `rebalanced: true` — the signal that tells other clients their cached ranks
 * are stale and the board must be refetched rather than spliced.
 */
import { and, asc, desc, eq, gt, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import { initialRanks, needsRebalance, rankBetween } from '@flowboard/shared';

import { tasks, type Db, type Tx } from '../db';
import { ApiError } from './api-error';

/** Which of the two orderings a computation addresses, plus its bucket key. */
export type RankBucket =
  | { kind: 'board'; projectId: string; statusId: string }
  | { kind: 'backlog'; projectId: string; sprintId: string | null };

/** The neighbours a client sent with its drop. At most one may be present. */
export interface RankNeighbours {
  /** The task the moved task should end up ABOVE (immediately before). */
  beforeTaskId?: string | undefined;
  /** The task the moved task should end up BELOW (immediately after). */
  afterTaskId?: string | undefined;
}

/** A computed key plus whether writing it should trigger a bucket rewrite. */
export interface ComputedRank {
  rank: string;
  needsRebalance: boolean;
}

type Executor = Db | Tx;

/** The rank column this bucket orders by. */
function rankColumn(bucket: RankBucket) {
  return bucket.kind === 'board' ? tasks.boardRank : tasks.backlogRank;
}

/** The physical column name, for the one raw statement the rebalance needs. */
function rankColumnName(bucket: RankBucket): 'board_rank' | 'backlog_rank' {
  return bucket.kind === 'board' ? 'board_rank' : 'backlog_rank';
}

/** Every live task in the bucket. Soft-deleted rows never take part in ordering. */
export function bucketCondition(bucket: RankBucket): SQL {
  const live = and(eq(tasks.projectId, bucket.projectId), isNull(tasks.deletedAt));
  if (bucket.kind === 'board') {
    return and(live, eq(tasks.statusId, bucket.statusId)) as SQL;
  }
  return and(
    live,
    bucket.sprintId === null ? isNull(tasks.sprintId) : eq(tasks.sprintId, bucket.sprintId),
  ) as SQL;
}

/**
 * The advisory-lock key for one bucket. Stable, human-readable, and namespaced.
 *
 * The `flowboard:rank:` prefix is not decoration: `pg_advisory_xact_lock` shares
 * ONE key space across the whole database, so an unprefixed key would be free to
 * collide with any other advisory lock a future subsystem takes out.
 */
export function bucketLockKey(bucket: RankBucket): string {
  if (bucket.kind === 'board') {
    return `flowboard:rank:board:${bucket.projectId}:${bucket.statusId}`;
  }
  // `sprintId: null` IS a bucket (the backlog), and it needs a key of its own —
  // interpolating `null` would give it the literal string 'null', which is fine
  // but says nothing; naming it is what makes a lock trace readable.
  return `flowboard:rank:backlog:${bucket.projectId}:${bucket.sprintId ?? 'backlog'}`;
}

/**
 * Serialize every rank computation on these buckets, for the rest of the
 * transaction.
 *
 * WHY AN ADVISORY LOCK AND NOT `SELECT … FOR UPDATE` on the boundary rows. The
 * gap a drop lands in is delimited by rows, and the interesting cases have none:
 * an EMPTY column has no row to lock, and an append past the tail races a
 * concurrent append that is reading the same tail — locking the tail row helps
 * only until the other transaction inserts a new one past it. The thing that
 * needs mutual exclusion is the BUCKET, which is not a row, so the lock has to
 * name it directly.
 *
 * `pg_advisory_xact_lock` releases at COMMIT or ROLLBACK — never explicitly,
 * never leaked by an early `throw` — and it blocks rather than failing, so the
 * second dropper waits, then reads the first one's committed row and lands
 * after it. That is exactly the serialization {@link computeRank}'s re-read
 * already assumed it had.
 *
 * ── LOCK ORDER ─────────────────────────────────────────────────────────────
 * The keys are DEDUPED AND SORTED before they are taken, because two call sites
 * lock two buckets at once (a create writes both a board rank and a backlog
 * rank; a patch can change status and sprint in one request). A consistent
 * global order across every caller is what makes a deadlock between them
 * impossible, and sorting is the cheapest way to guarantee one that no future
 * caller can forget.
 *
 * Callers must take these locks BEFORE their first row write, so that no
 * transaction ever holds a row lock while waiting for a bucket lock.
 */
export async function lockBuckets(tx: Tx, ...buckets: readonly RankBucket[]): Promise<void> {
  const keys = [...new Set(buckets.map(bucketLockKey))].sort();
  for (const key of keys) {
    // One statement per key rather than one statement with N calls: the
    // evaluation order of a SELECT list is not defined, and the sorted order IS
    // the deadlock-freedom argument.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
  }
}

/** Read one neighbour's CURRENT rank, asserting it really sits in this bucket. */
async function neighbourRank(
  executor: Executor,
  bucket: RankBucket,
  neighbourId: string,
): Promise<string> {
  const column = rankColumn(bucket);
  const [row] = await executor
    .select({ rank: column })
    .from(tasks)
    .where(and(eq(tasks.id, neighbourId), bucketCondition(bucket)))
    .limit(1);
  if (!row) {
    // Either the neighbour vanished or it is not in the column the client
    // thought it was — both mean the drag was computed against a stale board.
    throw new ApiError(409, 'stale_neighbour', 'The neighbouring task is no longer in that list');
  }
  return row.rank;
}

/** Greatest rank strictly below `rank`, ignoring the task being moved. */
async function rankBelow(
  executor: Executor,
  bucket: RankBucket,
  rank: string,
  movingTaskId: string,
): Promise<string | null> {
  const column = rankColumn(bucket);
  const [row] = await executor
    .select({ rank: column })
    .from(tasks)
    .where(and(bucketCondition(bucket), ne(tasks.id, movingTaskId), lt(column, rank)))
    .orderBy(desc(column))
    .limit(1);
  return row?.rank ?? null;
}

/** Least rank strictly above `rank`, ignoring the task being moved. */
async function rankAbove(
  executor: Executor,
  bucket: RankBucket,
  rank: string,
  movingTaskId: string,
): Promise<string | null> {
  const column = rankColumn(bucket);
  const [row] = await executor
    .select({ rank: column })
    .from(tasks)
    .where(and(bucketCondition(bucket), ne(tasks.id, movingTaskId), gt(column, rank)))
    .orderBy(asc(column))
    .limit(1);
  return row?.rank ?? null;
}

/** The bucket's last rank, ignoring the task being moved. `null` when empty. */
export async function tailRank(
  executor: Executor,
  bucket: RankBucket,
  excludeTaskId?: string,
): Promise<string | null> {
  const column = rankColumn(bucket);
  const condition =
    excludeTaskId === undefined
      ? bucketCondition(bucket)
      : (and(bucketCondition(bucket), ne(tasks.id, excludeTaskId)) as SQL);
  const [row] = await executor
    .select({ rank: column })
    .from(tasks)
    .where(condition)
    .orderBy(desc(column))
    .limit(1);
  return row?.rank ?? null;
}

/**
 * `count` keys that append, in order, after `tail`.
 *
 * The bulk-move counterpart of {@link appendRank}: emptying a sprint into the
 * backlog has to give every task its own key, and generating them from the
 * previous one keeps them strictly ascending without re-reading the bucket.
 */
export function sequentialRanksAfter(tail: string | null, count: number): string[] {
  const ranks: string[] = [];
  let previous = tail;
  for (let index = 0; index < count; index += 1) {
    previous = rankBetween(previous, null);
    ranks.push(previous);
  }
  return ranks;
}

/** A key that appends to the end of a bucket. The create path's only rank need. */
export async function appendRank(
  executor: Executor,
  bucket: RankBucket,
  excludeTaskId?: string,
): Promise<string> {
  return rankBetween(await tailRank(executor, bucket, excludeTaskId), null);
}

/**
 * The authoritative key for a drop.
 *
 * Both neighbours absent means "append". `beforeTaskId` and `afterTaskId` are
 * mutually exclusive (the shared schemas already refuse both), and whichever is
 * given is re-read here rather than trusted from the request.
 *
 * `rankBetween` throws only when the two bounds are IDENTICAL — a stale read,
 * since ranks are unique within a bucket. That is recovered rather than
 * surfaced: the task is appended and the bucket is rebalanced, which is exactly
 * what the degenerate case needs anyway.
 */
export async function computeRank(
  executor: Executor,
  bucket: RankBucket,
  movingTaskId: string,
  neighbours: RankNeighbours,
): Promise<ComputedRank> {
  const { beforeTaskId, afterTaskId } = neighbours;
  if (beforeTaskId !== undefined && afterTaskId !== undefined) {
    throw ApiError.badRequest('Provide at most one of beforeTaskId / afterTaskId');
  }
  if (beforeTaskId === movingTaskId || afterTaskId === movingTaskId) {
    throw ApiError.badRequest('A task cannot be positioned relative to itself');
  }

  // `previous` is assigned by every branch below; `next` keeps its `null` for
  // the append case, where there is nothing above the moved task.
  let previous: string | null;
  let next: string | null = null;

  if (beforeTaskId !== undefined) {
    next = await neighbourRank(executor, bucket, beforeTaskId);
    previous = await rankBelow(executor, bucket, next, movingTaskId);
  } else if (afterTaskId !== undefined) {
    previous = await neighbourRank(executor, bucket, afterTaskId);
    next = await rankAbove(executor, bucket, previous, movingTaskId);
  } else {
    previous = await tailRank(executor, bucket, movingTaskId);
  }

  try {
    const rank = rankBetween(previous, next);
    return { rank, needsRebalance: needsRebalance(rank) };
  } catch {
    // Identical bounds: the read was stale. Park the task at the end and let
    // the rebalance below re-derive the whole order.
    return { rank: rankBetween(previous, null), needsRebalance: true };
  }
}

/**
 * Rewrite every rank in a bucket, preserving the order the rows are ALREADY in.
 *
 * Call this AFTER the move has been applied, inside the same transaction: the
 * over-long key the move just wrote still sorts into the correct position, so
 * re-reading the bucket by rank yields the intended final order and this only
 * has to renumber it.
 *
 * @returns the moved task's fresh rank, or `null` when the bucket is empty.
 */
export async function rebalanceBucket(
  tx: Tx,
  bucket: RankBucket,
  movedTaskId?: string,
): Promise<string | null> {
  const column = rankColumn(bucket);
  const rows = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(bucketCondition(bucket))
    // `id` breaks ties so the rewrite is deterministic even if two rows somehow
    // share a key — otherwise a rebalance could reorder a board at random.
    .orderBy(asc(column), asc(tasks.id));

  if (rows.length === 0) return null;

  const ranks = initialRanks(rows.length);
  const pairs = rows.map((row, index) => {
    const rank = ranks[index];
    if (rank === undefined) throw ApiError.internal('Rebalance produced too few ranks');
    return { id: row.id, rank };
  });

  // One statement rather than N updates: a rebalance can touch a whole column.
  await tx.execute(sql`
    UPDATE ${tasks} SET ${sql.raw(rankColumnName(bucket))} = v.rank
    FROM (VALUES ${sql.join(
      pairs.map((pair) => sql`(${pair.id}::uuid, ${pair.rank}::text)`),
      sql`, `,
    )}) AS v(id, rank)
    WHERE ${tasks.id} = v.id
  `);

  if (movedTaskId === undefined) return null;
  return pairs.find((pair) => pair.id === movedTaskId)?.rank ?? null;
}
