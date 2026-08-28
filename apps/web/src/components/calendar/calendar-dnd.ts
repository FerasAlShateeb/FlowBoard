import type { PatchTaskInput, TaskSummary } from '@flowboard/shared';

import { addDayKeys, diffDayKeys, type DayKey } from '@/components/calendar/calendar-dates';
import { spanOfTask } from '@/components/calendar/calendar-layout';

/**
 * What a drag on the calendar MEANS — the pure half of the drag-and-drop layer.
 *
 * dnd-kit answers "this draggable was dropped on that droppable". Turning that
 * into a `PATCH /tasks/:id` body is a product decision with three cases, and
 * getting any of them wrong silently rewrites someone's schedule. So the
 * mapping lives here, as functions of (task, target day) with no React and no
 * mutation in sight, and `CalendarPage` is left with plumbing.
 *
 * ═══ THE THREE DROPS ═══════════════════════════════════════════════════════
 *
 * | Task shape                | Dropped on a day | Body                          |
 * |---------------------------|------------------|-------------------------------|
 * | due date only             | reschedule       | `{ dueDate }`                 |
 * | start + due (a span)      | move the whole   | `{ startDate, dueDate }` — the |
 * |                           | bar              | duration is PRESERVED          |
 * | no dates (from the tray)  | schedule         | `{ dueDate }`                 |
 *
 * **Why a span moves rather than stretches.** Dragging the BODY of a bar is
 * universally "move this block of work"; a two-week task dropped on next Monday
 * is still two weeks long. Changing its length is what the EDGE handles are
 * for ({@link resizePatch}), and keeping the two gestures separate is what
 * makes either of them safe to try.
 *
 * **The anchor is the span's START.** The dropped-on day becomes the new start
 * date. The alternative — preserving the offset of the exact day the pointer
 * grabbed — sounds more faithful but is not reproducible from a drop event
 * alone once a bar is clipped across week rows, and it makes "drop it on the
 * 3rd" land somewhere other than the 3rd.
 */

/** Which gesture a draggable represents. */
export type CalendarDragKind = 'chip' | 'tray' | 'resize';

/** Which end of a bar a resize handle owns. */
export type SpanEdge = 'start' | 'end';

/** The payload every calendar draggable carries in its dnd-kit `data`. */
export interface CalendarDragData {
  kind: CalendarDragKind;
  taskId: string;
  /** Present only for `kind: 'resize'`. */
  edge?: SpanEdge;
}

/** The payload every day droppable carries. */
export interface CalendarDropData {
  dayKey: DayKey;
}

const DAY_DROPPABLE_PREFIX = 'calendar-day:';

/** The dnd-kit id of a day cell. */
export function dayDroppableId(dayKey: DayKey): string {
  return `${DAY_DROPPABLE_PREFIX}${dayKey}`;
}

/**
 * The dnd-kit id of a draggable.
 *
 * The KIND is part of the id, not only of the data, because the same task is
 * draggable from up to three places at once (a chip in the grid, a row in the
 * tray, two resize handles) and dnd-kit requires ids to be unique across the
 * whole context. Colliding ids make the second registration silently win.
 */
export function dragId(kind: CalendarDragKind, taskId: string, edge?: SpanEdge): string {
  return edge ? `calendar-${kind}-${edge}:${taskId}` : `calendar-${kind}:${taskId}`;
}

/** Narrows dnd-kit's untyped `data.current` to a calendar drag payload. */
export function readDragData(value: unknown): CalendarDragData | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { kind, taskId, edge } = record;
  if (kind !== 'chip' && kind !== 'tray' && kind !== 'resize') return null;
  if (typeof taskId !== 'string' || taskId.length === 0) return null;
  if (kind === 'resize' && edge !== 'start' && edge !== 'end') return null;
  return { kind, taskId, edge: edge === 'start' || edge === 'end' ? edge : undefined };
}

/** Narrows a droppable's `data.current` to a day. */
export function readDropData(value: unknown): CalendarDropData | null {
  if (typeof value !== 'object' || value === null) return null;
  const dayKey = (value as Record<string, unknown>).dayKey;
  return typeof dayKey === 'string' ? { dayKey } : null;
}

/**
 * The body for "this task now happens on `targetDay`".
 *
 * Returns `null` for a drop that would change nothing — dropping a chip back on
 * its own day is the commonest drag of all (an aborted gesture), and firing a
 * PATCH for it would write an activity entry, a telemetry event and a socket
 * broadcast describing a move that did not happen.
 */
export function reschedulePatch(
  task: Pick<TaskSummary, 'id' | 'startDate' | 'dueDate'>,
  targetDay: DayKey,
): PatchTaskInput | null {
  const span = spanOfTask(task);

  // Unscheduled — the tray drop. Only a due date is set: inventing a start date
  // for a task nobody gave one would show up as a bar in the roadmap too.
  if (!span) return { dueDate: targetDay };

  // Both dates present: move the block, preserving its length. This also covers
  // the one-day span (start === due), where both dates land on the target.
  if (task.startDate !== null && task.dueDate !== null) {
    const duration = diffDayKeys(span.endKey, span.startKey);
    const startDate = targetDay;
    const dueDate = addDayKeys(targetDay, duration);
    if (startDate === task.startDate && dueDate === task.dueDate) return null;
    return { startDate, dueDate };
  }

  // Exactly one date. Move the one that exists; do not create the other.
  if (task.dueDate !== null) {
    return task.dueDate === targetDay ? null : { dueDate: targetDay };
  }
  return task.startDate === targetDay ? null : { startDate: targetDay };
}

/**
 * The body for dragging one END of a bar — the week view's edge handles.
 *
 * MINIMUM LENGTH IS ONE DAY, enforced by clamping rather than by refusing:
 * dragging the start past the due date parks the start ON the due date, which
 * is the only interpretation that keeps the bar visible and the dates valid. A
 * refusal would read as the handle being broken.
 *
 * Resizing a task that has only one of the two dates CREATES the other — that
 * is the gesture's whole purpose there ("this task due Friday actually starts
 * on Tuesday").
 */
export function resizePatch(
  task: Pick<TaskSummary, 'id' | 'startDate' | 'dueDate'>,
  edge: SpanEdge,
  targetDay: DayKey,
): PatchTaskInput | null {
  const span = spanOfTask(task);
  if (!span) return null;

  if (edge === 'start') {
    const startDate = targetDay <= span.endKey ? targetDay : span.endKey;
    return startDate === task.startDate ? null : { startDate };
  }

  const dueDate = targetDay >= span.startKey ? targetDay : span.startKey;
  if (dueDate === task.dueDate) return null;
  return { dueDate };
}

/** The tray's one-click action. Same rules as a drop onto today's cell. */
export function scheduleTodayPatch(
  task: Pick<TaskSummary, 'id' | 'startDate' | 'dueDate'>,
  today: DayKey,
): PatchTaskInput | null {
  return reschedulePatch(task, today);
}

// ───────────────────────────────────────────────────────────────────────────
// Keyboard navigation
// ───────────────────────────────────────────────────────────────────────────

/** The four arrow keys the grid handles. */
export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/** True for a key {@link nextChipIndex} knows what to do with. */
export function isArrowKey(key: string): key is ArrowKey {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';
}

/**
 * Where the focus ring goes when an arrow key is pressed on a focused chip.
 *
 * The chips are given in DOM order (which is reading order: week by week, then
 * lane by lane). Horizontal movement steps through that list; **vertical
 * movement is a DATE jump of one week**, not a DOM jump, because a grid row's
 * chip count has nothing to do with the calendar and stepping by "7 elements"
 * would wander diagonally down the month.
 *
 * ← / → are MIRRORED under RTL: on an Arabic grid the next day is to the left,
 * so ArrowLeft has to advance. The caller passes the direction rather than this
 * module reading `document.dir` — it stays pure and testable that way.
 *
 * Returns `null` when there is nowhere to go (the caller then leaves focus
 * alone and lets the browser scroll, which is the right fallback).
 */
export function nextChipIndex(
  chips: readonly { dayKey: DayKey }[],
  current: number,
  key: ArrowKey,
  rtl: boolean,
): number | null {
  const anchor = chips[current];
  if (!anchor) return null;

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const forward = key === 'ArrowRight' ? !rtl : rtl;
    const next = current + (forward ? 1 : -1);
    return next >= 0 && next < chips.length ? next : null;
  }

  const down = key === 'ArrowDown';
  const target = addDayKeys(anchor.dayKey, down ? 7 : -7);

  let best: number | null = null;
  chips.forEach((chip, index) => {
    if (index === current) return;
    if (down ? chip.dayKey < target : chip.dayKey > target) return;
    const incumbent = best === null ? undefined : chips[best];
    if (!incumbent) {
      best = index;
      return;
    }
    // Nearest day in the direction of travel; ties break on DOM order, which
    // is lane order — so repeated presses walk the top lane down the column.
    const closer = down ? chip.dayKey < incumbent.dayKey : chip.dayKey > incumbent.dayKey;
    if (closer) best = index;
  });

  return best;
}
