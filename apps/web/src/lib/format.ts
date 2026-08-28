/**
 * The formatting primitives every view shares — pure, locale-explicit, and
 * defined exactly once.
 *
 * ═══ WHY THIS FILE EXISTS ═════════════════════════════════════════════════
 *
 * Wave 3 built five views in parallel, and each grew its own copy of the same
 * four or five helpers. By the end of the wave `todayIso` existed FOUR times
 * (`board/board-meta.ts`, `backlog/backlog-dates.ts`, `tasks/task-dates.ts`,
 * `calendar/calendar-dates.ts`), "today as YYYY-MM-DD" under three different
 * names; `isOverdue` twice, with two signatures for the same one-line string
 * comparison; the `{year, month: 'short', day: 'numeric'}` option bag five
 * times; and `new Intl.DateTimeFormat(locale, {dateStyle:'medium',
 * timeStyle:'short'})` six times, four of them inline in page components.
 *
 * None of that was carelessness — the packages owned disjoint folders and
 * reaching into a sibling's would have coupled two agents' builds. WP3.8 is the
 * pass that puts the genuinely IDENTICAL ones here and leaves the view-specific
 * math where it belongs. `board-meta.formatDueDate` still lives in the board
 * folder, because "drop the year when it is this year" is a decision about how
 * much room a card has; `backlog-dates.formatDay` still lives in the backlog
 * folder, because sprint bounds are UTC-anchored and a local-midnight parse
 * would shift them a day.
 *
 * ═══ TWO RULES EVERYTHING HERE FOLLOWS ════════════════════════════════════
 *
 * **The locale is a PARAMETER, never read from the language policy.** These are
 * pure functions of their inputs, so a test can assert Arabic output without a
 * language store and a caller can format two locales in one render. The policy
 * lives in `lib/lang-policy.getIntlLocale()`, and the callers apply it.
 *
 * **A calendar day is a STRING, not a `Date`.** `YYYY-MM-DD` sorts
 * lexicographically in the same order it sorts chronologically, so comparisons
 * need no parse, no timezone and no chance of a due date flipping to overdue at
 * 01:00 for a reader west of Greenwich. `Date` appears only where `Intl` needs
 * one, and every parse anchors at LOCAL midnight (`new Date('2026-03-12')` is
 * UTC midnight, which renders as the 11th in the Americas).
 */

// ───────────────────────────────────────────────────────────────────────────
// Numbers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Story points, fractional-safe.
 *
 * The contract allows halves (`storyPointsSchema` is a plain number), so `0.5`
 * must render as `0.5` and not as `1` or `0`. `maximumFractionDigits: 2` covers
 * the halves and thirds teams actually use while keeping `3` as `3` rather than
 * `3.00`.
 *
 * Under Arabic the locale is `ar-u-nu-latn`, so the digits stay Western — see
 * `lib/lang-policy.getIntlLocale`. That is not a stylistic choice: the table and
 * the backlog chips are `tabular-nums` columns, and a digit-set swap between
 * rows breaks the alignment they depend on.
 */
export function formatPoints(points: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(points);
}

// ───────────────────────────────────────────────────────────────────────────
// Calendar days
// ───────────────────────────────────────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** A `Date` as the `YYYY-MM-DD` of its LOCAL calendar day. */
export function toIsoDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )}`;
}

/** Today as `YYYY-MM-DD` in the LOCAL zone — the calendar day the user is in. */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

/**
 * `YYYY-MM-DD` → a `Date` at LOCAL midnight, or `null`.
 *
 * REJECTS AN OVERFLOWING DAY. `new Date(2026, 1, 31)` does not throw — it rolls
 * forward to 3 March — so a naive parse turns `2026-02-31` into a real date and
 * the user's typo becomes a silently wrong due date. The round-trip check
 * catches it: a date that did not roll formats back to the string it came from.
 */
export function fromIsoDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;

  const match = ISO_DATE.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) return null;

  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return null;
  return toIsoDate(date) === value ? date : null;
}

/**
 * Is this calendar day in the past?
 *
 * A STRING comparison — see the note on calendar days at the top of the file.
 * Null-tolerant because most callers hold a nullable `dueDate` and "no due date"
 * is emphatically not overdue.
 */
export function isOverdue(dueDate: string | null | undefined, today: string = todayIso()): boolean {
  if (dueDate === null || dueDate === undefined) return false;
  return dueDate < today;
}

// ───────────────────────────────────────────────────────────────────────────
// Display
// ───────────────────────────────────────────────────────────────────────────

/**
 * One `Intl` formatter per (locale, options) pair, built once.
 *
 * `Intl.DateTimeFormat` construction is the expensive part — the format call is
 * cheap — and a virtualized table or a month grid formats the same shape a few
 * hundred times per render. Keyed on the serialized options so two option bags
 * cannot share a formatter.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat(locale, options);
  formatterCache.set(key, formatter);
  return formatter;
}

/** Test seam: the cache is module-global and would leak across locale cases. */
export function __clearFormatterCache(): void {
  formatterCache.clear();
}

/**
 * A calendar day as `12 Mar 2026`.
 *
 * The shape five separate files had each written out. Returns `''` rather than
 * `Invalid Date` for anything unparseable: an empty cell is a truthful "no
 * value", and the words "Invalid Date" in a table are a bug report waiting to
 * be filed about data that is merely absent.
 */
export function formatIsoDate(value: string | null | undefined, locale: string): string {
  const date = fromIsoDate(value);
  if (!date) return '';
  return dateFormatter(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

/** An ISO INSTANT as `12 Mar 2026, 14:05`. Empty for anything unparseable. */
export function formatDateTime(value: string | null | undefined, locale: string): string {
  if (value === null || value === undefined) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return dateFormatter(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

// ───────────────────────────────────────────────────────────────────────────
// Relative time
// ───────────────────────────────────────────────────────────────────────────

/** Largest unit first, so the first one that fits is the one to use. */
const RELATIVE_UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/**
 * The BUCKETING half of relative time, separated from the `Intl` call.
 *
 * Pure arithmetic over two instants, so the "which unit, how many" decision —
 * the part with an off-by-one in it — is testable without a locale. Months are
 * 30 days and years are 365; `Intl.RelativeTimeFormat` renders "last month"
 * either way, and a calendar-exact reading would cost a date library for a
 * string nobody measures against.
 */
export function relativeParts(
  from: Date,
  now: Date,
): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const elapsed = from.getTime() - now.getTime();

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= ms) return { value: Math.round(elapsed / ms), unit };
  }
  return { value: Math.round(elapsed / 1000), unit: 'second' };
}

/** An ISO instant as `3 days ago` / `in 2 hours`. Empty if unparseable. */
export function formatRelative(
  value: string | null | undefined,
  locale: string,
  now: Date = new Date(),
): string {
  if (value === null || value === undefined) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const { value: amount, unit } = relativeParts(date, now);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(amount, unit);
}
