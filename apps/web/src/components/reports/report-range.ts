/**
 * The date window the cumulative-flow and cycle-time reports are drawn for.
 *
 * CALENDAR DAYS, NOT INSTANTS. Both endpoints take `?from=&to=` as `isoDate`
 * (`YYYY-MM-DD`) strings and bucket by calendar day — see the note at the top
 * of `reports.schema.ts`. So the whole range lives here as two plain strings
 * and never becomes a `Date` except to do arithmetic, which is why every helper
 * below round-trips through LOCAL midnight rather than through `Date.parse`.
 *
 * WHY LOCAL MIDNIGHT MATTERS. `new Date('2026-08-27')` is parsed by the spec as
 * UTC midnight; rendering that with a local formatter in any negative-offset
 * zone prints the 26th. Every day label on the dashboard would be off by one
 * for half the planet. {@link parseIsoDate} builds the date from its parts
 * instead, so "2026-08-27" is the 27th everywhere.
 *
 * Pure module — no React, no Intl, no i18next. It is the unit-tested core the
 * picker component is a thin shell over.
 */

/** The three quick windows, plus the escape hatch for two hand-picked dates. */
export const RANGE_PRESETS = ['2w', '4w', '8w'] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

/** What the toolbar's segmented control can be showing. */
export type RangeSelection = RangePreset | 'custom';

/** How many calendar days each preset covers, INCLUSIVE of today. */
const PRESET_DAYS: Record<RangePreset, number> = {
  '2w': 14,
  '4w': 28,
  '8w': 56,
};

/** An inclusive `[from, to]` window of calendar days. */
export interface DateRange {
  from: string;
  to: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-08-27` → a Date at LOCAL midnight on that day. Invalid input → NaN. */
export function parseIsoDate(iso: string): Date {
  if (!ISO_DATE.test(iso)) return new Date(Number.NaN);
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  // A rolled-over date (`2026-02-31` → March 3) is not the day that was asked
  // for, and silently sliding it would put a phantom bucket on the axis.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return new Date(Number.NaN);
  }
  return date;
}

/** A Date → `YYYY-MM-DD` in the LOCAL zone (never `toISOString`, see above). */
export function toIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Shifts an `isoDate` by whole days. Handles month and year boundaries. */
export function addDays(iso: string, delta: number): string {
  const date = parseIsoDate(iso);
  if (Number.isNaN(date.getTime())) return iso;
  date.setDate(date.getDate() + delta);
  return toIsoDate(date);
}

/** Well-formed, real calendar days, and `from` no later than `to`. */
export function isValidRange(range: DateRange): boolean {
  const from = parseIsoDate(range.from);
  const to = parseIsoDate(range.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;
  return from.getTime() <= to.getTime();
}

/**
 * Puts a hand-picked pair back in order.
 *
 * The two calendar popovers are independent, so a user who sets `to` first and
 * `from` second briefly holds a reversed window. Swapping is kinder than
 * refusing: the intent is unambiguous.
 */
export function normalizeRange(range: DateRange): DateRange {
  if (isValidRange(range)) return range;
  const from = parseIsoDate(range.from);
  const to = parseIsoDate(range.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return range;
  return { from: range.to, to: range.from };
}

/** The window a preset names, ending TODAY and counting back inclusively. */
export function presetRange(preset: RangePreset, today: Date = new Date()): DateRange {
  const to = toIsoDate(today);
  return { from: addDays(to, -(PRESET_DAYS[preset] - 1)), to };
}

/**
 * Which control the toolbar should show as selected for a given window.
 *
 * Recomputed from the range rather than remembered alongside it, so a range
 * restored from anywhere (a URL, a future saved view) lights up the right chip
 * without a second piece of state that can disagree with the first.
 */
export function detectPreset(range: DateRange, today: Date = new Date()): RangeSelection {
  for (const preset of RANGE_PRESETS) {
    const candidate = presetRange(preset, today);
    if (candidate.from === range.from && candidate.to === range.to) return preset;
  }
  return 'custom';
}

/**
 * The cache-key segment for a window.
 *
 * Reports are expensive and MUST NOT share an entry across windows (see
 * `qk.reports`), so every range-scoped key is built from this one string —
 * `from..to`, lossless and stable.
 */
export function rangeKey(range: DateRange): string {
  return `${range.from}..${range.to}`;
}

/** The dashboard's opening window: four weeks back through today. */
export function defaultRange(today: Date = new Date()): DateRange {
  return presetRange('4w', today);
}
