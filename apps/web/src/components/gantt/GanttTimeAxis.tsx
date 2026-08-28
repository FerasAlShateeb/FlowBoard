import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import {
  AXIS_ROW_HEIGHT,
  AXIS_HEIGHT,
  type AxisSegment,
  type GanttGeometry,
} from '@/components/gantt/useGanttGeometry';
import {
  dayRange,
  lowerCellLabel,
  monthYear,
  quarterOf,
  weekdayNarrow,
} from '@/components/gantt/gantt-format';

/**
 * The two-row time header, stuck to the top of the canvas.
 *
 * ═══ THE `dir="ltr"` ISLAND (plan §Risks 5) ════════════════════════════════
 *
 * This component lives inside the canvas's `dir="ltr"` wrapper and is the
 * clearest illustration of why that wrapper exists. Time runs in ONE direction
 * on a Gantt chart — earlier is left, later is right — because the bars, the
 * dependency arrows and the drag arithmetic are all expressed as increasing x.
 * Mirroring the axis under RTL would mirror all of that with it, and an arrow
 * that "points forward" would point backwards along the reading direction.
 *
 * So the axis is not translated in POSITION — but it is fully translated in
 * WORDS: month names come from `Intl` on `getIntlLocale()`, which also keeps
 * the digits Western in Arabic (`lib/lang-policy`). The sidebar next door stays
 * RTL. That split — LTR grid, RTL labels — is the whole policy.
 *
 * ═══ WHY IT IS A SEPARATE STICKY ELEMENT ═══════════════════════════════════
 *
 * `position: sticky; top: 0` inside the canvas's scroll box, and NOT a
 * separately-scrolled header pane: sticky keeps it pinned vertically while
 * still riding the canvas's horizontal scroll, for free, with no second scroll
 * listener to keep in sync. It is also why the virtualizer below is given
 * `paddingStart: AXIS_HEIGHT` — the axis occupies the first 48px of the scroll
 * content, and the rows have to start after it.
 */

/**
 * Both header rows share one cell chrome, so the two never drift apart.
 *
 * `border-l` is PHYSICAL: the cell is inside the canvas's `dir="ltr"` island,
 * and its rule marks the cell's EARLIER edge — the same edge `GanttGrid` draws
 * its vertical rules on. `border-s` would mirror the two apart under Arabic.
 */
function AxisCell({
  segment,
  className,
  children,
}: {
  segment: AxisSegment;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'absolute top-0 flex h-full items-center overflow-hidden border-l border-border/60 px-1.5 whitespace-nowrap tabular-nums',
        className,
      )}
      style={{ left: segment.x, width: segment.width }}
    >
      <span className="truncate">{children}</span>
    </div>
  );
}

export const GanttTimeAxis = memo(function GanttTimeAxis({
  geometry,
  locale,
}: {
  geometry: GanttGeometry;
  locale: string;
}) {
  const { t } = useTranslation(['roadmap']);
  const { axis, totalWidth, todayX } = geometry;

  /** The upper row's words. Only the quarter needs a translated noun. */
  const upperLabel = (segment: AxisSegment): string => {
    switch (axis.upperUnit) {
      case 'week':
        return dayRange(segment.unitStart, segment.end, locale);
      case 'month':
        return monthYear(segment.unitStart, locale);
      case 'quarter': {
        const { quarter, year } = quarterOf(segment.unitStart);
        return t('roadmap:axis.quarter', { quarter, year });
      }
      default:
        return dayRange(segment.start, segment.end, locale);
    }
  };

  return (
    <div
      // `sticky` needs the element to stay IN FLOW, which is why the grid and
      // bar layers below it are absolutely positioned rather than the axis
      // being lifted out of the box.
      className="sticky top-0 z-20 border-b border-border bg-surface-raised text-[11px] text-muted-foreground select-none"
      style={{ width: totalWidth, height: AXIS_HEIGHT }}
      role="presentation"
    >
      {/* ── Upper row: week / month / quarter ─────────────────────────────── */}
      <div className="relative" style={{ height: AXIS_ROW_HEIGHT }}>
        {axis.upper.map((segment) => (
          <AxisCell key={segment.key} segment={segment} className="font-medium text-foreground">
            {upperLabel(segment)}
          </AxisCell>
        ))}
      </div>

      {/* ── Lower row: day / week / month cells ───────────────────────────── */}
      <div className="relative border-t border-border/60" style={{ height: AXIS_ROW_HEIGHT }}>
        {geometry.weekendBands.map((band) => (
          <div
            key={band.key}
            aria-hidden
            className="absolute top-0 h-full bg-secondary/60"
            style={{ left: band.x, width: band.width }}
          />
        ))}

        {axis.lower.map((segment) => (
          <AxisCell
            key={segment.key}
            segment={segment}
            className={cn(axis.lowerUnit === 'day' && 'justify-center px-0')}
          >
            {/*
              At the week zoom the day cell is 36px, which fits a weekday
              initial AND the date — the pair is what makes a Gantt scannable
              ("is the 14th a Monday?"). Coarser zooms have no room and no need.
            */}
            {axis.lowerUnit === 'day' ? (
              <span className="flex items-baseline gap-0.5">
                <span className="text-[9px] opacity-70">
                  {weekdayNarrow(segment.unitStart, locale)}
                </span>
                <span>{lowerCellLabel(segment, axis.lowerUnit, locale)}</span>
              </span>
            ) : (
              lowerCellLabel(segment, axis.lowerUnit, locale)
            )}
          </AxisCell>
        ))}

        {/* The today marker's head: a dot on the axis, so the 1px line running
            down the chart reads as deliberate rather than as a stray gridline. */}
        {todayX === null ? null : (
          <div
            className="absolute bottom-0 z-10 size-1.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-[var(--accent)]"
            style={{ left: todayX }}
            title={t('roadmap:axis.today')}
            aria-hidden
          />
        )}
      </div>

      {/* Screen readers get the range as one sentence rather than 365 cells. */}
      <span className="sr-only">
        {t('roadmap:axis.rangeLabel', {
          start: geometry.rangeStart,
          end: geometry.rangeEnd,
        })}
      </span>
    </div>
  );
});

export default GanttTimeAxis;
