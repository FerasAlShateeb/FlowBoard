import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { StatDelta, type GoodDirection } from '@/components/dashboard/StatDelta';

/**
 * The headline-number card: label, value, optional trend badge and caption —
 * and, when it drills somewhere, a link wrapped around the whole thing.
 *
 * ═══ THE TILE *IS* THE LINK ══════════════════════════════════════════════
 *
 * Every headline number in a console answers "…and then what?", so the
 * affordance is the card itself rather than a "view details" control tucked in
 * a corner. That is one hover treatment, one focus ring and one hit target per
 * tile instead of three, and it is the doctrine the whole analytics console
 * follows (a DrillChartCard's only link is in its header, for the same reason:
 * one destination, one control).
 *
 * ═══ THE LINK OWNS THE GEOMETRY; THE CARD NEVER KNOWS IT IS CLICKABLE ════
 *
 * When `to` is present the `<Link>` WRAPS the card and takes the radius, the
 * hover and the focus ring. The card body below is byte-identical in both
 * modes — no `isLink` branch, no conditional cursor — which is what stops the
 * static and the linked tile drifting apart visually. The radius has to be
 * repeated on the link (`--card-radius`) so the focus ring traces the card's
 * corners rather than a rectangle around them.
 *
 * ═══ WHY `<section aria-label>` RATHER THAN A HEADING ════════════════════
 *
 * A KPI grid is six to twelve of these. Emitting a heading each would put a
 * dozen entries in the document outline between the page title and the charts;
 * a labelled region is navigable ("go to next region") without pretending the
 * tiles are a document structure. The label is the caller's, already
 * translated — this component owns no copy at all.
 *
 * ═══ TESTID ═════════════════════════════════════════════════════════════
 *
 * `stat-tile-<id>` on the OUTERMOST element in both modes, so an e2e spec that
 * clicks a tile does not have to know whether that particular metric happens to
 * have a drill-down yet.
 */
export interface StatTileProps {
  /** Kebab-case metric id — becomes `data-testid="stat-tile-<id>"`. */
  id: string;
  /** Already-translated headline label. Also the region's accessible name. */
  label: string;
  /** The number itself. A node, so a caller can decorate a unit or a suffix. */
  value: ReactNode;
  /** Signed percent change; renders {@link StatDelta} when present. */
  delta?: number;
  /**
   * Which way this metric has to move to be good. Forwarded verbatim to
   * {@link StatDelta}, which defaults it to `'up'` — see that component's header
   * for why the arrow follows the sign and only the COLOUR follows this.
   *
   * A pass-through and not a decision: the tile is a layout primitive, and
   * whether a falling number is good is a fact about the METRIC. The analytics
   * console reads it out of the metric registry (see `MetricTile`).
   */
  goodDirection?: GoodDirection;
  /** One line under the value — what window the number covers, usually. */
  caption?: ReactNode;
  /** Router path this tile drills to. Absent ⇒ a static, non-interactive card. */
  to?: string;
  /**
   * Accessible name for the LINK when `to` is set (e.g. "Open the daily active
   * users breakdown"). Required with `to`, because a link whose name is just
   * the metric label is indistinguishable from the label beside it.
   */
  linkLabel?: string;
  className?: string;
}

export function StatTile({
  id,
  label,
  value,
  delta,
  goodDirection,
  caption,
  to,
  linkLabel,
  className,
}: StatTileProps) {
  const testId = `stat-tile-${id}`;
  const linked = to !== undefined;

  const card = (
    <section
      data-slot="stat-tile"
      aria-label={label}
      // The testid rides the OUTERMOST element in both modes; when a link wraps
      // this, the link takes it (and the caller's `className`) instead.
      data-testid={linked ? undefined : testId}
      className={cn(
        'flex h-full flex-col justify-between gap-2 rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-pad)] text-card-foreground shadow-[var(--shadow-1)]',
        linked ? undefined : className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{label}</span>
        {delta === undefined ? null : <StatDelta value={delta} goodDirection={goodDirection} />}
      </div>
      <div>
        <div className="text-2xl leading-tight font-semibold tabular-nums" data-testid="stat-value">
          {value}
        </div>
        {caption === undefined ? null : (
          <div className="mt-1 text-xs text-muted-foreground">{caption}</div>
        )}
      </div>
    </section>
  );

  if (!linked) return card;

  return (
    <Link
      to={to}
      aria-label={linkLabel ?? label}
      data-testid={testId}
      className={cn(
        'block rounded-[var(--card-radius)] transition-opacity duration-[var(--speed)] outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      {card}
    </Link>
  );
}
