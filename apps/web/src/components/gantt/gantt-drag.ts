import { addDays, daysBetween, type DatedSpan } from '@/components/gantt/useGanttGeometry';
import type { DateSpan } from '@/components/gantt/gantt-rows';

/**
 * Drag arithmetic: a pointer displacement in pixels → a pair of `YYYY-MM-DD`
 * dates fit to send to `PATCH /tasks/:id`.
 *
 * SEPARATED FROM THE COMPONENT ON PURPOSE. What `GanttBar` contributes is
 * pointer capture and a preview; what actually has to be RIGHT is this — that a
 * 40px drag at the month zoom means "three days later, and the same duration",
 * that a resize can never invert a bar, and that a nudge with the arrow keys
 * lands on exactly the same code path as a drag. All of that is testable
 * without a pointer, and none of it is testable through one.
 */

/** What a gesture is doing to the bar. */
export type DragMode = 'move' | 'resize-start' | 'resize-end';

/** The shortest bar the chart can express: one whole day. */
export const MIN_BAR_DAYS = 1;

/**
 * Pixels → whole days, ROUNDED to the nearest.
 *
 * Round rather than the floor `xToDate` uses, and the difference is not an
 * inconsistency — the two answer different questions. `xToDate` maps an
 * ABSOLUTE position to the column it is inside (anywhere within Tuesday is
 * Tuesday). This maps a RELATIVE displacement to an intent: dragging 0.6 of a
 * day's width plainly means "one day over", and flooring it would make the bar
 * refuse to move until the pointer had crossed a full cell — the single most
 * common complaint about hand-rolled Gantt drags.
 */
export function deltaDaysFromPx(dx: number, dayWidth: number): number {
  if (dayWidth <= 0) return 0;
  return Math.round(dx / dayWidth);
}

/**
 * Applies a gesture to a resolved span.
 *
 * Takes the RESOLVED span (what the bar is drawn from), not the raw task, so a
 * single-dated task behaves exactly as it looks: the bar is one day long, and
 * dragging it moves that one day. The patch it returns therefore always carries
 * BOTH dates — a drag materialises the span the user just placed, which is the
 * honest reading of "I put this bar here" and avoids the alternative of a bar
 * that snaps back to a point the moment it is released.
 *
 * RESIZE CANNOT INVERT. `resize-start` past the end (or `resize-end` before the
 * start) clamps to a {@link MIN_BAR_DAYS} bar pinned at the edge that is NOT
 * being dragged — so the bar shrinks to one day and stops, instead of turning
 * inside out and then re-expanding backwards.
 */
export function applyDrag(span: DateSpan, mode: DragMode, deltaDays: number): DateSpan {
  if (span === null) return null;
  if (deltaDays === 0) return span;

  const { startDate, dueDate } = span;

  switch (mode) {
    case 'move':
      return {
        startDate: addDays(startDate, deltaDays),
        dueDate: addDays(dueDate, deltaDays),
      };

    case 'resize-start': {
      const next = addDays(startDate, deltaDays);
      const room = daysBetween(next, dueDate) + 1;
      return {
        startDate: room < MIN_BAR_DAYS ? addDays(dueDate, -(MIN_BAR_DAYS - 1)) : next,
        dueDate,
      };
    }

    case 'resize-end': {
      const next = addDays(dueDate, deltaDays);
      const room = daysBetween(startDate, next) + 1;
      return {
        startDate,
        dueDate: room < MIN_BAR_DAYS ? addDays(startDate, MIN_BAR_DAYS - 1) : next,
      };
    }
  }
}

/**
 * The `PATCH` body for a finished gesture, or `null` when nothing changed.
 *
 * Returning `null` for a no-op is what stops a click that happened to jitter
 * two pixels from writing an identical task back to the server, raising an
 * activity entry and a socket broadcast for a change nobody made.
 */
export function dragPatch(
  original: DatedSpan,
  next: DateSpan,
): { startDate: string; dueDate: string } | null {
  if (next === null) return null;
  if (original.startDate === next.startDate && original.dueDate === next.dueDate) return null;
  return { startDate: next.startDate, dueDate: next.dueDate };
}

/** The dates a "schedule this" affordance seeds an undated task with. */
export const SCHEDULE_DEFAULT_DAYS = 3;

/**
 * Seed dates for an undated task: today through today + 3 days.
 *
 * Four days rather than one because the affordance's job is to give the user
 * something they can immediately GRAB — a one-day bar at the week zoom is 36px
 * wide with two 8px resize handles on it, which is a target, not a handle.
 */
export function seedSchedule(today: string): { startDate: string; dueDate: string } {
  return { startDate: today, dueDate: addDays(today, SCHEDULE_DEFAULT_DAYS) };
}
