import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { StatusCategory, TaskSummary } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { getIntlLocale } from '@/lib/lang-policy';
import UserAvatar from '@/components/common/UserAvatar';
import { TaskTypeIcon } from '@/components/common/task-icons';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
} from '@/components/ui/popover';
import {
  formatMediumDate,
  parseDayKey,
  toDayKey,
  type DayKey,
} from '@/components/calendar/calendar-dates';
import { dragId, type CalendarDragKind, type SpanEdge } from '@/components/calendar/calendar-dnd';
import type { WeekSegment } from '@/components/calendar/calendar-layout';

/**
 * One task, as it appears on the calendar: a chip on its day, or a segment of a
 * bar across several.
 *
 * ═══ WHY A DIV WRAPPING A BUTTON ═══════════════════════════════════════════
 *
 * The chip has to be three things at once — a drag handle, a link into the task
 * sheet, and (in the week view) the host of two resize handles. A `<button>`
 * may not contain another interactive element, so the outer node is a plain
 * `div` that carries the dnd-kit ref and listeners, and the inner `button`
 * carries the accessible name, the focus ring and the click. dnd-kit's
 * `attributes` go on the BUTTON so the chip is a single tab stop rather than
 * two.
 *
 * ═══ CLICK VS DRAG ═════════════════════════════════════════════════════════
 *
 * A pointer drag ends with a `click` on the element it started on, so without a
 * guard every reschedule would also open the task sheet over the calendar it
 * just changed. The guard is a distance test — the press coordinates are
 * recorded on `pointerdown` and compared on `click` — rather than a "was I
 * dragging" flag, because by the time `click` fires dnd-kit has already
 * finished the drag and cleared its state. Keyboard activation reports 0,0 and
 * no recorded press, so it always opens.
 *
 * ═══ LOGICAL ROUNDING ══════════════════════════════════════════════════════
 *
 * A multi-day bar is drawn as one segment per week row. The FIRST segment is
 * rounded on the reading-START side, the LAST on the reading-END side, and the
 * middles are flat with no border on the cut edges — so a bar reads as one
 * object interrupted by the row break. Every one of those is a LOGICAL property
 * (`rounded-s-*`, `border-e-0`), so an Arabic grid — where the week starts on
 * the right — caps the same physical ends the reader expects without a single
 * `rtl:` variant.
 */

/**
 * How far the pointer may travel between press and release and still count as a
 * click, in CSS pixels. Slightly above dnd-kit's 4px activation distance, so a
 * gesture that failed to start a drag still reads as a click.
 */
const CLICK_SLOP = 5;

export interface TaskChipProps {
  task: TaskSummary;
  /** `FLOW-142`, composed by the caller from the project key. */
  taskKey: string;
  category: StatusCategory | undefined;
  overdue: boolean;
  /**
   * The day the chip is anchored to. Not always its start: a continuation
   * segment is anchored to the first day of ITS row, which is what keyboard
   * navigation and the day popovers key on.
   */
  dayKey: DayKey;
  /** Which edges belong to the task itself. Omitted → a standalone chip. */
  segment?: Pick<WeekSegment, 'isStart' | 'isEnd'>;
  /** `md` is the week view's taller bar; `sm` is a month-grid lane. */
  size?: 'sm' | 'md';
  /** Week view and tray: show the assignee avatar and the points badge. */
  detailed?: boolean;
  /** `'none'` renders a static chip — used inside the "+n more" popover. */
  dragKind?: CalendarDragKind | 'none';
  /** Week view only: the two edge handles that resize the span. */
  resizable?: boolean;
  onOpen: (task: TaskSummary) => void;
  /** Enables the keyboard/context-menu reschedule. Omitted → no menu. */
  onReschedule?: (task: TaskSummary, dayKey: DayKey) => void;
  style?: CSSProperties;
  className?: string;
}

export function TaskChip({
  task,
  taskKey,
  category,
  overdue,
  dayKey,
  segment,
  size = 'sm',
  detailed = false,
  dragKind = 'chip',
  resizable = false,
  onOpen,
  onReschedule,
  style,
  className,
}: TaskChipProps) {
  const { t } = useTranslation(['calendar', 'common']);
  const locale = getIntlLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  const draggable = useDraggable({
    id: dragId(dragKind === 'none' ? 'chip' : dragKind, task.id),
    disabled: dragKind === 'none',
    data: { kind: dragKind === 'none' ? 'chip' : dragKind, taskId: task.id },
  });

  const roundStart = segment?.isStart ?? true;
  const roundEnd = segment?.isEnd ?? true;
  const done = category === 'done';

  const dateLabel =
    task.startDate && task.dueDate && task.startDate !== task.dueDate
      ? `${formatMediumDate(task.startDate, locale)} – ${formatMediumDate(task.dueDate, locale)}`
      : task.dueDate
        ? t('calendar:chip.due', { date: formatMediumDate(task.dueDate, locale) })
        : task.startDate
          ? t('calendar:chip.starts', { date: formatMediumDate(task.startDate, locale) })
          : t('calendar:chip.undated');

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    pressRef.current = { x: event.clientX, y: event.clientY };
  }

  function handleClick(event: { clientX: number; clientY: number }): void {
    const press = pressRef.current;
    pressRef.current = null;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP) return;
    onOpen(task);
  }

  const chip = (
    <div
      ref={draggable.setNodeRef}
      style={{
        ...style,
        transform: CSS.Translate.toString(draggable.transform),
      }}
      data-calendar-chip-root=""
      data-dragging={draggable.isDragging ? '' : undefined}
      className={cn(
        'group/chip relative isolate flex min-w-0 items-center border text-xs transition-colors duration-[var(--speed)]',
        size === 'md' ? 'h-7 gap-1.5 px-1.5' : 'h-[var(--cal-lane-h)] gap-1 px-1',
        toneClasses(category, overdue),
        roundStart ? 'rounded-s-[var(--radius)]' : 'rounded-s-none border-s-0',
        roundEnd ? 'rounded-e-[var(--radius)]' : 'rounded-e-none border-e-0',
        draggable.isDragging && 'z-20 opacity-70 shadow-[var(--shadow-2)]',
        className,
      )}
      {...draggable.listeners}
    >
      {resizable ? (
        <SpanResizeHandle
          taskId={task.id}
          edge="start"
          hidden={!roundStart}
          label={t('calendar:a11y.resizeStart')}
        />
      ) : null}

      <button
        type="button"
        {...draggable.attributes}
        data-calendar-chip=""
        data-day={dayKey}
        data-task-id={task.id}
        title={`${taskKey} · ${task.title} · ${dateLabel}`}
        aria-label={`${taskKey}: ${task.title}. ${dateLabel}`}
        className="flex min-w-0 flex-1 cursor-default items-center gap-1 rounded-[var(--radius)] bg-transparent text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onContextMenu={(event) => {
          if (!onReschedule) return;
          // Right-click AND the keyboard menu key / Shift+F10 both land here,
          // which is what makes the reschedule menu reachable without a mouse.
          event.preventDefault();
          setMenuOpen(true);
        }}
        onKeyDown={(event) => {
          if (!onReschedule) return;
          if (event.key === 'm' || event.key === 'M') {
            event.preventDefault();
            setMenuOpen(true);
          }
        }}
      >
        <TaskTypeIcon type={task.type} className="size-3 opacity-70" />
        <span className="shrink-0 font-mono text-[0.6875rem] opacity-80 tabular-nums">
          {taskKey}
        </span>
        {/* User content — see `UserChip` in `components/common/UserAvatar.tsx`. */}
        <span dir="auto" className={cn('truncate', done && 'line-through opacity-80')}>
          {task.title}
        </span>
      </button>

      {detailed ? (
        <span className="flex shrink-0 items-center gap-1">
          {task.storyPoints !== null ? (
            <span
              className="rounded-[var(--radius-sm)] bg-foreground/8 px-1 text-[0.6875rem] tabular-nums"
              title={t('calendar:chip.points', { count: task.storyPoints })}
            >
              {task.storyPoints}
            </span>
          ) : null}
          <UserAvatar user={task.assignee} size="xs" label={task.assignee?.name ?? ''} />
        </span>
      ) : null}

      {resizable ? (
        <SpanResizeHandle
          taskId={task.id}
          edge="end"
          hidden={!roundEnd}
          label={t('calendar:a11y.resizeEnd')}
        />
      ) : null}
    </div>
  );

  if (!onReschedule) return chip;

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverAnchor asChild>{chip}</PopoverAnchor>
      <PopoverContent align="start" className="w-auto p-2">
        <PopoverHeader className="px-1 pb-1">
          <PopoverTitle>{t('calendar:actions.moveTo')}</PopoverTitle>
        </PopoverHeader>
        <Calendar
          mode="single"
          autoFocus
          selected={task.dueDate ? parseDayKey(task.dueDate) : undefined}
          defaultMonth={parseDayKey(task.dueDate ?? task.startDate ?? dayKey)}
          onSelect={(date) => {
            setMenuOpen(false);
            if (date) onReschedule(task, toDayKey(date));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * One end of a span bar, draggable on its own.
 *
 * Pointer-only by design: it is a 4px strip, and a keyboard user resizes
 * through the reschedule menu instead (which is why the menu exists on every
 * chip, not only the draggable ones). `hidden` is passed rather than the handle
 * being omitted so a CONTINUATION segment — whose real end is in another week
 * row — cannot be resized from a row that does not own that end.
 */
function SpanResizeHandle({
  taskId,
  edge,
  hidden,
  label,
}: {
  taskId: string;
  edge: SpanEdge;
  hidden: boolean;
  label: string;
}) {
  const draggable = useDraggable({
    id: dragId('resize', taskId, edge),
    disabled: hidden,
    data: { kind: 'resize', taskId, edge },
  });

  if (hidden) return null;

  return (
    <span
      ref={draggable.setNodeRef}
      aria-hidden
      title={label}
      data-calendar-resize={edge}
      className={cn(
        'absolute inset-y-0 z-10 w-1.5 cursor-col-resize rounded-[var(--radius-sm)] opacity-0 transition-opacity duration-[var(--speed)] group-hover/chip:opacity-100',
        'bg-foreground/25',
        edge === 'start' ? 'start-0' : 'end-0',
      )}
      {...draggable.listeners}
    />
  );
}

/**
 * The chip's colour, in priority order: overdue beats everything, then the
 * status category. Tokens only — no hex literal reaches a calendar file
 * (checklist §B).
 */
function toneClasses(category: StatusCategory | undefined, overdue: boolean): string {
  if (overdue) return 'border-danger/40 bg-danger/12 text-danger';
  switch (category) {
    case 'in_progress':
      return 'border-brand-accent/45 bg-brand-accent/14 text-foreground';
    case 'done':
      return 'border-success/35 bg-success/12 text-success';
    default:
      return 'border-border bg-surface-raised text-muted-foreground';
  }
}

export default TaskChip;
