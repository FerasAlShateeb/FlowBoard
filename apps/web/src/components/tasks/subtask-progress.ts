import type { Status, TaskSummary } from '@flowboard/shared';

/**
 * The subtask checklist's arithmetic, extracted as a pure function.
 *
 * WHY IT IS NOT INLINE IN THE LIST. "How done is this?" has three edge cases
 * that are each a plausible off-by-one — an empty list (which must not divide by
 * zero), a subtask sitting in a status the project has since deleted, and the
 * rounding of the percentage — and none of them is reachable from a component
 * test without rendering the whole sheet. As a function they are three
 * assertions.
 *
 * DONE MEANS `category === 'done'`, never a status NAME. Statuses are per-project
 * data: a team may call theirs "Shipped", "Released" or "منجز", and only the
 * category is the closed set the product reasons about (`workflow.schema.ts`).
 */

export interface SubtaskProgress {
  /** Subtasks in a `done`-category status. */
  done: number;
  total: number;
  /** 0–100, rounded. `0` for an empty list, which is what the bar renders. */
  percent: number;
  /** True only when there is at least one subtask and all of them are done. */
  complete: boolean;
}

/**
 * Counts how many of `subtasks` sit in a done-category column.
 *
 * A subtask whose `statusId` is not in `statuses` counts as NOT done — the
 * honest reading of "we cannot tell", and the safe one: over-reporting progress
 * is the failure people act on.
 */
export function subtaskProgress(
  subtasks: readonly TaskSummary[],
  statuses: readonly Status[],
): SubtaskProgress {
  const doneStatusIds = new Set(
    statuses.filter((status) => status.category === 'done').map((status) => status.id),
  );

  const total = subtasks.length;
  const done = subtasks.reduce(
    (count, subtask) => (doneStatusIds.has(subtask.statusId) ? count + 1 : count),
    0,
  );

  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    complete: total > 0 && done === total,
  };
}
