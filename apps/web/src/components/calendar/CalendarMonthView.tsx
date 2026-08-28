import { useMemo, type CSSProperties } from 'react';
import type { StatusCategory, TaskSummary } from '@flowboard/shared';

import { DaySurface, DayNumber, MoreButton } from '@/components/calendar/CalendarDayCell';
import TaskChip from '@/components/calendar/TaskChip';
import type { DayKey } from '@/components/calendar/calendar-dates';
import {
  hiddenCountsByColumn,
  hiddenTaskIdsForColumn,
  isOverdue,
  layoutWeek,
  visibleSegments,
  type CalendarSpan,
} from '@/components/calendar/calendar-layout';

/**
 * The month grid: six week rows, seven days each, task bars laid across them.
 *
 * ═══ ONE GRID PER WEEK ROW ═════════════════════════════════════════════════
 *
 * Not one grid for the month. A bar is a grid item spanning columns, and a grid
 * item cannot wrap onto the next row — so a task running from Thursday to the
 * following Tuesday has to become TWO items, one per row, and each row has to
 * do its own lane assignment (`layoutWeek`). Rows are also where lanes can be
 * reclaimed: a task that ends on Monday leaves its lane free for the rest of
 * that week, which is what keeps a busy month three lanes deep instead of
 * thirty.
 *
 * Each row's grid is:
 *
 *   row 1        the date         (auto)
 *   rows 2…4     the lanes        (var(--cal-lane-h) each)
 *   row 5        "+n more"        (auto — zero-height when nothing overflows)
 *   row 6        filler           (1fr — lets the day boxes fill the row)
 *
 * with the day surfaces spanning `1 / -1` beneath everything. See
 * `CalendarDayCell` for why the cell is assembled from separate grid items.
 *
 * ═══ THE LANE CAP ══════════════════════════════════════════════════════════
 *
 * Three lanes, then "+n more". A month cell in a dense Linear-style layout is
 * roughly 110px tall; three 18px chips plus the date and the overflow line fill
 * it exactly. Showing more would either shrink the chips below readable or grow
 * the grid past one screen, and a calendar you scroll is no longer a month at a
 * glance.
 */

/** Visible lanes per month cell. See the module note. */
export const MAX_MONTH_LANES = 3;

const COLUMNS = 7;

/** `style` that also carries CSS custom properties. */
type StyleWithVars = CSSProperties & Record<`--${string}`, string>;

export interface CalendarMonthViewProps {
  /** Any day in the month being rendered — drives the dimming of outside days. */
  cursor: DayKey;
  today: DayKey;
  /** Six rows of seven day keys, in logical order (see `calendar-dates`). */
  weeks: readonly (readonly DayKey[])[];
  /** Localized weekday headers, already in the same logical order. */
  weekdayLabels: readonly string[];
  /** Every task on screen, pre-ordered by `selectRangeTasks`. */
  tasks: readonly TaskSummary[];
  spans: ReadonlyMap<string, CalendarSpan>;
  byId: ReadonlyMap<string, TaskSummary>;
  categories: ReadonlyMap<string, StatusCategory>;
  projectKey: string;
  onOpen: (task: TaskSummary) => void;
  onReschedule: (task: TaskSummary, dayKey: DayKey) => void;
  /** Clicking a date switches to that week. */
  onSelectDay?: (dayKey: DayKey) => void;
}

export function CalendarMonthView({
  cursor,
  today,
  weeks,
  weekdayLabels,
  tasks,
  spans,
  byId,
  categories,
  projectKey,
  onOpen,
  onReschedule,
  onSelectDay,
}: CalendarMonthViewProps) {
  // The spans of the visible tasks, in the order `selectRangeTasks` produced —
  // which is the order `layoutWeek` wants, so no week row re-sorts.
  const orderedSpans = useMemo(
    () =>
      tasks
        .map((task) => spans.get(task.id))
        .filter((span): span is CalendarSpan => span !== undefined),
    [tasks, spans],
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--card-radius)] border border-border"
      style={{ '--cal-lane-h': '18px' } as StyleWithVars}
    >
      <div className="grid grid-cols-7 border-b border-border bg-surface-raised">
        {weekdayLabels.map((label, index) => (
          <div
            key={label + String(index)}
            className="truncate px-2 py-1.5 text-[0.6875rem] font-medium text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {weeks.map((days) => (
          <MonthWeekRow
            key={days.at(0) ?? ''}
            days={days}
            cursor={cursor}
            today={today}
            spans={orderedSpans}
            byId={byId}
            categories={categories}
            projectKey={projectKey}
            onOpen={onOpen}
            onReschedule={onReschedule}
            onSelectDay={onSelectDay}
          />
        ))}
      </div>
    </div>
  );
}

function MonthWeekRow({
  days,
  cursor,
  today,
  spans,
  byId,
  categories,
  projectKey,
  onOpen,
  onReschedule,
  onSelectDay,
}: {
  days: readonly DayKey[];
  cursor: DayKey;
  today: DayKey;
  spans: readonly CalendarSpan[];
  byId: ReadonlyMap<string, TaskSummary>;
  categories: ReadonlyMap<string, StatusCategory>;
  projectKey: string;
  onOpen: (task: TaskSummary) => void;
  onReschedule: (task: TaskSummary, dayKey: DayKey) => void;
  onSelectDay?: (dayKey: DayKey) => void;
}) {
  const segments = useMemo(() => layoutWeek(spans, days), [spans, days]);
  const shown = useMemo(() => visibleSegments(segments, MAX_MONTH_LANES), [segments]);
  const hidden = useMemo(
    () => hiddenCountsByColumn(segments, COLUMNS, MAX_MONTH_LANES),
    [segments],
  );

  return (
    <div
      className="grid min-h-[104px] flex-1 grid-cols-7 border-s border-border"
      style={{
        gridTemplateRows: `auto repeat(${String(MAX_MONTH_LANES)}, var(--cal-lane-h)) auto minmax(0, 1fr)`,
        rowGap: '2px',
      }}
    >
      {days.map((dayKey, column) => (
        <DaySurface
          key={`surface-${dayKey}`}
          dayKey={dayKey}
          cursor={cursor}
          today={today}
          style={{ gridColumn: column + 1, gridRow: '1 / -1' }}
          className={column === 0 ? 'border-s-0' : undefined}
        />
      ))}

      {days.map((dayKey, column) => (
        <DayNumber
          key={`number-${dayKey}`}
          dayKey={dayKey}
          cursor={cursor}
          today={today}
          onSelect={onSelectDay}
          style={{ gridColumn: column + 1, gridRow: 1 }}
        />
      ))}

      {shown.map((segment) => {
        const task = byId.get(segment.taskId);
        if (!task) return null;
        const category = categories.get(task.statusId);
        const anchor = days.at(segment.columnStart) ?? days.at(0) ?? today;
        return (
          <TaskChip
            key={`chip-${segment.taskId}`}
            task={task}
            taskKey={`${projectKey}-${String(task.number)}`}
            category={category}
            overdue={isOverdue(task, category, today)}
            dayKey={anchor}
            segment={segment}
            onOpen={onOpen}
            onReschedule={onReschedule}
            className="mx-0.5"
            style={{
              gridColumn: `${String(segment.columnStart + 1)} / span ${String(segment.columnSpan)}`,
              gridRow: segment.lane + 2,
            }}
          />
        );
      })}

      {days.map((dayKey, column) => {
        const count = hidden[column] ?? 0;
        if (count === 0) return null;
        const hiddenIds = hiddenTaskIdsForColumn(segments, column, MAX_MONTH_LANES);
        return (
          <MoreButton
            key={`more-${dayKey}`}
            dayKey={dayKey}
            count={count}
            style={{ gridColumn: column + 1, gridRow: MAX_MONTH_LANES + 2 }}
          >
            {hiddenIds.map((taskId) => {
              const task = byId.get(taskId);
              if (!task) return null;
              const category = categories.get(task.statusId);
              return (
                <TaskChip
                  key={`hidden-${taskId}`}
                  task={task}
                  taskKey={`${projectKey}-${String(task.number)}`}
                  category={category}
                  overdue={isOverdue(task, category, today)}
                  dayKey={dayKey}
                  size="md"
                  detailed
                  dragKind="none"
                  onOpen={onOpen}
                  onReschedule={onReschedule}
                />
              );
            })}
          </MoreButton>
        );
      })}
    </div>
  );
}

export default CalendarMonthView;
