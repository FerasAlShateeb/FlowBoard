import { useMemo } from 'react';
import type { Status, StatusCategory, TaskSummary } from '@flowboard/shared';

import { useTaskList } from '@/hooks/useTasks';
import type { DayRange } from '@/components/calendar/calendar-dates';
import {
  selectRangeTasks,
  selectUnscheduled,
  type CalendarSpan,
} from '@/components/calendar/calendar-layout';

/**
 * The calendar's data layer: two queries, one merged answer.
 *
 * It lives beside the view rather than in `hooks/` because it is not a
 * transport — it is this view's reading of `useTaskList`, and the interesting
 * part is the RANGE ARITHMETIC below, which is meaningless anywhere else. (The
 * convention puts data hooks in `hooks/`; that directory is owned by WP2.4 and
 * frozen for this package, and a calendar-shaped hook in it would be a hook
 * nothing else calls.)
 *
 * ═══ QUERY 1 — THE VISIBLE RANGE ═══════════════════════════════════════════
 *
 *   GET /projects/:id/tasks?view=flat&pageSize=100
 *       &dueFrom=<grid start>&dueTo=<grid end>
 *       &startFrom=<grid start>&startTo=<grid end>
 *
 * ONE FETCH PER VISIBLE RANGE, and the range is the GRID's, not the month's —
 * the six-week month grid shows days either side of the month, and tasks on
 * those days are on screen.
 *
 * THE TWO PAIRS ARE OR-ED SERVER-SIDE (`taskFiltersSchema`, WP3.8): a task is
 * returned when its due date OR its start date falls inside the window. That is
 * the question the grid is actually asking, because a task is drawn as a SPAN
 * and either endpoint landing in view puts it on screen.
 *
 * WHAT THIS REPLACED. Before the `startFrom`/`startTo` pair existed the server
 * could only filter `due_date`, so this hook padded the upper bound by six
 * weeks and re-filtered in the browser, and start-only tasks had to be scavenged
 * out of the tray's unfiltered page. Both are gone: the fetch is now exact, and
 * `selectRangeTasks` computes LAYOUT rather than making up for the query.
 *
 * ONE HONEST GAP REMAINS, and it is much narrower than the old one: a task whose
 * span strictly CONTAINS the whole grid (starts before it, due after it) matches
 * neither range and is not fetched. Expressing that needs an overlap predicate
 * across two columns (`start ≤ gridEnd AND due ≥ gridStart`), which cannot be
 * spelled as two independent windows — and a task spanning more than six weeks
 * entirely across the visible month has no chip day inside the grid anyway.
 *
 * ═══ QUERY 2 — THE UNSCHEDULED TRAY ════════════════════════════════════════
 *
 *   GET /projects/:id/tasks?view=flat&pageSize=100&undated=true
 *
 * `undated=true` selects rows with NEITHER a start nor a due date — the tray's
 * exact population. It is its own parameter rather than a `none` sentinel
 * because it spans two columns: a task with a start but no due date IS
 * scheduled, and belongs on the grid rather than in the tray.
 *
 * The tray used to fetch the project's first page unfiltered and sieve it in the
 * browser, which over-fetched on every project and UNDER-reported on any project
 * with more than 100 tasks (the page cap is `useTaskList`'s). Now the 100 rows
 * are 100 undated rows.
 */

export interface CalendarData {
  /** Every task intersecting the visible range, deduped and layout-ordered. */
  tasks: TaskSummary[];
  /** Their spans, by task id — computed once here, reused by every week row. */
  spans: Map<string, CalendarSpan>;
  /** Every task with no dates at all: the tray's rows. */
  unscheduled: TaskSummary[];
  /** Task lookup for the drag handlers, which only receive an id. */
  byId: Map<string, TaskSummary>;
  isPending: boolean;
  error: unknown;
  refetch: () => void;
}

export function useCalendarTasks(
  projectId: string | null | undefined,
  range: DayRange,
): CalendarData {
  const ranged = useTaskList(projectId, {
    dueFrom: range.from,
    dueTo: range.to,
    startFrom: range.from,
    startTo: range.to,
  });

  // The tray's exact population. Its cache key carries only `undated`, so it is
  // fetched once for the whole session regardless of where the cursor is.
  const undated = useTaskList(projectId, { undated: true });

  const rangedData = ranged.data;
  const undatedData = undated.data;
  // The range object is rebuilt every render; its two STRINGS are what the
  // selection depends on, so they are the dependencies.
  const { from, to } = range;

  // Only the ranged query feeds the grid now. The tray's rows are undated by
  // construction, so `selectRangeTasks` would discard every one of them —
  // merging the two lists was how a start-only task used to reach the grid, and
  // `startFrom`/`startTo` fetch those directly.
  const { tasks, spans } = useMemo(
    () => selectRangeTasks(rangedData ?? [], { from, to }),
    [rangedData, from, to],
  );

  const unscheduled = useMemo(() => selectUnscheduled(undatedData ?? []), [undatedData]);

  const byId = useMemo(() => {
    const map = new Map<string, TaskSummary>();
    for (const task of tasks) map.set(task.id, task);
    for (const task of unscheduled) map.set(task.id, task);
    return map;
  }, [tasks, unscheduled]);

  return {
    tasks,
    spans,
    unscheduled,
    byId,
    // The tray is secondary chrome: the grid must not sit behind a spinner
    // waiting for it, so only the ranged query gates the loading state.
    isPending: ranged.isPending,
    error: ranged.error ?? undated.error,
    refetch: () => {
      void ranged.refetch();
      void undated.refetch();
    },
  };
}

/**
 * `statusId` → its semantic category, from the project detail every project
 * page already has in cache.
 *
 * The calendar tints chips by CATEGORY rather than by the status' own colour:
 * a project can have five columns, and five chip colours in a month grid is
 * noise. Three — not started, in flight, done — is a schedule.
 */
export function statusCategories(
  statuses: readonly Status[] | undefined,
): Map<string, StatusCategory> {
  const map = new Map<string, StatusCategory>();
  for (const status of statuses ?? []) map.set(status.id, status.category);
  return map;
}
