/**
 * The dependency arrows' geometry: two points in, one SVG `d` string out.
 *
 * Pure, and separated from `GanttDependencyLayer` for the same reason the drag
 * math is separated from `GanttBar` — the elbow routing has four cases and
 * exactly one of them (the backwards edge, where the blocker ends AFTER the
 * task it blocks starts, which is precisely the case worth drawing) is easy to
 * get wrong in a way that only shows up on real data.
 */

export interface Point {
  x: number;
  y: number;
}

/** Tunables, exported so the layer and the tests share one set of numbers. */
export const ARROW_STUB = 10;
export const ARROW_RADIUS = 4;
/** How far a same-row backwards edge detours vertically to get around itself. */
export const ARROW_DETOUR = 14;

/** Coordinates are rounded to this many decimals — see {@link round}. */
const PRECISION = 2;

/**
 * Rounds to 2dp.
 *
 * Not cosmetic: an SVG path is a STRING, so a coordinate of
 * `123.45000000000002` makes the `d` attribute differ between two renders that
 * are geometrically identical, which defeats React's attribute diffing on every
 * arrow on every scroll frame — and makes the tests assert on float noise.
 */
function round(value: number): number {
  const factor = 10 ** PRECISION;
  return Math.round(value * factor) / factor;
}

/** Distance between two points. */
function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The point `length` px from `from` along the segment towards `to`. */
function towards(from: Point, to: Point, length: number): Point {
  const span = distance(from, to);
  if (span === 0) return from;
  const ratio = length / span;
  return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
}

/** Drops consecutive duplicates, which would otherwise produce zero-length arcs. */
function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    out.push(point);
  }
  return out;
}

/**
 * An SVG path through `points` with the interior corners rounded.
 *
 * Each corner is cut back along BOTH adjacent segments by the same amount and
 * the vertex itself becomes a quadratic control point — the standard rounded
 * polyline. The cut is capped at half of the shorter neighbouring segment, so
 * two corners can never eat into each other and produce a path that doubles
 * back: a 6px jog between two 4px-radius corners degrades to a 3px radius
 * rather than to a knot.
 */
export function roundedPolyline(points: readonly Point[], radius: number): string {
  const path = dedupe(points);
  if (path.length === 0) return '';

  const first = path[0];
  if (!first) return '';
  if (path.length === 1) return `M ${round(first.x)} ${round(first.y)}`;

  let d = `M ${round(first.x)} ${round(first.y)}`;

  for (let index = 1; index < path.length - 1; index += 1) {
    const previous = path[index - 1];
    const corner = path[index];
    const next = path[index + 1];
    if (!previous || !corner || !next) continue;

    const cut = Math.min(radius, distance(previous, corner) / 2, distance(corner, next) / 2);
    if (cut <= 0) {
      d += ` L ${round(corner.x)} ${round(corner.y)}`;
      continue;
    }

    const entry = towards(corner, previous, cut);
    const exit = towards(corner, next, cut);
    d += ` L ${round(entry.x)} ${round(entry.y)}`;
    d += ` Q ${round(corner.x)} ${round(corner.y)} ${round(exit.x)} ${round(exit.y)}`;
  }

  const last = path[path.length - 1];
  if (last) d += ` L ${round(last.x)} ${round(last.y)}`;
  return d;
}

/** The vertices of a dependency elbow, before rounding. Exposed for testing. */
export function dependencyPoints(
  from: Point,
  to: Point,
  options: { stub?: number; detour?: number } = {},
): Point[] {
  const stub = options.stub ?? ARROW_STUB;
  const detour = options.detour ?? ARROW_DETOUR;

  // FORWARD: the blocker finishes with room to spare before the blocked task
  // starts. Two elbows — out, across, in — which is the shape a reader parses
  // instantly as "this, then that".
  if (to.x - from.x >= stub * 2) {
    if (from.y === to.y) return [from, to];
    return [from, { x: from.x + stub, y: from.y }, { x: from.x + stub, y: to.y }, to];
  }

  // BACKWARDS (or too tight): the blocker ends at or after the blocked task
  // starts — a genuine scheduling conflict, and the case most worth SEEING.
  // The path leaves to the right, crosses back on a lane between the two rows,
  // and re-enters from the left, so it never runs along either bar.
  //
  // On the SAME row there is no "between", so it detours by a fixed offset —
  // below the row, where it cannot be mistaken for the bar's own outline.
  const lane = from.y === to.y ? from.y + detour : (from.y + to.y) / 2;

  return [
    from,
    { x: from.x + stub, y: from.y },
    { x: from.x + stub, y: lane },
    { x: to.x - stub, y: lane },
    { x: to.x - stub, y: to.y },
    to,
  ];
}

/**
 * The finished `d` for one dependency arrow.
 *
 * `from` is the RIGHT edge of the blocker's bar at its vertical centre; `to` is
 * the LEFT edge of the blocked bar. Both are canvas coordinates in the
 * `dir="ltr"` island, so "right" and "left" are literal here even on an Arabic
 * page — that is the whole point of the island (plan §Risks 5).
 */
export function dependencyPath(
  from: Point,
  to: Point,
  options: { stub?: number; radius?: number; detour?: number } = {},
): string {
  return roundedPolyline(dependencyPoints(from, to, options), options.radius ?? ARROW_RADIUS);
}

/** A directed blocker → blocked edge, deduped by {@link edgeKey}. */
export interface DependencyEdge {
  blockerId: string;
  blockedId: string;
}

/** `A→B` — stable, direction-sensitive, and safe as a React key. */
export function edgeKey(edge: DependencyEdge): string {
  return `${edge.blockerId}->${edge.blockedId}`;
}

/** Drops duplicate edges, keeping first-seen order. */
export function dedupeEdges(edges: readonly DependencyEdge[]): DependencyEdge[] {
  const seen = new Set<string>();
  const out: DependencyEdge[] = [];
  for (const edge of edges) {
    // A self-edge cannot exist (the server rejects cycles) but drawing one
    // would produce a loop over a single bar, so it is filtered rather than
    // trusted.
    if (edge.blockerId === edge.blockedId) continue;
    const key = edgeKey(edge);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}
