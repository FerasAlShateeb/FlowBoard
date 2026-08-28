import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/core';

import { cn } from '@/lib/utils';
import { getIntlLocale } from '@/lib/lang-policy';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  formatDayNumber,
  formatFullDate,
  isSameMonth,
  type DayKey,
} from '@/components/calendar/calendar-dates';
import { dayDroppableId } from '@/components/calendar/calendar-dnd';

/**
 * The three pieces a calendar day is made of, deliberately kept as separate
 * grid items rather than one nested component.
 *
 * ═══ WHY THE CELL IS NOT ONE BOX ═══════════════════════════════════════════
 *
 * A month row has to do two things a nested layout cannot do at once: give each
 * day its own bordered box, and let a task bar run ACROSS several of those
 * boxes. So one CSS grid per week row owns everything, and each day contributes
 * three items to it:
 *
 *   {@link DaySurface}  column i, rows 1 … -1  — the box, and the drop target
 *   {@link DayNumber}   column i, row 1        — the date
 *   {@link MoreButton}  column i, last row     — "+n more", when lanes overflow
 *
 * The bars are then plain grid items in the lane rows, spanning
 * `columnStart / span columnSpan`, and they land on top of the surfaces simply
 * by coming later in the DOM. No absolute positioning, no measured pixels, and
 * — because CSS grid numbers its columns from the reading edge — the whole row
 * mirrors itself under `dir="rtl"` for free.
 */

/**
 * The day's box: its border, its background, and the dnd-kit drop target.
 *
 * The DROP TARGET IS THE WHOLE CELL, including the strip under the day number
 * and the empty lanes below the last chip, because "drop it on the 14th" is a
 * gesture aimed at a square, not at a row of pixels. It spans every grid row of
 * its column for exactly that reason.
 */
export function DaySurface({
  dayKey,
  cursor,
  today,
  style,
  className,
}: {
  dayKey: DayKey;
  /** The month in view — days outside it are dimmed, not hidden. */
  cursor: DayKey;
  today: DayKey;
  style?: CSSProperties;
  className?: string;
}) {
  const { t } = useTranslation(['calendar']);
  const locale = getIntlLocale();
  const { setNodeRef, isOver } = useDroppable({
    id: dayDroppableId(dayKey),
    data: { dayKey },
  });

  const outside = !isSameMonth(dayKey, cursor);

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-calendar-day={dayKey}
      data-outside={outside ? '' : undefined}
      data-today={dayKey === today ? '' : undefined}
      aria-label={t('calendar:a11y.day', { date: formatFullDate(dayKey, locale) })}
      className={cn(
        'min-w-0 border-b border-e border-border transition-colors duration-[var(--speed)]',
        outside ? 'bg-background/40' : 'bg-surface',
        dayKey === today && 'bg-primary/5',
        // The drop affordance. A ring rather than a fill so the chips already
        // in the cell stay readable while a bar hovers over them.
        isOver && 'bg-primary/10 ring-2 ring-primary/50 ring-inset',
        className,
      )}
    />
  );
}

/**
 * The date, top-aligned in its cell.
 *
 * Today gets a filled disc rather than a ring: at 13.5px base size a 1px ring
 * around two digits reads as a rendering artefact, while a disc reads as "you
 * are here" from across the room. Outside days are dimmed to the muted token —
 * still legible, clearly not this month.
 */
export function DayNumber({
  dayKey,
  cursor,
  today,
  style,
  onSelect,
}: {
  dayKey: DayKey;
  cursor: DayKey;
  today: DayKey;
  style?: CSSProperties;
  /** Month view: clicking a date jumps the week view to it. Optional. */
  onSelect?: (dayKey: DayKey) => void;
}) {
  const { t } = useTranslation(['calendar']);
  const locale = getIntlLocale();
  const outside = !isSameMonth(dayKey, cursor);
  const isToday = dayKey === today;

  const content = (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.6875rem] tabular-nums',
        isToday && 'bg-primary font-semibold text-primary-foreground',
        !isToday && outside && 'text-muted-foreground/70',
        !isToday && !outside && 'text-muted-foreground',
      )}
    >
      {formatDayNumber(dayKey, locale)}
    </span>
  );

  return (
    <div
      style={style}
      className="pointer-events-none z-10 flex min-w-0 items-center justify-start p-1"
    >
      {onSelect ? (
        <button
          type="button"
          className="pointer-events-auto cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-label={t('calendar:a11y.showWeek', { date: formatFullDate(dayKey, locale) })}
          onClick={() => onSelect(dayKey)}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  );
}

/**
 * "+n more" — the overflow affordance of a month cell.
 *
 * It is a POPOVER rather than an expanding cell: growing the cell would grow
 * its row, which would push the rest of the month down and re-flow every bar
 * the user was looking at. The popover leaves the grid untouched and can hold
 * as many rows as it needs.
 */
export function MoreButton({
  dayKey,
  count,
  style,
  children,
}: {
  dayKey: DayKey;
  count: number;
  style?: CSSProperties;
  /** The hidden chips, rendered by the view that knows how to build them. */
  children: ReactNode;
}) {
  const { t } = useTranslation(['calendar']);
  const locale = getIntlLocale();

  return (
    <div style={style} className="z-10 flex min-w-0 items-center px-1 pb-1">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full cursor-default truncate rounded-[var(--radius-sm)] px-1 text-start text-[0.6875rem] text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {t('calendar:grid.more', { count })}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <p className="px-1 pb-1.5 text-xs font-medium text-foreground">
            {formatFullDate(dayKey, locale)}
          </p>
          <div className="flex flex-col gap-1">{children}</div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
