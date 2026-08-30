import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AnalyticsDomain } from '@flowboard/shared';

import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/dashboard/StatTile';
import type { GoodDirection } from '@/components/dashboard/StatDelta';
import { metricDeltaDirection } from '@/components/admin/analytics/metric-registry';

/**
 * A KPI card that is also a link into its drill-down.
 *
 * ═══ THE TILE IS THE LINK ════════════════════════════════════════════════
 *
 * Every headline number in the console answers "…and then what?", so the
 * affordance is the card itself rather than a "view details" control tucked in
 * a corner. `StatTile` already implements exactly that — the `<Link>` wraps the
 * card and owns the radius, the hover and the focus ring — so this component
 * adds only the two things the ANALYTICS console needs on top of the kit
 * primitive:
 *
 *  1. the accessible link name ("Open the daily active users breakdown"), which
 *     `StatTile` deliberately requires rather than inventing, because only a
 *     caller knows what the number is;
 *  2. `analytics-kpi-<metric>`, the console's own testid contract.
 *
 * ═══ WHY THE TESTID RIDES A WRAPPER ══════════════════════════════════════
 *
 * `StatTile` stamps `stat-tile-<id>` on its outermost element and there can
 * only be one `data-testid` per node. Rather than fork the primitive (or make
 * every analytics e2e spec learn the kit's naming), the console's id lives on a
 * one-element wrapper that is `h-full` and draws nothing: the grid cell's box is
 * unchanged, the link still covers the whole tile, and BOTH contracts resolve.
 * A spec can address `analytics-kpi-dau` or `stat-tile-dau` and get the same
 * pixels.
 *
 * ═══ POLARITY COMES FROM THE REGISTRY, NOT FROM THE PAGE (R2 W3.5) ═══════
 *
 * A falling error rate is good news and a falling sign-up count is not, so a
 * trend badge cannot decide its own colour. `StatDelta` takes a `goodDirection`
 * and this component fills it from `MetricDefinition.deltaDirection` — one
 * declaration per metric, sitting next to that metric's title, columns and
 * loader, which is what stops a KPI tile and the drill-down it links to
 * disagreeing about which way is up.
 *
 * `domain` is therefore a prop rather than something derived from `to`: parsing
 * a polarity back out of a URL string would be a second, fuzzier source of the
 * same fact. `goodDirection` stays available as an explicit override for the one
 * shape the lookup cannot serve — a tile whose id is not a registry id, like
 * Traffic's `p95`, which drills into `latency`.
 */
export interface MetricTileProps {
  /** Kebab-case metric id — becomes `analytics-kpi-<metric>`. */
  metric: string;
  /**
   * The dashboard this tile belongs to — what resolves the registry's polarity.
   *
   * OPTIONAL for the one caller that has no single domain:
   * `components/admin/TelemetryStatRow`, the `/admin/telemetry` KPI row, whose
   * five tiles are drawn from different domains and link across all of them.
   * Omitting it means the default `'up'`, which is correct for every tile there
   * — and every one of them is a count with no `delta` at all.
   */
  domain?: AnalyticsDomain;
  /** Already-translated headline label. Also the region's accessible name. */
  label: string;
  /** The number itself. A node, so a caller can decorate a unit or a suffix. */
  value: ReactNode;
  /** One line under the value — the window the number covers, usually. */
  caption?: ReactNode;
  /** Signed percent change; renders the trend pill. */
  delta?: number;
  /**
   * Overrides the registry's polarity. Only for a tile whose `metric` is not a
   * registry id — otherwise declare it on the metric, where it belongs.
   */
  goodDirection?: GoodDirection;
  /** Where the tile drills to — normally `detailPath(domain, metric)`. */
  to: string;
}

export function MetricTile({
  metric,
  domain,
  label,
  value,
  caption,
  delta,
  goodDirection,
  to,
}: MetricTileProps) {
  const { t } = useTranslation(['analytics']);

  return (
    <div data-testid={`analytics-kpi-${metric}`} className="h-full">
      <StatTile
        id={metric}
        label={label}
        value={value}
        caption={caption}
        delta={delta}
        goodDirection={goodDirection ?? metricDeltaDirection(domain, metric)}
        to={to}
        linkLabel={t('analytics:card.openBreakdown', { label })}
        className="h-full"
      />
    </div>
  );
}

/**
 * The KPI row's placeholder while a COLD load is in flight.
 *
 * Shaped like the tile it replaces — label line, value line, caption line, same
 * padding and radius — so the row does not resize when the numbers arrive. A
 * warm refresh never renders this: the store keeps the previous window's
 * numbers on screen while it re-reads.
 */
export function KpiSkeleton() {
  return (
    <div
      aria-hidden
      data-testid="analytics-kpi-skeleton"
      className="flex h-full flex-col justify-between gap-2 rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-pad)] shadow-[var(--shadow-1)]"
    >
      <Skeleton className="h-3 w-24" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  );
}

export default MetricTile;
