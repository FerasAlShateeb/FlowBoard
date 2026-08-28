import { parseDay, type AxisSegment, type AxisUnit } from '@/components/gantt/useGanttGeometry';

/**
 * Axis and tooltip LABELS — the only place in the Gantt that knows a locale.
 *
 * The geometry deliberately returns date RANGES and never text (see
 * `useGanttGeometry`'s header). This module is the other half of that split: it
 * turns a segment into words, through `Intl` built on `getIntlLocale()`.
 *
 * TWO RULES, both from the plan:
 *
 * 1. **Latin digits everywhere.** `getIntlLocale()` returns `ar-u-nu-latn` for
 *    Arabic precisely so `Intl` keeps Western numerals — the axis is a
 *    `tabular-nums` grid read next to task keys (`FLOW-142`), and Eastern-Arabic
 *    digits would break the column alignment as well as the reading. The MONTH
 *    NAMES still localize, which is the half that matters.
 * 2. **`timeZone: 'UTC'`.** Every day in this view is a UTC-noon anchor
 *    (see `useGanttGeometry`), so formatting it in the viewer's own zone would
 *    render the previous or next day for anyone far enough east or west.
 *
 * FORMATTERS ARE CACHED. A week-zoom axis over a year is ~365 day cells, each
 * formatted on every render; constructing an `Intl.DateTimeFormat` is one of the
 * more expensive things in the browser's i18n surface, so they are memoised by
 * locale + option signature and reused.
 */

type FormatOptions = Intl.DateTimeFormatOptions;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: FormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
  formatterCache.set(key, created);
  return created;
}

function render(iso: string, locale: string, options: FormatOptions): string {
  return formatter(locale, options).format(parseDay(iso));
}

// ───────────────────────────────────────────────────────────────────────────
// Pieces
// ───────────────────────────────────────────────────────────────────────────

/** `3` — the day of the month, on its own. */
export function dayNumber(iso: string, locale: string): string {
  return render(iso, locale, { day: 'numeric' });
}

/** `M` / `ا` — the narrow weekday initial that sits above a day cell. */
export function weekdayNarrow(iso: string, locale: string): string {
  return render(iso, locale, { weekday: 'narrow' });
}

/** `Mar` — the abbreviated month. */
export function monthShort(iso: string, locale: string): string {
  return render(iso, locale, { month: 'short' });
}

/** `Mar 3` — abbreviated month and day. */
export function monthDay(iso: string, locale: string): string {
  return render(iso, locale, { month: 'short', day: 'numeric' });
}

/** `March 2026` — the month header. */
export function monthYear(iso: string, locale: string): string {
  return render(iso, locale, { month: 'long', year: 'numeric' });
}

/** `3 March 2026` — the long form used in bar tooltips. */
export function longDay(iso: string, locale: string): string {
  return render(iso, locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The 1-based quarter and the year of a day — the caller supplies the word. */
export function quarterOf(iso: string): { quarter: number; year: number } {
  return {
    quarter: Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1,
    year: Number(iso.slice(0, 4)),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Composed labels
// ───────────────────────────────────────────────────────────────────────────

/**
 * `Mar 3 – 9`, or `Mar 30 – Apr 5` when the week straddles a month boundary.
 *
 * The month is dropped from the second half when it would repeat — the header
 * row is 24px tall and the repetition costs the width the day numbers need.
 * `–` is an EN DASH, not a hyphen: this is a range, and the hyphen reads as
 * part of a date in a row full of numbers.
 */
export function dayRange(start: string, end: string, locale: string): string {
  if (start === end) return monthDay(start, locale);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${monthDay(start, locale)} – ${sameMonth ? dayNumber(end, locale) : monthDay(end, locale)}`;
}

/** The full range a bar covers, for its tooltip. */
export function longDayRange(start: string, end: string, locale: string): string {
  return start === end
    ? longDay(start, locale)
    : `${longDay(start, locale)} – ${longDay(end, locale)}`;
}

/**
 * The label for one LOWER axis cell.
 *
 * `week` cells show only the day number: at the month zoom the month is already
 * on the row above, and repeating it in every 84px cell is noise.
 */
export function lowerCellLabel(segment: AxisSegment, unit: AxisUnit, locale: string): string {
  switch (unit) {
    case 'day':
      return dayNumber(segment.unitStart, locale);
    case 'week':
      return dayNumber(segment.start, locale);
    case 'month':
      return monthShort(segment.unitStart, locale);
    case 'quarter':
      return String(quarterOf(segment.unitStart).quarter);
  }
}
