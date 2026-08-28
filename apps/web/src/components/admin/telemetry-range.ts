/**
 * The window the telemetry charts are drawn for.
 *
 * ── INSTANTS, NOT CALENDAR DAYS ─────────────────────────────────────────────
 * This is the opposite convention from `components/reports/report-range.ts`,
 * and the difference is real rather than accidental. A burndown bucket is a
 * calendar DAY — "how much was left at the end of Tuesday" — so that module
 * carries `YYYY-MM-DD` strings and never touches UTC. A request-volume bucket
 * is an HOUR, and "the 14:00 hour" is a point on a global timeline: the API
 * takes `isoDateTime` (`telemetryRangeQuerySchema`), buckets with `date_trunc`
 * in the database, and returns instants. Trying to express that as a local
 * calendar day would put an off-by-one in the middle of the traffic chart for
 * every reader west of Greenwich.
 *
 * ── PRESETS ONLY ────────────────────────────────────────────────────────────
 * Three windows, no custom date pickers. The reports dashboard needs arbitrary
 * ranges because a sprint retrospective is about a specific fortnight; an
 * operator looking at request latency is asking "is it bad right now", "was it
 * bad today", or "has it been getting worse this month". A calendar popover
 * would be more surface for a question nobody asks.
 *
 * The bucket is DERIVED from the preset rather than chosen independently: 30
 * days of hourly points is 720 marks on a chart 600 pixels wide, and 24 hours
 * of daily points is one. The requests page still offers an explicit toggle on
 * top of this default, because there the granularity IS the thing being
 * inspected.
 *
 * Pure module — no React, no Intl, no i18next.
 */

/** The offered windows. Ordered shortest first, which is also the tab order. */
export const TELEMETRY_PRESETS = ['24h', '7d', '30d'] as const;

export type TelemetryPreset = (typeof TELEMETRY_PRESETS)[number];

/** The chart granularity the API accepts (`telemetryRangeQuerySchema`). */
export type TelemetryBucket = 'minute' | 'hour' | 'day';

/** An `[from, to]` window as the two `isoDateTime` strings the API takes. */
export interface TelemetryWindow {
  from: string;
  to: string;
}

const MS_PER_HOUR = 3_600_000;

/** How far back each preset reaches. */
const PRESET_HOURS: Record<TelemetryPreset, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

/**
 * The bucket each preset reads best at — see the header.
 *
 * `minute` is never a default. It exists in the contract for a live incident
 * view, and the server refuses a window wide enough to make it expensive.
 */
const PRESET_BUCKET: Record<TelemetryPreset, TelemetryBucket> = {
  '24h': 'hour',
  '7d': 'hour',
  '30d': 'day',
};

/**
 * The window a preset names, ending at `now`.
 *
 * `now` is a parameter with a default so the whole module is deterministic
 * under test; no caller in the app passes it.
 */
export function presetWindow(preset: TelemetryPreset, now: Date = new Date()): TelemetryWindow {
  const to = now;
  const from = new Date(to.getTime() - PRESET_HOURS[preset] * MS_PER_HOUR);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** The granularity a preset defaults to. */
export function presetBucket(preset: TelemetryPreset): TelemetryBucket {
  return PRESET_BUCKET[preset];
}

/**
 * The cache-key segment for a window at a granularity.
 *
 * The BUCKET IS PART OF THE KEY. `?bucket=hour` and `?bucket=day` over the same
 * window are two different payloads from the same URL path, and a key that
 * ignored it would serve the daily series to the hourly chart on a toggle —
 * which looks exactly like a chart that has silently stopped updating.
 */
export function windowKey(window: TelemetryWindow, bucket?: TelemetryBucket): string {
  const base = `${window.from}..${window.to}`;
  return bucket === undefined ? base : `${base}#${bucket}`;
}

/** The opening window on every telemetry page: the last 24 hours. */
export const DEFAULT_TELEMETRY_PRESET: TelemetryPreset = '24h';

// ───────────────────────────────────────────────────────────────────────────
// The event feed's window — the same presets, plus "all"
// ───────────────────────────────────────────────────────────────────────────

/**
 * The raw event feed adds an ALL-TIME option the charts deliberately lack.
 *
 * A chart with no window has no x-axis, so "all" is meaningless there. The feed
 * is a paginated table, and its most common use is "find the event I am looking
 * for" — a hidden 24-hour window would turn "I cannot find last month's login"
 * into a support ticket instead of a scroll. The API agrees: `/events` is the
 * one endpoint with no implicit range (see `admin-telemetry.service.ts`).
 */
export type TelemetryFilterPreset = TelemetryPreset | 'all';

export const TELEMETRY_FILTER_PRESETS = ['all', ...TELEMETRY_PRESETS] as const;

/** The window a feed preset names — `undefined` for "all", meaning no filter. */
export function filterWindow(
  preset: TelemetryFilterPreset,
  now: Date = new Date(),
): TelemetryWindow | undefined {
  return preset === 'all' ? undefined : presetWindow(preset, now);
}
