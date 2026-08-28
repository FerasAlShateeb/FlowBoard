/**
 * Which sprint the dashboard opens on.
 *
 * THE RULE: the ACTIVE sprint if there is one, otherwise the MOST RECENTLY
 * COMPLETED one, otherwise nothing. A project has at most one active sprint
 * (enforced by a partial unique index, not by hope), and while it is running it
 * is the only sprint anyone opens a burndown to look at. Once it completes the
 * interesting question becomes "how did the last one go", so the freshly
 * completed sprint takes over. `planned` sprints are never chosen: they have no
 * `committedPoints` stamp yet, so their burndown is a flat line at zero.
 *
 * Pure module — no React — so the choice is unit-testable without a query
 * client, and so the picker component stays a dumb `<Select>`.
 */
import type { Sprint } from '@flowboard/shared';

/**
 * The instant a completed sprint is ranked by.
 *
 * `completedAt` is the actual stamp and the honest answer. `endDate` is the
 * PLANNED end and only a fallback — a sprint completed late would otherwise
 * sort by a date it never honoured. `createdAt` catches the (contract-legal but
 * odd) row with neither, so the comparator is total and the sort never depends
 * on input order.
 */
function completionRank(sprint: Sprint): number {
  const stamp = sprint.completedAt ?? sprint.endDate ?? sprint.createdAt;
  const time = Date.parse(stamp);
  return Number.isNaN(time) ? 0 : time;
}

/** Completed sprints, most recently finished first. */
export function completedSprintsNewestFirst(sprints: readonly Sprint[]): Sprint[] {
  return sprints
    .filter((sprint) => sprint.state === 'completed')
    .sort((left, right) => completionRank(right) - completionRank(left));
}

/** The sprint the picker should start on, or `null` when there is none. */
export function pickDefaultSprint(sprints: readonly Sprint[]): Sprint | null {
  const active = sprints.find((sprint) => sprint.state === 'active');
  if (active) return active;
  return completedSprintsNewestFirst(sprints)[0] ?? null;
}

/** Convenience wrapper — the id is what the report hooks actually take. */
export function pickDefaultSprintId(sprints: readonly Sprint[] | undefined): string | null {
  if (!sprints || sprints.length === 0) return null;
  return pickDefaultSprint(sprints)?.id ?? null;
}

/**
 * The picker's option order: active first, then completed newest-first, then
 * planned — the same "most likely to be wanted" ordering the default follows,
 * so the chosen entry is almost always the one at the top of the open list.
 */
export function orderSprintsForPicker(sprints: readonly Sprint[]): Sprint[] {
  const active = sprints.filter((sprint) => sprint.state === 'active');
  const completed = completedSprintsNewestFirst(sprints);
  const planned = sprints.filter((sprint) => sprint.state === 'planned');
  return [...active, ...completed, ...planned];
}
