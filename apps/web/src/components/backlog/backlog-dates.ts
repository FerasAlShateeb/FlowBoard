/**
 * Calendar-day arithmetic and formatting for the sprint sections.
 *
 * THE RULE THIS FILE ENFORCES: a sprint boundary is a CALENDAR DAY
 * (`YYYY-MM-DD`), not an instant. Round-tripping one through `new Date(iso)` and
 * back through `toISOString()` parses it as UTC midnight and then re-reads it in
 * the LOCAL zone — so a planner in UTC-5 who picks the 8th sends the 7th. Every
 * function here therefore either works on the string's parts or pins the
 * formatter to UTC, and no `Date` object built from one of these strings is ever
 * read back in local time.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Two digits, zero-padded — the only formatting `YYYY-MM-DD` needs. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * A calendar day as a UTC instant, purely so `Intl` and day arithmetic have
 * something to chew on. `null` for anything that is not a `YYYY-MM-DD` string.
 */
function toUtcDate(iso: string): Date | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/**
 * Today, in the USER'S OWN zone — deliberately local rather than UTC: "today"
 * on a date picker means the day the person is living in, and reading UTC parts
 * would show tomorrow to anyone east of Greenwich after their evening.
 *
 * Re-exported rather than redefined: this was one of FOUR identical copies
 * before WP3.8.
 */
export { todayIso } from '@/lib/format';

/**
 * `iso` shifted by whole days, still as a calendar day.
 *
 * The arithmetic happens in UTC, where every day is exactly 86 400 000 ms — the
 * same sum in local time lands on 23:00 of the previous day across a DST
 * boundary, which is how "two weeks from Sunday" quietly becomes 13 days.
 */
export function addDaysIso(iso: string, days: number): string {
  const date = toUtcDate(iso);
  if (!date) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * One calendar day, formatted for reading.
 *
 * `timeZone: 'UTC'` is what pairs with {@link toUtcDate}: the instant was BUILT
 * as UTC midnight, so it has to be read back the same way or the formatter
 * shifts it a day. The locale carries `-u-nu-latn` under Arabic, so the numerals
 * stay Western (see `lib/lang-policy.ts`).
 */
export function formatDay(iso: string, locale: string): string {
  const date = toUtcDate(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}
