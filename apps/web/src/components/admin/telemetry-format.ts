/**
 * Formatting for the telemetry dashboards.
 *
 * A sibling of `components/reports/chart-format.ts`, not a replacement: that
 * module formats CALENDAR DAYS (`2026-08-27` → `Aug 27`), which is the wrong
 * unit here. A telemetry bucket is an INSTANT, and the axis of a 24-hour chart
 * has to read `14:00`, not `Aug 27` twenty-four times.
 *
 * DIGITS STAY LATIN in both languages — `getIntlLocale()` returns
 * `ar-u-nu-latn`, and every number on these pages sits in a `tabular-nums`
 * column next to a path or a status code. See `lib/lang-policy` for the full
 * argument.
 *
 * Formatters are MEMOIZED PER LOCALE for the same reason the reports module
 * memoizes its own: an axis tick formatter runs once per tick per render, and
 * `new Intl.DateTimeFormat(...)` is expensive enough to show up on a 720-point
 * series.
 */
import { getIntlLocale, useLang } from '@/lib/lang-policy';

import type { TelemetryBucket } from './telemetry-range';

interface FormatterSet {
  /** `14:00` — the hour/minute axis. */
  time: Intl.DateTimeFormat;
  /** `Aug 27` — the daily axis. */
  day: Intl.DateTimeFormat;
  /** `Aug 27, 14:32` — tooltip headings and the event feed's time column. */
  stamp: Intl.DateTimeFormat;
  integer: Intl.NumberFormat;
  decimal: Intl.NumberFormat;
  percent: Intl.NumberFormat;
}

const cache = new Map<string, FormatterSet>();

function formattersFor(locale: string): FormatterSet {
  const cached = cache.get(locale);
  if (cached) return cached;

  const set: FormatterSet = {
    time: new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    day: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }),
    stamp: new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    integer: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    // Latency is read in whole milliseconds until it drops under 10, where a
    // decimal is the difference between "fast" and "how fast".
    decimal: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    percent: new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 1,
    }),
  };
  cache.set(locale, set);
  return set;
}

/** An `isoDateTime` → the axis tick for a given bucket width. */
export function formatBucketTick(iso: string, bucket: TelemetryBucket, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const set = formattersFor(locale);
  return bucket === 'day' ? set.day.format(date) : set.time.format(date);
}

/** An `isoDateTime` → `Aug 27, 14:32:05`. The tooltip heading and table cell. */
export function formatStamp(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formattersFor(locale).stamp.format(date);
}

/** Whole numbers — request counts, event counts, users. */
export function formatCount(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '—';
  return formattersFor(locale).integer.format(value);
}

/** Milliseconds, one decimal. */
export function formatMs(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '—';
  return formattersFor(locale).decimal.format(value);
}

/** A `[0,1]` share → `12.5%`. The API sends the SHARE; the `%` belongs here. */
export function formatShare(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '—';
  return formattersFor(locale).percent.format(value);
}

/** The formatter bundle, bound to the current UI language. */
export interface TelemetryFormat {
  locale: string;
  bucketTick: (iso: string, bucket: TelemetryBucket) => string;
  stamp: (iso: string) => string;
  count: (value: number) => string;
  ms: (value: number) => string;
  share: (value: number) => string;
}

/**
 * The hook every telemetry chart and table calls.
 *
 * `useLang()` is a `useSyncExternalStore` subscription, so switching to Arabic
 * re-renders the axes in the same frame the page flips direction.
 */
export function useTelemetryFormat(): TelemetryFormat {
  useLang();
  const locale = getIntlLocale();

  return {
    locale,
    bucketTick: (iso, bucket) => formatBucketTick(iso, bucket, locale),
    stamp: (iso) => formatStamp(iso, locale),
    count: (value) => formatCount(value, locale),
    ms: (value) => formatMs(value, locale),
    share: (value) => formatShare(value, locale),
  };
}

/** TEST SEAM — drops the memoized formatters between locale-sensitive suites. */
export function __clearTelemetryFormatterCacheForTests(): void {
  cache.clear();
}
