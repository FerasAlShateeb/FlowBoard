/**
 * The headline numbers behind each chart's screen-reader sentence — and, as a
 * side effect, its empty state.
 *
 * WHY ONE MODULE FOR BOTH. A chart is empty exactly when it has no headline to
 * report, so `xHeadline(...) === null` is the single condition the card branches
 * on. Deriving "is this empty?" separately from "what does it say?" is how a
 * dashboard ends up announcing "0 points remain" over a plot that drew nothing.
 *
 * EVERY FUNCTION IS PURE and takes the parsed report payload as-is. The
 * formatting (Latin digits, locale) happens in the component, because the
 * sentence is assembled by i18next interpolation — these return NUMBERS.
 *
 * `noUncheckedIndexedAccess` is on, which is why the "last element" reads all
 * go through an explicit `at(-1)` guard rather than `array[array.length - 1]`.
 */
import type {
  BurndownDay,
  BurnupDay,
  CumulativeFlowDay,
  CycleTimeReport,
  VelocitySprint,
  WorkloadAssignee,
} from '@flowboard/shared';

export interface BurndownHeadline {
  days: number;
  remaining: number;
  ideal: number;
}

/**
 * The LAST day is the headline, not the first: "how are we doing?" is a
 * question about now. `null` when the sprint has no day buckets at all.
 */
export function burndownHeadline(days: readonly BurndownDay[]): BurndownHeadline | null {
  const last = days.at(-1);
  if (!last) return null;
  return { days: days.length, remaining: last.remainingPoints, ideal: last.idealPoints };
}

export interface BurnupHeadline {
  days: number;
  completed: number;
  scope: number;
}

export function burnupHeadline(days: readonly BurnupDay[]): BurnupHeadline | null {
  const last = days.at(-1);
  if (!last) return null;
  return { days: days.length, completed: last.completedPoints, scope: last.scopePoints };
}

export interface CumulativeFlowHeadline {
  days: number;
  todo: number;
  inProgress: number;
  done: number;
}

/**
 * `null` for an empty window AND for a window in which every bucket is zero —
 * a stacked area chart of nothing is a blank rectangle with axes, which reads
 * as a broken chart rather than as "no flow here".
 */
export function cumulativeFlowHeadline(
  days: readonly CumulativeFlowDay[],
): CumulativeFlowHeadline | null {
  const last = days.at(-1);
  if (!last) return null;

  const anyWork = days.some(
    (day) => day.counts.todo + day.counts.in_progress + day.counts.done > 0,
  );
  if (!anyWork) return null;

  return {
    days: days.length,
    todo: last.counts.todo,
    inProgress: last.counts.in_progress,
    done: last.counts.done,
  };
}

export interface VelocityHeadline {
  sprints: number;
  average: number;
  last: number;
}

/**
 * The average is over COMPLETED points, which is the only half of the pair that
 * predicts anything: what a team committed to is a plan, what it finished is a
 * capability.
 */
export function velocityHeadline(sprints: readonly VelocitySprint[]): VelocityHeadline | null {
  const last = sprints.at(-1);
  if (!last) return null;

  const total = sprints.reduce((sum, sprint) => sum + sprint.completedPoints, 0);
  return {
    sprints: sprints.length,
    average: total / sprints.length,
    last: last.completedPoints,
  };
}

/** The average completed points — the value the optional reference line sits at. */
export function velocityAverage(sprints: readonly VelocitySprint[]): number | null {
  if (sprints.length === 0) return null;
  return sprints.reduce((sum, sprint) => sum + sprint.completedPoints, 0) / sprints.length;
}

export interface CycleTimeHeadline {
  tasks: number;
  p50: number | null;
  p90: number | null;
}

/**
 * The percentiles come from the SERVER, computed over the same rows returned in
 * `tasks` — recomputing them here would let the scatter and its reference lines
 * disagree (see `cycleTimeReportSchema`). They are `null` when nothing resolved,
 * which the sentence renders as an em dash.
 */
export function cycleTimeHeadline(report: CycleTimeReport): CycleTimeHeadline | null {
  if (report.tasks.length === 0) return null;
  return { tasks: report.tasks.length, p50: report.p50, p90: report.p90 };
}

export interface WorkloadHeadline {
  people: number;
  tasks: number;
  points: number;
}

export function workloadHeadline(assignees: readonly WorkloadAssignee[]): WorkloadHeadline | null {
  const rows = workloadRows(assignees);
  if (rows.length === 0) return null;
  return {
    people: rows.length,
    tasks: rows.reduce((sum, row) => sum + row.openTasks, 0),
    points: rows.reduce((sum, row) => sum + row.openPoints, 0),
  };
}

/**
 * The rows the chart actually draws: everyone carrying open work, heaviest
 * first.
 *
 * The empty filter matters because the endpoint can legitimately answer with a
 * row whose counts are both zero — a member whose last ticket closed between
 * two refetches — and a zero-length bar under a name reads as a rendering bug
 * rather than as "nothing assigned".
 */
export function workloadRows(assignees: readonly WorkloadAssignee[]): WorkloadAssignee[] {
  return sortWorkload(assignees.filter((row) => row.openTasks > 0 || row.openPoints > 0));
}

/**
 * What the bar lengths are proportional to, and the value that fills the track.
 *
 * POINTS BY DEFAULT — story points are the load. But a project that has not
 * estimated anything yet reports every `openPoints` as 0, and scaling by that
 * draws six empty tracks; falling back to the task COUNT keeps the chart
 * meaningful instead of technically correct and useless. The caller labels the
 * axis from `metric`, so the reader is told which one they are looking at.
 */
export function workloadScale(rows: readonly WorkloadAssignee[]): {
  metric: 'points' | 'tasks';
  max: number;
} {
  const maxPoints = rows.reduce((top, row) => Math.max(top, row.openPoints), 0);
  if (maxPoints > 0) return { metric: 'points', max: maxPoints };
  const maxTasks = rows.reduce((top, row) => Math.max(top, row.openTasks), 0);
  return { metric: 'tasks', max: maxTasks };
}

/**
 * Workload rows, heaviest first, with the unassigned bucket pinned LAST.
 *
 * Two rules, both deliberate:
 *
 *   1. **Sort by open POINTS, tie-broken by task count.** The question the
 *      chart answers is "who is overloaded", and five three-point tasks is more
 *      load than nine one-pointers.
 *   2. **Unassigned sinks to the bottom regardless of size.** It is not a
 *      person and cannot be overloaded; a fat unassigned bar at the top of the
 *      list buries the humans the reader came to look at. It is still SHOWN —
 *      an invisible pile of unowned work is worse than an ugly one.
 *
 * Rows with equal weight keep their server order (the sort is stable), so a
 * refetch that changes nothing never reshuffles the chart.
 */
export function sortWorkload(assignees: readonly WorkloadAssignee[]): WorkloadAssignee[] {
  return [...assignees].sort((left, right) => {
    if (!left.user !== !right.user) return left.user ? -1 : 1;
    if (right.openPoints !== left.openPoints) return right.openPoints - left.openPoints;
    return right.openTasks - left.openTasks;
  });
}
