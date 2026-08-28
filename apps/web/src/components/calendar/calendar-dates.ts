import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

import type { Lang } from '@/lib/lang-policy';

/**
 * The calendar view's date substrate — every other calendar module is written
 * against the types and helpers here.
 *
 * ═══ WHY A STRING IS THE DOMAIN TYPE ═══════════════════════════════════════
 *
 * A FlowBoard task carries `startDate` / `dueDate` as `YYYY-MM-DD` — a CALENDAR
 * DAY, not an instant. There is no time and no zone in that value, and the
 * moment it becomes a `Date` the runtime attaches both, which is where calendar
 * bugs are born ("due 1 March" rendering on 28 February for anyone west of
 * Greenwich). So the calendar keeps the string as its identity type
 * ({@link DayKey}), and a `Date` exists only inside these functions, for the
 * few seconds of arithmetic date-fns is doing.
 *
 * Two properties fall out of that and are relied on everywhere:
 *
 * 1. **Comparison is lexicographic.** `'2026-03-08' < '2026-03-09'` is true as
 *    a plain string compare, because the format is fixed-width and
 *    big-endian. Range checks, overdue checks and span clipping are therefore
 *    string comparisons — no parsing, no allocation, no zone.
 * 2. **Equality is identity.** Two tasks due the same day have equal keys, so a
 *    day cell is a `Map` lookup rather than a per-task date comparison.
 *
 * ═══ NOON ANCHORING ════════════════════════════════════════════════════════
 *
 * {@link parseDayKey} builds a `Date` at **12:00 LOCAL**, never midnight and
 * never UTC. Both halves matter:
 *
 * - **Noon, not midnight** — DST. On a spring-forward day, adding "one day" to
 *   a midnight anchor lands on 23:00 the SAME day in some zones (the wall clock
 *   moved, the instant did not), and formatting it yields a repeated day in the
 *   grid. From noon, a ±1 h wall-clock shift cannot cross either midnight, so
 *   `addDays` is exact on every day of every year.
 * - **Local, not UTC** — agreement with date-fns. `startOfWeek`, `getDay`,
 *   `addDays` and `format` all read the LOCAL calendar fields of a `Date`. An
 *   anchor at UTC noon is a different local day in any zone past UTC+12, so
 *   those functions would answer about the wrong day. (The work-package brief
 *   said "UTC-noon"; local noon is the same DST-proofing with the timezone
 *   mismatch removed, and `toDayKey` round-trips it exactly.)
 *
 * ═══ THE WEEK START ════════════════════════════════════════════════════════
 *
 * See {@link weekStartFor} — a documented product decision, not a guess from
 * `Intl`.
 */

/** A calendar day as the API spells it: `YYYY-MM-DD`. */
export type DayKey = string;

/**
 * The first column of the grid, as a `date-fns` weekday index (0 = Sunday).
 * Only the two values FlowBoard actually uses are representable.
 */
export type WeekStart = 0 | 6;

/** The two grid shapes the calendar page can render. */
export type CalendarView = 'month' | 'week';

/** An inclusive span of calendar days. Both ends are real, renderable days. */
export interface DayRange {
  from: DayKey;
  to: DayKey;
}

export const DAYS_PER_WEEK = 7;

/**
 * The month grid is ALWAYS six rows.
 *
 * A month needs four to six week rows depending on its length and which weekday
 * it opens on. Rendering the minimum would change the grid's height (and every
 * cell's) from month to month, so paging through the year would make the whole
 * page jump — and a cell that is 20% shorter in February shows fewer chips
 * before it starts hiding them behind "+n more". A fixed six rows costs one
 * mostly-outside row in short months and buys a stable layout.
 */
export const MONTH_GRID_WEEKS = 6;

/** 6 × 7 — the number of day cells in a month grid. */
export const MONTH_GRID_DAYS = MONTH_GRID_WEEKS * DAYS_PER_WEEK;

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A known Sunday, used only as the seed for {@link weekdayNames}. Any Sunday
 * would do; this one is deliberately mid-winter and mid-week-of-month so no
 * locale's "special" formatting (a month name that changes at year boundaries,
 * say) can leak into a weekday label.
 */
const WEEKDAY_SEED = new Date(2024, 0, 7, 12, 0, 0, 0);

/**
 * Which weekday the grid opens on, per UI language.
 *
 * **English → Sunday (0). Arabic → Saturday (6).** These are the conventions of
 * the two audiences: the US-English calendar starts on Sunday, and the working
 * week across the Arab world runs Sunday–Thursday, so its calendars open on
 * Saturday — the first day of the weekend, exactly as Sunday is in the US
 * layout.
 *
 * WHY NOT `Intl.Locale.prototype.getWeekInfo()`. It answers for the REGION, and
 * FlowBoard's locale carries none: the app's two tags are `en-US` and
 * `ar-u-nu-latn`. Region-guessing from the browser would also make the grid
 * shift under a user who switched their OS locale, which is not a decision this
 * view should be making implicitly. One explicit map, documented here, is the
 * honest version — and the place to add a per-user preference later.
 */
export function weekStartFor(lang: Lang): WeekStart {
  return lang === 'ar' ? 6 : 0;
}

/** True for a well-formed `YYYY-MM-DD` string. */
export function isDayKey(value: unknown): value is DayKey {
  return typeof value === 'string' && DAY_KEY_PATTERN.test(value);
}

/**
 * `YYYY-MM-DD` → a `Date` at 12:00 local on that calendar day.
 *
 * The inverse of {@link toDayKey} for every real date. See the module note on
 * noon anchoring for why the time is what it is.
 */
export function parseDayKey(key: DayKey): Date {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/** A `Date` → the `YYYY-MM-DD` of its LOCAL calendar day. */
export function toDayKey(date: Date): DayKey {
  return format(date, 'yyyy-MM-dd');
}

/** Today, as a day key. Takes the clock as an argument so tests can pin it. */
export function todayKey(now: Date = new Date()): DayKey {
  return toDayKey(now);
}

/** `key` shifted by whole calendar days — negative goes back. DST-safe. */
export function addDayKeys(key: DayKey, days: number): DayKey {
  return toDayKey(addDays(parseDayKey(key), days));
}

/** Whole calendar days from `b` to `a` (`a - b`). Same day → 0. */
export function diffDayKeys(a: DayKey, b: DayKey): number {
  return differenceInCalendarDays(parseDayKey(a), parseDayKey(b));
}

/** `-1 | 0 | 1`, ordering two day keys. Pure string compare — see module note. */
export function compareDayKeys(a: DayKey, b: DayKey): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** True when both keys land in the same calendar month of the same year. */
export function isSameMonth(a: DayKey, b: DayKey): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** True when `key` falls inside `range` (both ends inclusive). */
export function isWithinRange(key: DayKey, range: DayRange): boolean {
  return key >= range.from && key <= range.to;
}

/**
 * The 42 day keys of the month grid containing `cursor`, in reading order.
 *
 * Starts at the {@link weekStartFor} weekday on or before the 1st, so the first
 * row carries the tail of the previous month; the last row carries the head of
 * the next. Those "outside" days are rendered dimmed rather than blank — a task
 * due on the 1st of next month is genuinely visible from the last row of this
 * one, which is most of the value of showing them.
 */
export function monthGridDays(cursor: DayKey, weekStart: WeekStart): DayKey[] {
  const first = startOfWeek(startOfMonth(parseDayKey(cursor)), { weekStartsOn: weekStart });
  return Array.from({ length: MONTH_GRID_DAYS }, (_, index) => toDayKey(addDays(first, index)));
}

/** {@link monthGridDays}, split into the six rows the grid renders. */
export function monthGridWeeks(cursor: DayKey, weekStart: WeekStart): DayKey[][] {
  const days = monthGridDays(cursor, weekStart);
  return Array.from({ length: MONTH_GRID_WEEKS }, (_, week) =>
    days.slice(week * DAYS_PER_WEEK, week * DAYS_PER_WEEK + DAYS_PER_WEEK),
  );
}

/** The seven day keys of the week containing `cursor`. */
export function weekGridDays(cursor: DayKey, weekStart: WeekStart): DayKey[] {
  const first = startOfWeek(parseDayKey(cursor), { weekStartsOn: weekStart });
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) => toDayKey(addDays(first, index)));
}

/** The days a view renders, for one cursor. */
export function gridDays(cursor: DayKey, view: CalendarView, weekStart: WeekStart): DayKey[] {
  return view === 'month' ? monthGridDays(cursor, weekStart) : weekGridDays(cursor, weekStart);
}

/** First and last day of a non-empty, ordered day list. */
export function rangeOf(days: readonly DayKey[]): DayRange {
  const from = days.at(0);
  const to = days.at(-1);
  if (from === undefined || to === undefined) {
    throw new Error('rangeOf: expected at least one day');
  }
  return { from, to };
}

/**
 * The prev/next buttons.
 *
 * The month step normalizes to the 1st before adding, so repeated clicks cannot
 * drift: `addMonths` clamps 31 Jan + 1 month to 28 Feb, and stepping on from
 * THAT would give 28 Mar. Anchoring on the 1st keeps a month step reversible.
 */
export function shiftCursor(cursor: DayKey, view: CalendarView, delta: number): DayKey {
  if (view === 'month') {
    return toDayKey(addMonths(startOfMonth(parseDayKey(cursor)), delta));
  }
  return addDayKeys(cursor, delta * DAYS_PER_WEEK);
}

// ───────────────────────────────────────────────────────────────────────────
// Intl formatting
// ───────────────────────────────────────────────────────────────────────────

/**
 * `Intl.DateTimeFormat` construction is one of the more expensive things in the
 * standard library, and a month grid formats 42 day numbers on every render.
 * The cache is keyed by locale + options, so a language switch simply misses it
 * once and repopulates.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(locale, options);
  formatterCache.set(key, formatter);
  return formatter;
}

/**
 * The seven weekday headers, in grid order for the given week start.
 *
 * Localized by `Intl`, which is the whole reason the calendar does not carry
 * weekday strings in its catalog: `ar-u-nu-latn` yields السبت / الأحد … for
 * free, and any future language does too.
 */
export function weekdayNames(
  weekStart: WeekStart,
  locale: string,
  weekday: 'short' | 'narrow' | 'long' = 'short',
): string[] {
  const formatter = formatterFor(locale, { weekday });
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
    formatter.format(addDays(WEEKDAY_SEED, (weekStart + index) % DAYS_PER_WEEK)),
  );
}

/** `March 2026` / `مارس 2026` — the header label of the month view. */
export function formatMonthYear(key: DayKey, locale: string): string {
  return formatterFor(locale, { month: 'long', year: 'numeric' }).format(parseDayKey(key));
}

/** The bare day number a cell prints. Latin digits — see `lib/lang-policy`. */
export function formatDayNumber(key: DayKey, locale: string): string {
  return formatterFor(locale, { day: 'numeric' }).format(parseDayKey(key));
}

/** `8 Mar 2026` — chip tooltips and tray rows. */
export function formatMediumDate(key: DayKey, locale: string): string {
  return formatterFor(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    parseDayKey(key),
  );
}

/** `Sunday, 8 March 2026` — the accessible name of a day cell. */
export function formatFullDate(key: DayKey, locale: string): string {
  return formatterFor(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parseDayKey(key));
}

/**
 * The header label of the week view: `1 – 7 Mar 2026`.
 *
 * `formatRange` collapses the parts the two ends share, which is what makes the
 * label short enough to sit next to the nav buttons. It is ES2021 and present
 * in every browser this app supports; the `catch` covers exotic environments
 * (and jsdom builds without full ICU) by falling back to two full dates.
 */
export function formatDayRange(range: DayRange, locale: string): string {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const formatter = formatterFor(locale, options);
  try {
    return formatter.formatRange(parseDayKey(range.from), parseDayKey(range.to));
  } catch {
    return `${formatter.format(parseDayKey(range.from))} – ${formatter.format(parseDayKey(range.to))}`;
  }
}
