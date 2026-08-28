import { useMemo } from 'react';
import { addDays as addDaysFns } from 'date-fns';

/**
 * THE GANTT'S SINGLE SOURCE OF TRUTH for every date ↔ pixel conversion.
 *
 * Plan §Risks 1: "all geometry via one pure, unit-tested `useGanttGeometry`;
 * bars and arrows share it". Nothing else in `components/gantt/**` is allowed to
 * multiply a day count by a pixel width. The axis, the weekend shading, the
 * grid lines, the bars, the drag preview, the dependency arrows and the today
 * line all read the SAME object, which is what stops an arrow from pointing two
 * pixels left of the bar it is supposed to touch.
 *
 * ═══ THE DATE MODEL ════════════════════════════════════════════════════════
 *
 * A day is a `YYYY-MM-DD` STRING, everywhere. That is what the API sends
 * (`isoDate`), what it accepts back in a PATCH, and what a Gantt actually
 * reasons about — a bar covers whole calendar days, never instants.
 *
 * Internally a day is materialised as the `Date` at **12:00 UTC** on that day,
 * and read back with UTC accessors only. Two bugs die there:
 *
 *   1. **DST.** A local-midnight anchor lands exactly on the discontinuity in
 *      the zones that shift at 00:00 (America/Santiago, Asia/Beirut, …), so
 *      "add one day" can produce the same calendar day twice or skip one.
 *      Noon is 12 hours from either edge, so a ±1h shift cannot cross a day
 *      boundary.
 *   2. **The far east.** UTC noon is still the same UTC day at every offset
 *      from −12 to +14, so `getUTCDate()` reads back the day we put in even in
 *      Kiritimati (+14) where the LOCAL calendar has already turned over.
 *
 * `date-fns`'s `addDays` is used for the increment because it steps the LOCAL
 * calendar, which is DST-correct by construction; the noon anchor then absorbs
 * the ±1h the step may carry, so the UTC day still advances by exactly one.
 * Everything else — week/month/quarter starts, differences — is computed on UTC
 * accessors directly rather than through date-fns's local-calendar helpers,
 * because at offsets beyond +12 those would answer for the wrong day.
 *
 * ═══ PURITY ═══════════════════════════════════════════════════════════════
 *
 * {@link createGanttGeometry} is a plain function of a plain options object:
 * no React, no DOM, no locale, no `Date.now()`. `useGanttGeometry` is a
 * `useMemo` around it and nothing more. That is what lets the whole of this
 * file be exercised in the DOM-free default Vitest environment.
 *
 * LOCALE IS NOT GEOMETRY. The axis returns date RANGES, never labels — month
 * names and day numbers are formatted by `gantt-format.ts` through
 * `Intl` + `getIntlLocale()`. Keeping the two apart is what lets the axis be an
 * `dir="ltr"` island (plan §Risks 5) with localized words and Western digits.
 */

// ───────────────────────────────────────────────────────────────────────────
// Day arithmetic on `YYYY-MM-DD`
// ───────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/**
 * The week starts on MONDAY (ISO-8601), in every locale.
 *
 * A deliberate simplification, not an oversight: the time axis is a shared
 * planning grid, and a week that started on Saturday for Arabic readers and
 * Monday for English ones would place the same task under two different week
 * headers depending on who was looking — and would move every gridline when the
 * language switched. Same reasoning as the Western-digit policy in
 * `lib/lang-policy`: the words localize, the grid does not.
 */
const WEEK_STARTS_ON = 1;

/**
 * Which UTC weekdays are shaded as "weekend" (Saturday, Sunday).
 *
 * Also deliberately fixed rather than locale-derived, for the same reason as
 * {@link WEEK_STARTS_ON}. Noted in the report as a known simplification for a
 * region where Friday–Saturday is the working week's edge.
 */
const WEEKEND_DAYS: readonly number[] = [0, 6];

/** `YYYY-MM-DD` → the `Date` at 12:00 UTC on that day. */
export function parseDay(iso: string): Date {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

/** A UTC-anchored `Date` → `YYYY-MM-DD`, read with UTC accessors only. */
export function formatDay(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `addDays('2026-03-05', 3)` → `'2026-03-08'`. Negative counts step back. */
export function addDays(iso: string, days: number): string {
  return formatDay(addDaysFns(parseDay(iso), days));
}

/**
 * Whole calendar days from `from` to `to` — negative when `to` precedes `from`.
 *
 * Both anchors are UTC noon, so the difference is an exact multiple of 24h even
 * across a DST boundary; the `round` only guards against float drift on very
 * large spans.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS);
}

/**
 * TODAY, as the user's LOCAL calendar day.
 *
 * Local rather than UTC on purpose: "today" is a human word, and someone in
 * Auckland at 09:00 on the 6th is not looking at the 5th. `now` is injectable
 * so the tests never depend on the wall clock.
 */
export function todayDay(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Monday of the week containing `iso`. */
export function startOfWeekDay(iso: string): string {
  const weekday = parseDay(iso).getUTCDay();
  return addDays(iso, -((weekday - WEEK_STARTS_ON + 7) % 7));
}

/** The 1st of the month containing `iso`. */
export function startOfMonthDay(iso: string): string {
  return `${iso.slice(0, 8)}01`;
}

/** The 1st of January / April / July / October containing `iso`. */
export function startOfQuarterDay(iso: string): string {
  const month = Number(iso.slice(5, 7));
  const first = Math.floor((month - 1) / 3) * 3 + 1;
  return `${iso.slice(0, 4)}-${String(first).padStart(2, '0')}-01`;
}

/**
 * Adds whole months to a MONTH-START day (`YYYY-MM-01`).
 *
 * Restricted to month starts on purpose — that is the only place the axis needs
 * it, and it sidesteps the "31 January + 1 month" question entirely rather than
 * answering it one way here and another way somewhere else.
 */
export function addMonthsToMonthStart(iso: string, months: number): string {
  const total = Number(iso.slice(0, 4)) * 12 + (Number(iso.slice(5, 7)) - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/** True for a Saturday or a Sunday. */
export function isWeekendDay(iso: string): boolean {
  return WEEKEND_DAYS.includes(parseDay(iso).getUTCDay());
}

// ───────────────────────────────────────────────────────────────────────────
// Axis units
// ───────────────────────────────────────────────────────────────────────────

/** The calendar periods the axis can be divided into. */
export type AxisUnit = 'day' | 'week' | 'month' | 'quarter';

/** The first day of the `unit` period containing `iso`. */
export function unitStart(iso: string, unit: AxisUnit): string {
  switch (unit) {
    case 'day':
      return iso;
    case 'week':
      return startOfWeekDay(iso);
    case 'month':
      return startOfMonthDay(iso);
    case 'quarter':
      return startOfQuarterDay(iso);
  }
}

/** The first day of the period AFTER the one starting at `iso`. */
export function unitNext(iso: string, unit: AxisUnit): string {
  switch (unit) {
    case 'day':
      return addDays(iso, 1);
    case 'week':
      return addDays(iso, 7);
    case 'month':
      return addMonthsToMonthStart(iso, 1);
    case 'quarter':
      return addMonthsToMonthStart(iso, 3);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Zoom
// ───────────────────────────────────────────────────────────────────────────

/** The three zoom levels, coarsest last — also the order of the toggle. */
export const ZOOM_LEVELS = ['week', 'month', 'quarter'] as const;
export type GanttZoom = (typeof ZOOM_LEVELS)[number];

/**
 * Pixels per DAY at each zoom — the one number the whole chart is scaled by.
 *
 * Tuned so the LOWER axis cell (the thing a user actually reads) lands in a
 * comfortable 36–120px band at every level:
 *
 *   week    36px/day → a 36px day cell   (two digits fit; a bar is draggable)
 *   month   12px/day → an 84px week cell (a `Mar 3` label fits)
 *   quarter  4px/day → a ~122px month cell
 *
 * Below ~4px/day a bar for a one-day task stops being clickable, which is why
 * there is no "year" zoom.
 */
export const DAY_WIDTH: Record<GanttZoom, number> = {
  week: 36,
  month: 12,
  quarter: 4,
};

/** Which calendar periods each zoom's two header rows are cut into. */
export const AXIS_UNITS: Record<GanttZoom, { upper: AxisUnit; lower: AxisUnit }> = {
  week: { upper: 'week', lower: 'day' },
  month: { upper: 'month', lower: 'week' },
  quarter: { upper: 'quarter', lower: 'month' },
};

/**
 * The period the derived range is snapped OUT to, per zoom.
 *
 * Always the LOWER unit: snapping to the cell the user sees is what guarantees
 * every lower cell is whole. The upper row is free to be clipped at the edges
 * (a range that starts mid-March shows a short March segment), which is normal
 * and reads correctly as long as the label comes from the unclipped period —
 * see {@link AxisSegment.unitStart}.
 */
const RANGE_SNAP_UNIT: Record<GanttZoom, AxisUnit> = {
  week: 'week',
  month: 'week',
  quarter: 'month',
};

/** Days of breathing room added on each side of the tasks' own extent. */
const RANGE_PADDING_DAYS: Record<GanttZoom, number> = {
  week: 7,
  month: 14,
  quarter: 45,
};

/** The floor on the visible range (plan: "min 8 weeks"). */
export const MIN_RANGE_DAYS = 56;

// ───────────────────────────────────────────────────────────────────────────
// Row / chart dimensions
// ───────────────────────────────────────────────────────────────────────────

/**
 * Vertical dimensions, exported so the sidebar and the canvas cannot drift.
 *
 * They are ONE set of numbers because the two panes are separate scroll boxes
 * rendering the same virtualizer window: a row that is 32px on one side and
 * 34px on the other would shear the whole chart a little further with every
 * row down the list.
 */
export const ROW_HEIGHT = 32;
/** Height of a normal task bar. */
export const BAR_HEIGHT = 16;
/** Epic bars are thicker — they are a roll-up, not a task you can drag. */
export const EPIC_BAR_HEIGHT = 22;
/** The two stacked header rows of the time axis. */
export const AXIS_ROW_HEIGHT = 24;
export const AXIS_HEIGHT = AXIS_ROW_HEIGHT * 2;
/** The fixed sidebar column. */
export const SIDEBAR_WIDTH = 280;

// ───────────────────────────────────────────────────────────────────────────
// Shapes
// ───────────────────────────────────────────────────────────────────────────

/** Anything that can be drawn as a bar — structurally a `TaskSummary`. */
export interface DatedSpan {
  startDate: string | null;
  dueDate: string | null;
}

/** A bar's horizontal placement, plus the concrete span it resolved to. */
export interface BarRect {
  x: number;
  width: number;
  /** First day the bar covers. */
  start: string;
  /** Last day the bar covers, INCLUSIVE. */
  end: string;
  /** Whole days covered — always ≥ 1. */
  days: number;
}

/** One cell (lower row) or label group (upper row) of the time axis. */
export interface AxisSegment {
  /** Stable React key — the UNCLIPPED period start. */
  key: string;
  /**
   * The period's real first day, IGNORING the range clip.
   *
   * The label must come from here rather than from {@link start}: a range that
   * opens on 12 March still belongs to March, and formatting the clipped start
   * would be right by accident for months and wrong for quarters.
   */
  unitStart: string;
  /** First day actually drawn (clipped to the range). */
  start: string;
  /** Last day actually drawn, inclusive (clipped to the range). */
  end: string;
  x: number;
  width: number;
  /** False when the range cut this period short at either edge. */
  whole: boolean;
}

/** Both header rows, plus which period each was cut into. */
export interface AxisSegments {
  upper: AxisSegment[];
  lower: AxisSegment[];
  upperUnit: AxisUnit;
  lowerUnit: AxisUnit;
}

/** A shaded weekend run — one band per contiguous Saturday+Sunday pair. */
export interface WeekendBand {
  key: string;
  x: number;
  width: number;
}

/** The options {@link createGanttGeometry} is a pure function of. */
export interface GanttGeometryOptions {
  zoom: GanttZoom;
  /** Inclusive first day of the chart. */
  rangeStart: string;
  /** Inclusive last day of the chart. */
  rangeEnd: string;
  /** Injected so the today line is testable; defaults to the local today. */
  today?: string;
}

/** Everything the chart is drawn from. */
export interface GanttGeometry {
  zoom: GanttZoom;
  rangeStart: string;
  rangeEnd: string;
  dayWidth: number;
  /** Days in the range, inclusive of both ends. */
  totalDays: number;
  /** `totalDays * dayWidth` — the canvas's scrollable width. */
  totalWidth: number;
  today: string;
  /** Centre of today's column, or `null` when today is outside the range. */
  todayX: number | null;
  axis: AxisSegments;
  weekendBands: WeekendBand[];
  /** Left edge of that day's column. Negative / overflowing for outside days. */
  dateToX: (iso: string) => number;
  /** Right edge of that day's column — i.e. `dateToX(iso) + dayWidth`. */
  dateToEndX: (iso: string) => number;
  /** Pixel → day, SNAPPED down to the day it lands in and clamped to range. */
  xToDate: (px: number) => string;
  /** `{x, width}` for a task's span, or `null` when it has no dates at all. */
  barRect: (span: DatedSpan) => BarRect | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Range derivation
// ───────────────────────────────────────────────────────────────────────────

/**
 * The window the chart covers, derived from the tasks themselves.
 *
 * FOUR STEPS, in this order — the order matters, because each one can only
 * widen the range and the snap has to be last:
 *
 *   1. **Extent.** min/max over every date any task carries. A task with only a
 *      due date contributes that date at both ends. With no dated task at all
 *      the window is centred on `today`, so an empty roadmap still draws a
 *      readable grid with the today line on it.
 *   2. **Padding.** Zoom-dependent breathing room, so the first bar does not
 *      start flush against the left edge.
 *   3. **Floor.** At least {@link MIN_RANGE_DAYS} (8 weeks), extended at the
 *      END — a project with three tasks in one week should still show the weeks
 *      after it, which is where the unplanned work is going to land.
 *   4. **Snap.** Out to whole lower-unit cells, so no axis cell is half drawn.
 */
export function deriveRange(
  spans: readonly DatedSpan[],
  zoom: GanttZoom,
  today: string = todayDay(),
): { rangeStart: string; rangeEnd: string } {
  let min: string | null = null;
  let max: string | null = null;

  for (const span of spans) {
    for (const value of [span.startDate, span.dueDate]) {
      if (value === null) continue;
      if (min === null || value < min) min = value;
      if (max === null || value > max) max = value;
    }
  }

  // `YYYY-MM-DD` sorts lexicographically exactly as it sorts chronologically,
  // which is why the comparisons above need no parsing at all.
  const padding = RANGE_PADDING_DAYS[zoom];
  let start = addDays(min ?? today, -padding);
  let end = addDays(max ?? today, padding);

  const span = daysBetween(start, end) + 1;
  if (span < MIN_RANGE_DAYS) end = addDays(end, MIN_RANGE_DAYS - span);

  const snapUnit = RANGE_SNAP_UNIT[zoom];
  start = unitStart(start, snapUnit);
  // One day BEFORE the next period starts = the last day of the period `end`
  // falls in, which is the inclusive end the whole module speaks in.
  end = addDays(unitNext(unitStart(end, snapUnit), snapUnit), -1);

  return { rangeStart: start, rangeEnd: end };
}

// ───────────────────────────────────────────────────────────────────────────
// Segment generation
// ───────────────────────────────────────────────────────────────────────────

/**
 * Cuts `[rangeStart, rangeEnd]` into `unit` periods, clipped at both edges.
 *
 * ONE loop serves all four units and both header rows — which is what keeps the
 * month row and the week row provably consistent with each other instead of
 * being two hand-written iterations that agree until a leap year.
 */
function cutIntoSegments(
  rangeStart: string,
  rangeEnd: string,
  unit: AxisUnit,
  xOf: (iso: string) => number,
  dayWidth: number,
): AxisSegment[] {
  const segments: AxisSegment[] = [];

  for (
    let periodStart = unitStart(rangeStart, unit);
    periodStart <= rangeEnd;
    periodStart = unitNext(periodStart, unit)
  ) {
    const periodEnd = addDays(unitNext(periodStart, unit), -1);
    const start = periodStart < rangeStart ? rangeStart : periodStart;
    const end = periodEnd > rangeEnd ? rangeEnd : periodEnd;
    const x = xOf(start);

    segments.push({
      key: periodStart,
      unitStart: periodStart,
      start,
      end,
      x,
      width: (daysBetween(start, end) + 1) * dayWidth,
      whole: periodStart === start && periodEnd === end,
    });
  }

  return segments;
}

/** Contiguous Saturday+Sunday runs, as bands to shade. */
function weekendBandsIn(
  rangeStart: string,
  rangeEnd: string,
  xOf: (iso: string) => number,
  dayWidth: number,
): WeekendBand[] {
  const bands: WeekendBand[] = [];
  let runStart: string | null = null;

  for (let day = rangeStart; day <= rangeEnd; day = addDays(day, 1)) {
    const weekend = isWeekendDay(day);
    if (weekend && runStart === null) runStart = day;
    if (!weekend && runStart !== null) {
      bands.push({
        key: runStart,
        x: xOf(runStart),
        width: daysBetween(runStart, day) * dayWidth,
      });
      runStart = null;
    }
  }

  if (runStart !== null) {
    bands.push({
      key: runStart,
      x: xOf(runStart),
      width: (daysBetween(runStart, rangeEnd) + 1) * dayWidth,
    });
  }

  return bands;
}

// ───────────────────────────────────────────────────────────────────────────
// The geometry itself
// ───────────────────────────────────────────────────────────────────────────

/**
 * Builds the geometry. PURE — same options in, structurally identical answer
 * out, no clock and no DOM.
 */
export function createGanttGeometry(options: GanttGeometryOptions): GanttGeometry {
  const { zoom, rangeStart, rangeEnd } = options;
  const today = options.today ?? todayDay();

  const dayWidth = DAY_WIDTH[zoom];
  const totalDays = Math.max(1, daysBetween(rangeStart, rangeEnd) + 1);
  const totalWidth = totalDays * dayWidth;

  const dateToX = (iso: string): number => daysBetween(rangeStart, iso) * dayWidth;
  const dateToEndX = (iso: string): number => dateToX(iso) + dayWidth;

  /**
   * Pixel → day. SNAP RULE: the day whose COLUMN contains `px`, i.e. floor —
   * anywhere inside a 36px Tuesday column reads as Tuesday, and the boundary at
   * exactly `x` belongs to the day starting there. Clamped to the range so a
   * drag flung past either edge resolves to the first/last visible day rather
   * than to a date the chart cannot draw.
   */
  const xToDate = (px: number): string => {
    const index = Math.floor(px / dayWidth);
    const clamped = index < 0 ? 0 : index > totalDays - 1 ? totalDays - 1 : index;
    return addDays(rangeStart, clamped);
  };

  /**
   * A task's bar.
   *
   * INCLUSIVE END: a task from the 3rd to the 5th covers THREE days, so the bar
   * is `3 * dayWidth` wide and its right edge is the right edge of the 5th's
   * column. Off-by-one here is the single most visible bug a Gantt can have —
   * every bar ends a day early and every dependency arrow starts in the wrong
   * column — which is why it is stated here once and nowhere else.
   *
   * SINGLE-DATED tasks get a one-day bar on the day they do have: a start with
   * no due date is a thing that begins and has not been given an end, and
   * drawing it as a point on that day is the honest rendering.
   *
   * INVERTED dates (due before start) also collapse to one day at the start,
   * rather than throwing or drawing a negative-width bar. It is bad data, not a
   * crash, and the user needs to see the task to fix it.
   */
  const barRect = (span: DatedSpan): BarRect | null => {
    const from = span.startDate ?? span.dueDate;
    const to = span.dueDate ?? span.startDate;
    if (from === null || to === null) return null;

    const days = Math.max(1, daysBetween(from, to) + 1);
    return {
      x: dateToX(from),
      width: days * dayWidth,
      start: from,
      end: addDays(from, days - 1),
      days,
    };
  };

  const units = AXIS_UNITS[zoom];

  return {
    zoom,
    rangeStart,
    rangeEnd,
    dayWidth,
    totalDays,
    totalWidth,
    today,
    // The CENTRE of today's column, not its left edge: the today line is 1px
    // and a line on a column boundary reads as a gridline rather than as
    // "here is now".
    todayX: today >= rangeStart && today <= rangeEnd ? dateToX(today) + dayWidth / 2 : null,
    axis: {
      upper: cutIntoSegments(rangeStart, rangeEnd, units.upper, dateToX, dayWidth),
      lower: cutIntoSegments(rangeStart, rangeEnd, units.lower, dateToX, dayWidth),
      upperUnit: units.upper,
      lowerUnit: units.lower,
    },
    // Weekend shading is dropped below 8px/day: at the quarter zoom a weekend
    // is an 8px stripe every 28px, which reads as noise over the whole chart
    // rather than as information.
    weekendBands: dayWidth >= 8 ? weekendBandsIn(rangeStart, rangeEnd, dateToX, dayWidth) : [],
    dateToX,
    dateToEndX,
    xToDate,
    barRect,
  };
}

/**
 * The React face of {@link createGanttGeometry} — a `useMemo` and nothing else.
 *
 * Memoised on the PRIMITIVE inputs rather than on an options object, so a
 * parent that rebuilds `{zoom, rangeStart, rangeEnd}` inline every render still
 * gets one stable geometry — and every `React.memo` on the rows below it keeps
 * working.
 */
export function useGanttGeometry(options: GanttGeometryOptions): GanttGeometry {
  const { zoom, rangeStart, rangeEnd, today } = options;
  return useMemo(
    () => createGanttGeometry({ zoom, rangeStart, rangeEnd, today }),
    [zoom, rangeStart, rangeEnd, today],
  );
}
