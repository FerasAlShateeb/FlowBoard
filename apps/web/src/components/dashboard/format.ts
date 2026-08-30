import { formatDateTime, formatIsoDate, formatRelative } from '@/lib/format';
import { getIntlLocale } from '@/lib/lang-policy';

import type { WindowInterval } from '@/components/dashboard/range';

/**
 * The dashboard's number and tick formatters.
 *
 * ═══ WHAT THIS FILE IS, AND WHAT `lib/format.ts` IS ═══════════════════════
 *
 * `lib/format` is the app-wide primitive layer, and its rule is that **the
 * locale is a PARAMETER, never read from the policy** — so a test can assert
 * Arabic output with no language store and a caller can format two locales in
 * one render. This file is the dashboard's convenience layer over it: the same
 * functions with `getIntlLocale()` already applied, plus the four shapes only
 * an analytics surface needs (counts, percents, 0–1 shares, chart ticks).
 *
 * A dashboard renders hundreds of cells from one language, so threading the
 * locale through every call site would be noise. Anything that needs an
 * explicit locale reaches for `lib/format` directly; nothing here re-implements
 * a primitive that already lives there.
 *
 * ═══ TWO THINGS THAT DO NOT FOLLOW THE LANGUAGE ══════════════════════════
 *
 * **Digits stay Western.** The Arabic tag is `ar-u-nu-latn` (see
 * `lib/lang-policy.getIntlLocale`), so `1,234` never becomes `١٬٢٣٤`. Half
 * these numbers sit in `tabular-nums` grids beside Latin identifiers and a
 * digit swap breaks both the column alignment and the read-across.
 *
 * **Percents are `toFixed` + `%`, not `Intl.NumberFormat`.** They feed
 * fixed-width KPI cells and chart axes where a locale-specific separator would
 * reflow the layout for no informational gain.
 *
 * ═══ FORMATTERS ARE BUILT ONCE PER LOCALE ════════════════════════════════
 *
 * `Intl.*` construction costs 10–100× a `format()` call and these run per table
 * cell. The cache is keyed by locale rather than cleared on a language switch:
 * switching back and forth is then free, and there are exactly two entries.
 */

interface DashboardFormatters {
  readonly count: Intl.NumberFormat;
  readonly countCompact: Intl.NumberFormat;
  /** `Jul 20, 3 PM` — the hour-bucket tick. */
  readonly bucketHour: Intl.DateTimeFormat;
  /** `Jul 20` — the day and week-bucket tick. */
  readonly bucketDay: Intl.DateTimeFormat;
  /** `Jul 26` — the month-bucket tick. */
  readonly bucketMonth: Intl.DateTimeFormat;
}

const cache = new Map<string, DashboardFormatters>();

function build(locale: string): DashboardFormatters {
  return {
    count: new Intl.NumberFormat(locale),
    countCompact: new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }),
    bucketHour: new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
    }),
    bucketDay: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }),
    bucketMonth: new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' }),
  };
}

/** The formatter set for the active language, built on first use. */
function formatters(): DashboardFormatters {
  const locale = getIntlLocale();
  let set = cache.get(locale);
  if (!set) {
    set = build(locale);
    cache.set(locale, set);
  }
  return set;
}

/** Test seam: the cache is module-global and would leak across locale cases. */
export function __clearDashboardFormatterCache(): void {
  cache.clear();
}

/** The placeholder for a number that does not exist. Not prose — no locale. */
export const NO_VALUE = '—';

/**
 * A whole number with grouping (`1,234`), or compactly (`1.2K`).
 *
 * Compact is for KPI tiles and chart axes, where four digits and a separator do
 * not fit; the full form is for table cells, where the exact number is the
 * point of the column.
 */
export function formatCount(value: number, compact = false): string {
  if (!Number.isFinite(value)) return NO_VALUE;
  const set = formatters();
  return compact ? set.countCompact.format(value) : set.count.format(value);
}

/**
 * A millisecond duration with its unit symbol.
 *
 * `unit` is REQUIRED and comes from the catalog (`admin:units.ms`): FlowBoard's
 * rule is that every user-facing string goes through i18next, and a hard-coded
 * `'ms'` here would be a string no translator can ever reach. Values are
 * rounded to whole milliseconds — a p95 of `128.4 ms` claims a precision the
 * measurement does not have.
 */
export function formatMs(value: number, unit: string): string {
  if (!Number.isFinite(value)) return NO_VALUE;
  return `${formatCount(Math.round(value))} ${unit}`;
}

/**
 * A signed percent CHANGE (`+12.5%` / `-3.0%`) — what a delta pill reads.
 *
 * The sign is explicit on the positive side because "12.5%" and "+12.5%" are
 * different claims in a trend context: one is a level, the other a movement.
 */
export function formatDelta(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return NO_VALUE;
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

/** A percent LEVEL already expressed in percent units (`12.5` → `12.5%`). */
export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return NO_VALUE;
  return `${value.toFixed(digits)}%`;
}

/**
 * A 0–1 rate as a percent (`0.732` → `73%`).
 *
 * Separate from {@link formatPercent} on purpose: the two take the same-looking
 * number and mean different things, and every "the error rate says 0%" bug is a
 * caller that reached for the other one. The name says which scale it wants.
 */
export function formatShare(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return NO_VALUE;
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * X-axis label for a bucketed series point.
 *
 * Shared by every dashboard chart so a `Jul 20` tick means the same thing
 * everywhere. Hour buckets add the clock; month buckets drop the day; a week
 * bucket is labelled by the day it starts on, which is what the API returns.
 * An unparseable stamp is returned verbatim rather than as `Invalid Date`.
 */
export function bucketLabel(iso: string, interval: WindowInterval): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const set = formatters();
  if (interval === 'hour') return set.bucketHour.format(date);
  if (interval === 'month') return set.bucketMonth.format(date);
  return set.bucketDay.format(date);
}

/* ------------------------------------------------------------------ */
/* Date shapes, with the active locale applied                         */
/* ------------------------------------------------------------------ */

/** A `yyyy-MM-dd` calendar day in the active language (`12 Mar 2026`). */
export function formatDay(value: string | null | undefined): string {
  return formatIsoDate(value, getIntlLocale());
}

/** An ISO instant in the active language (`12 Mar 2026, 14:05`). */
export function formatInstant(value: string | null | undefined): string {
  return formatDateTime(value, getIntlLocale());
}

/** An ISO instant as `3 days ago` in the active language. */
export function formatAgo(value: string | null | undefined, now?: Date): string {
  return formatRelative(value, getIntlLocale(), now);
}
