import { formatIsoDate, fromIsoDate } from '@/lib/format';

/**
 * The analytics WINDOW vocabulary — one preset list, one resolver, one label.
 *
 * ═══ WHY A PRESET IS NOT A WINDOW ═════════════════════════════════════════
 *
 * The value a picker holds is a PRESET plus two optional day strings, never a
 * resolved `{from, to}` pair. A "7d" view re-read an hour later has to mean the
 * last seven days *from now*, not a `from`/`to` frozen at click time — and a
 * frozen pair is exactly what a store persists, what a URL carries, and what an
 * auto-refresh loop would keep re-sending until someone noticed the numbers had
 * stopped moving. So resolution happens in {@link windowFor}, at REQUEST time,
 * every time.
 *
 * ═══ THE BUCKET FALLS OUT OF THE SPAN ═════════════════════════════════════
 *
 * A chart wants roughly 10–100 points. Past ~45 days a daily series is a smear;
 * past ~200 the weekly one is too. So the interval is chosen from the span
 * alone — which means a preset and the equivalent hand-picked custom range
 * bucket identically, and no caller has to remember that `90d` is weekly.
 *
 * `hourlyUpToDays` is the one per-caller knob, and the domains disagree
 * honestly: traffic is read while something is on fire and wants hourly
 * resolution across a whole week, whereas a 7-day signup chart with 168 points
 * is noise.
 *
 * ═══ PURE, AND DELIBERATELY SO ═══════════════════════════════════════════
 *
 * Nothing here imports i18next or reads the language policy. {@link rangeLabel}
 * takes the translated "Custom" word and the Intl locale as arguments, so the
 * whole module is testable without a DOM, a catalog or a language store — and a
 * caller can label two locales in one render.
 */

/** The four preset tokens. Latin in every language — see {@link rangeLabel}. */
export const RANGE_PRESETS = ['7d', '30d', '90d', '12m'] as const;

/** A preset the pills can emit. */
export type RangePresetToken = (typeof RANGE_PRESETS)[number];

/** Which window is selected: one of the pills, or an explicit day range. */
export type RangePreset = RangePresetToken | 'custom';

/** `from` / `to` are `yyyy-MM-dd` LOCAL day strings, present only for `custom`. */
export interface RangeValue {
  preset: RangePreset;
  from?: string;
  to?: string;
}

/**
 * Bucket size the API accepts. Every windowed endpoint buckets on real calendar
 * boundaries (weeks start Monday, months on the 1st), so this is the ONE window
 * vocabulary the console speaks.
 */
export type WindowInterval = 'hour' | 'day' | 'week' | 'month';

/** What a caller sends as `?from=&to=&interval=`. */
export interface AnalyticsWindow {
  from: string;
  to: string;
  interval: WindowInterval;
}

/**
 * Every analytics surface opens on 30 days: wide enough to show a trend, narrow
 * enough that a day bucket still has shape.
 */
export const DEFAULT_RANGE: RangeValue = { preset: '30d' };

const DAY_MS = 86_400_000;

/** Days each preset looks back. `12m` is 365 days, not 12 calendar months. */
const PRESET_DAYS: Record<RangePresetToken, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '12m': 365,
};

/**
 * Where the bucket coarsens, in span days. Exported because the tests assert
 * the exact edges and a magic number asserted against itself proves nothing.
 */
export const DAILY_UP_TO_DAYS = 45;
export const WEEKLY_UP_TO_DAYS = 200;

/** The default hourly cut-off: two days. Traffic-shaped callers pass 7. */
export const DEFAULT_HOURLY_UP_TO_DAYS = 2;

/**
 * Bucket size for a span in days.
 *
 * The presets need no special case — they fall out of the same thresholds:
 * 7d/30d → day, 90d → week, 12m → month.
 */
export function intervalForSpan(
  spanDays: number,
  hourlyUpToDays: number = DEFAULT_HOURLY_UP_TO_DAYS,
): WindowInterval {
  if (spanDays <= hourlyUpToDays) return 'hour';
  if (spanDays <= DAILY_UP_TO_DAYS) return 'day';
  if (spanDays <= WEEKLY_UP_TO_DAYS) return 'week';
  return 'month';
}

/**
 * A `yyyy-MM-dd` day at LOCAL midnight, or `null`.
 *
 * Delegates to `lib/format.fromIsoDate`, which rejects an OVERFLOWING day
 * (`2026-02-31` rolls forward to 3 March in a naive parse, silently turning a
 * typo into a real window) and anchors at local rather than UTC midnight.
 */
export function parseRangeDay(day: string | undefined): Date | null {
  return day === undefined ? null : fromIsoDate(day);
}

/**
 * Resolve a picker value into the `?from=&to=&interval=` triple.
 *
 * A CUSTOM range covers whole LOCAL calendar days — start of `from` to the last
 * millisecond of `to` — because that is what a person picking two days off a
 * calendar means. A lone `from` (the state between the two clicks of a range
 * drag) reads as THAT ONE DAY rather than a zero-width window, so the chart
 * never blanks mid-gesture. A `custom` value carrying no parseable day at all
 * falls back to the 30-day preset rather than emitting `NaN`.
 */
export function windowFor(
  value: RangeValue,
  hourlyUpToDays: number = DEFAULT_HOURLY_UP_TO_DAYS,
): AnalyticsWindow {
  const now = new Date();
  const customFrom = value.preset === 'custom' ? parseRangeDay(value.from) : null;
  const customTo = value.preset === 'custom' ? parseRangeDay(value.to) : null;

  let from: Date;
  let to: Date;

  if (customFrom) {
    from = new Date(customFrom);
    from.setHours(0, 0, 0, 0);
    to = new Date(customTo ?? customFrom);
    to.setHours(23, 59, 59, 999);
  } else {
    const days = PRESET_DAYS[value.preset === 'custom' ? '30d' : value.preset];
    to = now;
    from = new Date(now.getTime() - days * DAY_MS);
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    interval: intervalForSpan((to.getTime() - from.getTime()) / DAY_MS, hourlyUpToDays),
  };
}

/** What {@link rangeLabel} needs from its caller. */
export interface RangeLabelOptions {
  /** Translated "Custom…" — shown until a day has been picked. */
  customLabel: string;
  /** BCP-47 tag, normally `getIntlLocale()`. Formats the two day stamps. */
  locale: string;
}

/**
 * Short human label for the current selection — the custom trigger's face.
 *
 * A PRESET returns its Latin token unchanged in every language. That is
 * deliberate and matches the pills: a four-character chip carries Western
 * digits by policy (i18n.md §2), an Arabic word there would reflow the control,
 * and the trigger beside the pills has to agree with them. Only the
 * empty-custom placeholder is translated, and the day stamps follow `locale`.
 */
export function rangeLabel(value: RangeValue, options: RangeLabelOptions): string {
  if (value.preset !== 'custom') return value.preset;

  const from = parseRangeDay(value.from);
  if (!from) return options.customLabel;

  const to = parseRangeDay(value.to);
  const start = formatIsoDate(value.from, options.locale);
  if (!to || to.getTime() === from.getTime()) return start;

  // U+2013 EN DASH with hairline spaces: a span, not a hyphenated compound.
  return `${start} – ${formatIsoDate(value.to, options.locale)}`;
}
