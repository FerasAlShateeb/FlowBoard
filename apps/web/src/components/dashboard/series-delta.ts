/**
 * The trend number behind every {@link import('./StatDelta').StatDelta} pill.
 *
 * ═══ WHY THE LAST TWO BUCKETS, AND NOT THE WHOLE SERIES ═══════════════════
 *
 * A KPI tile answers "how are we doing *now*", so its delta compares the newest
 * bucket with the one before it — the same comparison a reader makes by looking
 * at the last two points of the chart underneath. First-versus-last over a
 * 90-day window would report the shape of the window rather than the shape of
 * the trend, and would swing wildly the moment somebody widened the range.
 *
 * It also means the delta's UNIT follows the window: on an hourly series it is
 * hour-over-hour, on a monthly one month-over-month. The caption beside the
 * tile is what tells the reader which — the number itself cannot.
 *
 * ═══ THE TWO DEGENERATE CASES ════════════════════════════════════════════
 *
 * **Fewer than two buckets** → `undefined`, i.e. "no trend to show", and the
 * pill is not rendered at all. Zero is a claim (flat); absence is the truth.
 *
 * **A previous bucket of zero** → a percent change is undefined in arithmetic
 * (division by zero), but it is perfectly meaningful in the product: going from
 * nothing to something is the largest move a metric can make. It reports +100%
 * — a bounded, honest "up from nothing" — rather than `Infinity`, which paints
 * as `Infinity%`. Zero to zero is flat, which it genuinely is.
 */

/** The only field this module reads off a series point. */
export interface SeriesPoint {
  value: number;
}

/**
 * Percent change between the last two buckets of a series, or `undefined` when
 * there is no previous bucket to compare against.
 *
 * The result is a SIGNED PERCENT (`-12.5` for a 12.5% drop), which is what
 * `StatDelta` renders and what `StatTile`'s `delta` prop expects. Non-finite
 * inputs (a gap-filled `NaN`, an `Infinity` from a bad division upstream) yield
 * `undefined` rather than propagating into the UI.
 */
export function seriesDelta(points: readonly SeriesPoint[]): number | undefined {
  if (points.length < 2) return undefined;

  const last = points[points.length - 1]?.value;
  const previous = points[points.length - 2]?.value;
  if (last === undefined || previous === undefined) return undefined;
  if (!Number.isFinite(last) || !Number.isFinite(previous)) return undefined;

  if (previous === 0) return last === 0 ? 0 : 100;
  return ((last - previous) / previous) * 100;
}
