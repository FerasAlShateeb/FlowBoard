import type { StatusCategory, TaskSummary } from '@flowboard/shared';

import {
  compareDayKeys,
  diffDayKeys,
  type DayKey,
  type DayRange,
} from '@/components/calendar/calendar-dates';

/**
 * The calendar's layout engine: which tasks are on screen, and where their bars
 * go.
 *
 * Everything here is PURE — no React, no dates beyond {@link DayKey} strings,
 * no knowledge of pixels. The month and week views differ only in how many
 * lanes they show and how big a lane is; both call {@link layoutWeek} once per
 * rendered week and place what comes back with CSS grid.
 *
 * ═══ THE LANE PROBLEM ══════════════════════════════════════════════════════
 *
 * A task with a start AND a due date is a BAR across days, not a chip on one.
 * Two bars that overlap in time cannot share a row, so each week's bars have to
 * be stacked into lanes — the same interval-graph colouring a timetable does.
 * Doing it per week (rather than once for the whole month) is what lets a bar
 * that crosses a Saturday be drawn as two segments, one per row, and it keeps
 * lane numbers small: a task that ends on Tuesday frees its lane for the rest
 * of that week instead of reserving it all month.
 *
 * The algorithm is greedy first-fit over spans sorted by (start, longest,
 * id) — optimal for interval colouring, and the ordering is what makes it
 * STABLE: the same set of tasks always produces the same lanes, so a refetch
 * that returns rows in a different order does not reshuffle the grid.
 */

/**
 * A task's occupancy of the calendar, normalized to a closed day interval.
 *
 * `startKey === endKey` is the single-day case, which covers "due date only"
 * (the overwhelming majority of tasks) as well as a real one-day span. Callers
 * therefore never branch on which kind of date a task carries — only on
 * {@link CalendarSpan.isMultiDay}, and only for rounding the bar's ends.
 */
export interface CalendarSpan {
  taskId: string;
  startKey: DayKey;
  endKey: DayKey;
  isMultiDay: boolean;
}

/** One task's bar within ONE week row, already clipped to that row. */
export interface WeekSegment {
  taskId: string;
  /** Stack position, 0-based. Lane 0 is drawn directly under the day number. */
  lane: number;
  /** 0-based column within the week, in LOGICAL order (0 = first day shown). */
  columnStart: number;
  /** Number of columns covered, ≥ 1. */
  columnSpan: number;
  /** The task's real start falls in this week — round the leading edge. */
  isStart: boolean;
  /** The task's real end falls in this week — round the trailing edge. */
  isEnd: boolean;
}

/**
 * A task's span, or `null` when it has no dates at all (the unscheduled tray's
 * population).
 *
 * DEFENSIVE ON INVERTED DATES. `dueDate < startDate` is not reachable through
 * the UI, but it is reachable through the API and through an import, and the
 * honest rendering of a task whose dates disagree is a single chip on the day
 * it is DUE — a bar drawn backwards would just look like a layout bug.
 */
export function spanOfTask(
  task: Pick<TaskSummary, 'id' | 'startDate' | 'dueDate'>,
): CalendarSpan | null {
  const { startDate, dueDate } = task;

  if (startDate !== null && dueDate !== null) {
    if (compareDayKeys(startDate, dueDate) > 0) {
      return { taskId: task.id, startKey: dueDate, endKey: dueDate, isMultiDay: false };
    }
    return {
      taskId: task.id,
      startKey: startDate,
      endKey: dueDate,
      isMultiDay: startDate !== dueDate,
    };
  }

  // One date only: the task occupies exactly that day. A start-only task is
  // rendered on its start day rather than hidden — the alternative is a task
  // that exists in the data and nowhere on screen.
  const single = dueDate ?? startDate;
  if (single === null) return null;
  return { taskId: task.id, startKey: single, endKey: single, isMultiDay: false };
}

/** True when a task carries no dates at all — the tray's membership test. */
export function isUnscheduled(task: Pick<TaskSummary, 'startDate' | 'dueDate'>): boolean {
  return task.startDate === null && task.dueDate === null;
}

/**
 * Does this span touch the range at all?
 *
 * The INTERSECTION test, not a containment test: a task that started in
 * February and is due in April is on screen for all of March, and asking
 * whether either of its endpoints is inside the month would say it is not.
 */
export function spanIntersects(span: CalendarSpan, range: DayRange): boolean {
  return span.startKey <= range.to && span.endKey >= range.from;
}

/** Length of a span in days, inclusive of both ends (single day → 1). */
export function spanLength(span: CalendarSpan): number {
  return diffDayKeys(span.endKey, span.startKey) + 1;
}

/**
 * The tasks a grid should draw, from however many query results supplied them.
 *
 * DEDUPES BY ID because the page merges two fetches (the due-range query and
 * the unfiltered one behind the tray — see `useCalendarTasks`), and a task can
 * legitimately appear in both. First occurrence wins, so the ranged query's
 * copy is the one kept.
 *
 * The result is sorted the way {@link layoutWeek} wants it, so the caller does
 * not sort again per week: earliest start first, then LONGEST first (long bars
 * take the top lanes, which is what makes a month read as a schedule rather
 * than a scatter), then by id so the order is total and stable.
 */
export function selectRangeTasks(
  tasks: readonly TaskSummary[],
  range: DayRange,
): { tasks: TaskSummary[]; spans: Map<string, CalendarSpan> } {
  const spans = new Map<string, CalendarSpan>();
  const selected: TaskSummary[] = [];

  for (const task of tasks) {
    if (spans.has(task.id)) continue;
    const span = spanOfTask(task);
    if (!span || !spanIntersects(span, range)) continue;
    spans.set(task.id, span);
    selected.push(task);
  }

  selected.sort((a, b) => compareSpans(spans.get(a.id), spans.get(b.id)));
  return { tasks: selected, spans };
}

/** The tray's rows: every dated-nowhere task, in a stable order. */
export function selectUnscheduled(tasks: readonly TaskSummary[]): TaskSummary[] {
  return tasks
    .filter(isUnscheduled)
    .slice()
    .sort((a, b) => a.number - b.number);
}

/** The ordering described on {@link selectRangeTasks}. Undefined spans sort last. */
function compareSpans(a: CalendarSpan | undefined, b: CalendarSpan | undefined): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  const byStart = compareDayKeys(a.startKey, b.startKey);
  if (byStart !== 0) return byStart;
  const byLength = spanLength(b) - spanLength(a);
  if (byLength !== 0) return byLength;
  return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
}

/**
 * Stack one week's spans into lanes, clipped to the week.
 *
 * `days` is the week in LOGICAL order (index 0 is whatever
 * `weekStartFor(lang)` says the row opens with), so `columnStart` is a grid
 * column index and needs no direction handling: CSS grid numbers its columns
 * from the reading start, so column 1 is on the right under `dir="rtl"` all by
 * itself.
 *
 * Spans are assumed pre-sorted by {@link selectRangeTasks}; the function sorts
 * defensively anyway, because a caller that hands over a raw array should get a
 * stable layout rather than a subtly different one.
 */
export function layoutWeek(spans: readonly CalendarSpan[], days: readonly DayKey[]): WeekSegment[] {
  const first = days.at(0);
  const last = days.at(-1);
  if (first === undefined || last === undefined) return [];

  const week: DayRange = { from: first, to: last };
  const visible = spans.filter((span) => spanIntersects(span, week)).sort(compareSpans);

  /** Per lane, the exclusive column index the lane is free from. */
  const laneFreeFrom: number[] = [];
  const segments: WeekSegment[] = [];

  for (const span of visible) {
    const columnStart = Math.max(0, diffDayKeys(span.startKey, first));
    const columnEnd = Math.min(days.length - 1, diffDayKeys(span.endKey, first));
    if (columnEnd < columnStart) continue;

    let lane = laneFreeFrom.findIndex((freeFrom) => freeFrom <= columnStart);
    if (lane === -1) lane = laneFreeFrom.length;
    laneFreeFrom[lane] = columnEnd + 1;

    segments.push({
      taskId: span.taskId,
      lane,
      columnStart,
      columnSpan: columnEnd - columnStart + 1,
      isStart: span.startKey >= first,
      isEnd: span.endKey <= last,
    });
  }

  return segments;
}

/** How many lanes a week actually used — the week view's row count. */
export function laneCount(segments: readonly WeekSegment[]): number {
  return segments.reduce((max, segment) => Math.max(max, segment.lane + 1), 0);
}

/** The segments a view with `maxLanes` visible rows can draw. */
export function visibleSegments(segments: readonly WeekSegment[], maxLanes: number): WeekSegment[] {
  return segments.filter((segment) => segment.lane < maxLanes);
}

/**
 * Per column, how many segments were pushed out of view by the lane cap — the
 * "+n more" counts.
 *
 * Counted PER DAY rather than per segment: a three-day bar that did not fit
 * adds one to each of the three days it would have covered, because that is
 * what the number promises the user ("there is one more thing on this day").
 */
export function hiddenCountsByColumn(
  segments: readonly WeekSegment[],
  columns: number,
  maxLanes: number,
): number[] {
  const counts = new Array<number>(columns).fill(0);
  for (const segment of segments) {
    if (segment.lane < maxLanes) continue;
    for (
      let column = segment.columnStart;
      column < segment.columnStart + segment.columnSpan;
      column += 1
    ) {
      if (column < 0 || column >= columns) continue;
      counts[column] = (counts[column] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * The tasks hidden behind one day's "+n more", in lane order — the popover's
 * contents.
 */
export function hiddenTaskIdsForColumn(
  segments: readonly WeekSegment[],
  column: number,
  maxLanes: number,
): string[] {
  return segments
    .filter(
      (segment) =>
        segment.lane >= maxLanes &&
        column >= segment.columnStart &&
        column < segment.columnStart + segment.columnSpan,
    )
    .sort((a, b) => a.lane - b.lane)
    .map((segment) => segment.taskId);
}

/**
 * Is this task late?
 *
 * Overdue is a property of the DUE date only — a task whose start date has
 * passed is simply started, and tinting it red would make every in-flight bar
 * on the board look like a failure. A task in a `done`-category status is never
 * overdue however late it was finished: the deadline stopped applying when the
 * work did.
 */
export function isOverdue(
  task: Pick<TaskSummary, 'dueDate'>,
  category: StatusCategory | undefined,
  today: DayKey,
): boolean {
  if (task.dueDate === null) return false;
  if (category === 'done') return false;
  return task.dueDate < today;
}
