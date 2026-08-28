import type { Status, TaskSummary } from '@flowboard/shared';

/**
 * The backlog's arithmetic — story points and counts per bucket, as PURE
 * FUNCTIONS over plain rows.
 *
 * WHY IT IS COMPUTED ON THE CLIENT AT ALL. A sprint row carries
 * `committedPoints` and `completedPoints`, but both are STAMPS: the first is
 * written when the sprint starts, the second when it completes, and neither
 * moves while someone is dragging work in and out of a planned sprint. The
 * chips in a section header have to answer "what is in here RIGHT NOW", which is
 * a question only the bucket rows can answer — and those rows are already in the
 * cache, so the alternative would be a roll-up endpoint refetched on every drop.
 *
 * FRACTIONAL POINTS ARE THE REASON THE ROUNDING EXISTS. The contract allows
 * halves (`storyPointsSchema` — 0.5 is a legitimate estimate), and three of them
 * summed in binary floating point give `1.5000000000000002`. Rounding to two
 * decimals after each addition keeps the chip reading `1.5` without pretending
 * points are integers.
 */

/** What one section header's chips render. */
export interface PointsSummary {
  /** Rows in the bucket, estimated or not. */
  count: number;
  /** Rows sitting in a `done`-category status. */
  doneCount: number;
  /** Sum of story points across the bucket; unestimated rows contribute 0. */
  totalPoints: number;
  /** Sum of story points on the DONE rows only. */
  donePoints: number;
}

/** Two decimals — enough for halves and quarters, never enough for FP drift. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The set of status ids that mean "finished" for this project.
 *
 * The CATEGORY is the authority, never the status name: a project may call its
 * final column "Shipped" or "بحاجة إلى نشر", and `done` is the only thing that
 * stamps `resolved_at` and closes a burndown.
 */
export function doneStatusIds(statuses: readonly Status[]): Set<string> {
  const ids = new Set<string>();
  for (const status of statuses) {
    if (status.category === 'done') ids.add(status.id);
  }
  return ids;
}

/** Counts and sums one bucket. */
export function summarizePoints(
  tasks: readonly TaskSummary[],
  doneIds: ReadonlySet<string>,
): PointsSummary {
  let count = 0;
  let doneCount = 0;
  let totalPoints = 0;
  let donePoints = 0;

  for (const task of tasks) {
    count += 1;
    // `null` is "unestimated", which is NOT the same as zero points — but it
    // contributes nothing to a sum either way, and rendering it as a separate
    // "unestimated" figure is the reports view's job, not a header chip's.
    const points = task.storyPoints ?? 0;
    totalPoints = round(totalPoints + points);

    if (doneIds.has(task.statusId)) {
      doneCount += 1;
      donePoints = round(donePoints + points);
    }
  }

  return { count, doneCount, totalPoints, donePoints };
}

/**
 * Points as a string — the app-wide one.
 *
 * This file used to carry its own copy capped at ONE fraction digit while the
 * board's allowed two, so `0.25` rendered as `0.3` on a backlog chip and `0.25`
 * on the card beside it. One definition, two digits (`lib/format.ts`).
 */
export { formatPoints } from '@/lib/format';
