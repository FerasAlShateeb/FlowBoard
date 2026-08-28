import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatusCategory, TaskSummary } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { getIntlLocale } from '@/lib/lang-policy';
import { DaySurface } from '@/components/calendar/CalendarDayCell';
import TaskChip from '@/components/calendar/TaskChip';
import { formatDayNumber, type DayKey } from '@/components/calendar/calendar-dates';
import {
  isOverdue,
  laneCount,
  layoutWeek,
  type CalendarSpan,
} from '@/components/calendar/calendar-layout';

/**
 * The week view: the same seven columns, given the whole page.
 *
 * ═══ NO HOUR AXIS ══════════════════════════════════════════════════════════
 *
 * Deliberately. A FlowBoard task is dated to the DAY — `startDate` and
 * `dueDate` are `YYYY-MM-DD`, with no time component anywhere in the contract —
 * so an hour grid would be 24 rows of pure decoration, and dropping a task at
 * "14:00" would silently discard the only part of the gesture the user cared
 * about. The week is therefore an all-day board: seven tall columns, bars laid
 * across them exactly as in the month view, and every lane visible because
 * there is room for them.
 *
 * What the extra width buys instead is DETAIL: a week chip is 28px rather than
 * 18px, and carries the assignee's avatar and the story points alongside the
 * key and title. And it is the only place the span EDGE HANDLES appear — at
 * month density a 6px grab strip sits inside an 18px chip and every attempt to
 * move a task resizes it instead.
 */

/** Lane height of the week view, in pixels — see the module note on detail. */
const WEEK_LANE_HEIGHT = '28px';

/** Rows drawn even when the week is empty, so the columns have a body. */
const MIN_WEEK_LANES = 4;

/** `style` that also carries CSS custom properties. */
type StyleWithVars = CSSProperties & Record<`--${string}`, string>;

export interface CalendarWeekViewProps {
  today: DayKey;
  /** The seven day keys, in logical order. */
  days: readonly DayKey[];
  /** Localized weekday headers, in the same order. */
  weekdayLabels: readonly string[];
  tasks: readonly TaskSummary[];
  spans: ReadonlyMap<string, CalendarSpan>;
  byId: ReadonlyMap<string, TaskSummary>;
  categories: ReadonlyMap<string, StatusCategory>;
  projectKey: string;
  onOpen: (task: TaskSummary) => void;
  onReschedule: (task: TaskSummary, dayKey: DayKey) => void;
}

export function CalendarWeekView({
  today,
  days,
  weekdayLabels,
  tasks,
  spans,
  byId,
  categories,
  projectKey,
  onOpen,
  onReschedule,
}: CalendarWeekViewProps) {
  const { t } = useTranslation(['calendar']);
  const locale = getIntlLocale();

  const orderedSpans = useMemo(
    () =>
      tasks
        .map((task) => spans.get(task.id))
        .filter((span): span is CalendarSpan => span !== undefined),
    [tasks, spans],
  );

  const segments = useMemo(() => layoutWeek(orderedSpans, days), [orderedSpans, days]);
  const lanes = Math.max(laneCount(segments), MIN_WEEK_LANES);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--card-radius)] border border-border"
      style={{ '--cal-lane-h': WEEK_LANE_HEIGHT } as StyleWithVars}
    >
      <div className="grid grid-cols-7 border-b border-border bg-surface-raised">
        {days.map((dayKey, column) => (
          <div
            key={`head-${dayKey}`}
            className={cn(
              'flex min-w-0 items-baseline gap-1.5 px-2 py-1.5',
              column > 0 && 'border-s border-border',
            )}
          >
            <span className="truncate text-[0.6875rem] font-medium text-muted-foreground">
              {weekdayLabels[column]}
            </span>
            <span
              className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs tabular-nums',
                dayKey === today
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : 'text-foreground',
              )}
            >
              {formatDayNumber(dayKey, locale)}
            </span>
          </div>
        ))}
      </div>

      <div
        className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto"
        style={{
          gridTemplateRows: `repeat(${String(lanes)}, var(--cal-lane-h)) minmax(0, 1fr)`,
          rowGap: '4px',
        }}
        aria-label={t('calendar:a11y.weekGrid')}
      >
        {days.map((dayKey, column) => (
          <DaySurface
            key={`surface-${dayKey}`}
            dayKey={dayKey}
            // The week view has no "outside" days: every column belongs to the
            // week being shown, so the cursor is the day itself.
            cursor={dayKey}
            today={today}
            style={{ gridColumn: column + 1, gridRow: '1 / -1' }}
            className={cn('border-b-0', column === 0 && 'border-s-0')}
          />
        ))}

        {segments.map((segment) => {
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
              size="md"
              detailed
              resizable
              onOpen={onOpen}
              onReschedule={onReschedule}
              className="mx-1"
              style={{
                gridColumn: `${String(segment.columnStart + 1)} / span ${String(segment.columnSpan)}`,
                gridRow: segment.lane + 1,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default CalendarWeekView;
