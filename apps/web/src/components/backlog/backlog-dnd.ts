import type { BacklogRankIntent, SprintBucket } from '@/lib/board-cache';

/**
 * The backlog drag, as a PURE MAPPING from "what dnd-kit reported" to "what
 * `useRankTask` takes".
 *
 * WHY IT IS A FUNCTION AND NOT A HANDLER. `onDragEnd` hands back two opaque
 * ids — the thing that moved and the thing it was dropped on — and turning that
 * pair into `{taskId, fromSprintId, toSprintId, toIndex}` is the one piece of
 * this view that can be silently, invisibly wrong: an off-by-one puts the card
 * one row from where it was dropped, which nobody notices until a sprint is
 * planned in the wrong order. Extracted here, it is asserted directly in
 * `backlog-dnd.test.ts` without a DOM, a pointer, or a query client.
 *
 * ── The index convention ────────────────────────────────────────────────────
 * `toIndex` is the destination index counted with the dragged row ALREADY
 * LIFTED OUT (that is what `planBacklogRank` documents and expects). dnd-kit's
 * sortable reports the index of the row you are hovering IN ITS OWN, FULL list —
 * and those two numbers are the same in both directions:
 *
 *   [A B C D], drag A onto C → full index of C is 2
 *              lifted list [B C D], insert at 2 → [B C A D]   ✓ arrayMove(0→2)
 *   [A B C D], drag D onto B → full index of B is 1
 *              lifted list [A B C], insert at 1 → [A D B C]   ✓ arrayMove(3→1)
 *
 * So no compensation is needed: the over-row's index in the target bucket's
 * cached list IS the destination index. For a CROSS-bucket drop the dragged row
 * is not in the target list at all, so its index is the insertion point
 * directly.
 *
 * ── Bucket droppables ───────────────────────────────────────────────────────
 * A section registers one droppable of its own ({@link bucketDroppableId}) for
 * the cases where there is no row to aim at: a COLLAPSED section (its body is
 * not rendered, but it must still accept work), an EMPTY bucket, and the strip
 * below the last row. Dropping on any of those means "append", which is spelled
 * as the target bucket's length with the dragged row removed.
 *
 * ── Why the buckets come from the CACHE, not from the DOM ───────────────────
 * The backlog section filters its rows by a text box, so what is rendered is a
 * subset of what is cached. Ranks are computed from the cached — complete —
 * lists, so dropping between two visible rows that have a hidden row between
 * them still produces a rank that lands exactly where the pointer said.
 */

/** The backlog proper, in a droppable id. Sprints use their uuid. */
export const BACKLOG_BUCKET_TOKEN = 'backlog';

/** `bucket:<sprintId|backlog>` — a section's own droppable. */
export function bucketDroppableId(sprintId: SprintBucket): string {
  return `bucket:${sprintId ?? BACKLOG_BUCKET_TOKEN}`;
}

/**
 * Reads a bucket droppable id back. Returns `undefined` — not `null` — for
 * anything that is not one, because `null` is a MEANINGFUL bucket here (the
 * backlog) and conflating the two is exactly the bug this file exists to avoid.
 */
export function parseBucketDroppableId(id: string): SprintBucket | undefined {
  if (!id.startsWith('bucket:')) return undefined;
  const token = id.slice('bucket:'.length);
  return token === BACKLOG_BUCKET_TOKEN ? null : token;
}

/** One bucket's cached order, as the mapping needs it. */
export interface BucketOrder {
  sprintId: SprintBucket;
  /** Every task id in the bucket, in `backlogRank` order — filtering excluded. */
  taskIds: readonly string[];
}

/** What `onDragEnd` knows, reduced to plain data. */
export interface DragEndInput {
  /** The dragged row's task id (`active.id`). */
  activeId: string;
  /** A task id, a bucket droppable id, or `null` when dropped on nothing. */
  overId: string | null;
  buckets: readonly BucketOrder[];
}

/**
 * Maps a finished drag onto a rank intent, or `null` when the drag is a no-op
 * (dropped outside, dropped on itself, or the row is no longer in any cached
 * bucket — a stale drag against an invalidated cache, which must not throw
 * inside a drag handler).
 */
export function resolveBacklogDragEnd(input: DragEndInput): BacklogRankIntent | null {
  const { activeId, overId, buckets } = input;
  if (overId === null || overId === activeId) return null;

  const source = buckets.find((bucket) => bucket.taskIds.includes(activeId));
  if (!source) return null;

  const asBucket = parseBucketDroppableId(overId);

  if (asBucket !== undefined) {
    // Dropped on a section itself — collapsed header, empty body, or the strip
    // under the last row. All three mean "the end of this bucket".
    const target = buckets.find((bucket) => bucket.sprintId === asBucket);
    if (!target) return null;
    const lifted = target.taskIds.filter((id) => id !== activeId);
    return {
      taskId: activeId,
      fromSprintId: source.sprintId,
      toSprintId: asBucket,
      toIndex: lifted.length,
    };
  }

  // Dropped on a row: land where that row is.
  const target = buckets.find((bucket) => bucket.taskIds.includes(overId));
  if (!target) return null;

  return {
    taskId: activeId,
    fromSprintId: source.sprintId,
    toSprintId: target.sprintId,
    toIndex: target.taskIds.indexOf(overId),
  };
}

/**
 * The "Move to →" menu's index: the end of whatever bucket was picked.
 *
 * `planRank` clamps, so a number past the end is the honest way to say "append"
 * without the caller having to read the destination's length first — which it
 * cannot do anyway, since a collapsed section's bucket may not be cached yet.
 */
export const APPEND_INDEX = Number.MAX_SAFE_INTEGER;
