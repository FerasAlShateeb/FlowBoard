/**
 * Number and date formatting for the six charts — the one place a report string
 * is produced.
 *
 * DIGITS STAY LATIN, in every language. `getIntlLocale()` returns
 * `ar-u-nu-latn` for Arabic precisely so that `١٤` never appears on an axis:
 * the charts are `tabular-nums` grids read next to task keys (`FB-142`) and
 * point totals, and a digit swap breaks both the alignment and the comparison
 * (see `lib/lang-policy`). The month NAMES localize; the numerals do not.
 *
 * FORMATTERS ARE MEMOIZED PER LOCALE. `new Intl.DateTimeFormat(...)` is one of
 * the more expensive constructors in the platform, and an axis tick formatter
 * is called once per tick per render — building one inside the callback made
 * the cumulative-flow chart measurably janky on a 56-day window.
 *
 * Pure module apart from {@link useChartFormat}, which only binds the language
 * signal so a switch to Arabic re-renders the axes.
 */
import { getIntlLocale, useLang } from '@/lib/lang-policy';

import { parseIsoDate } from './report-range';

interface FormatterSet {
  day: Intl.DateTimeFormat;
  dayLong: Intl.DateTimeFormat;
  integer: Intl.NumberFormat;
  decimal: Intl.NumberFormat;
}

const cache = new Map<string, FormatterSet>();

function formattersFor(locale: string): FormatterSet {
  const cached = cache.get(locale);
  if (cached) return cached;

  const set: FormatterSet = {
    // The axis tick: as short as a day label can be and still be unambiguous.
    day: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }),
    // The tooltip heading: the same day with its year, because a report window
    // can straddle a new year and "Jan 3" alone would be a riddle.
    dayLong: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
    integer: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    // Story points are halves and thirds often enough that rounding them to
    // whole numbers would make a burndown lie by a point.
    decimal: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
  };
  cache.set(locale, set);
  return set;
}

/** `2026-08-27` → `Aug 27` / `27 أغسطس`. Unparseable input passes through. */
export function formatDayTick(iso: string, locale: string): string {
  const date = parseIsoDate(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formattersFor(locale).day.format(date);
}

/** `2026-08-27` → `Aug 27, 2026`. The tooltip heading form. */
export function formatDayFull(iso: string, locale: string): string {
  const date = parseIsoDate(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formattersFor(locale).dayLong.format(date);
}

/**
 * An INSTANT (`isoDateTime`, e.g. a task's `resolvedAt`) → a short day label.
 *
 * Distinct from {@link formatDayTick} on purpose: an instant is a real point in
 * time and `new Date(iso)` is the correct parse for it, whereas a calendar day
 * must not go through UTC at all.
 */
export function formatInstantTick(value: number | string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return formattersFor(locale).day.format(date);
}

/** Whole-number formatting — task counts, sprint counts, people. */
export function formatCount(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '—';
  return formattersFor(locale).integer.format(value);
}

/** One-decimal formatting — story points, hours, percentiles. */
export function formatDecimal(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '—';
  return formattersFor(locale).decimal.format(value);
}

/** The formatter bundle, bound to the current UI language. */
export interface ChartFormat {
  locale: string;
  dayTick: (iso: string) => string;
  dayFull: (iso: string) => string;
  instantTick: (value: number | string) => string;
  count: (value: number) => string;
  decimal: (value: number) => string;
}

/**
 * The hook every chart calls.
 *
 * `useLang()` is a `useSyncExternalStore` subscription, so switching the
 * language re-renders the charts and their axes pick up the new month names in
 * the same frame the rest of the page flips direction.
 */
export function useChartFormat(): ChartFormat {
  // Subscribes to the language signal; the locale tag is derived from it.
  useLang();
  const locale = getIntlLocale();

  return {
    locale,
    dayTick: (iso) => formatDayTick(iso, locale),
    dayFull: (iso) => formatDayFull(iso, locale),
    instantTick: (value) => formatInstantTick(value, locale),
    count: (value) => formatCount(value, locale),
    decimal: (value) => formatDecimal(value, locale),
  };
}

/** TEST SEAM — drops the memoized formatters between locale-sensitive suites. */
export function __clearFormatterCacheForTests(): void {
  cache.clear();
}
