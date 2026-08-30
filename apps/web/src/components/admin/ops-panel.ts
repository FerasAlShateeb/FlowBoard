/**
 * The one line the two ops chart panels share, so they cannot drift apart.
 *
 * ── WHY A CONSTANT AND NOT A CLASS TYPED TWICE ──────────────────────────────
 * `RequestsCard` and `LatencyCard` sit side by side in a two-column grid on both
 * `/admin/telemetry` and `/admin/telemetry/requests`. Their plots have to be the
 * same height or the pair reads as a layout bug — and since W3.1 moved them off
 * `ReportCard` (which pinned a 16:10 aspect for exactly that reason) onto
 * `PanelCard` (which deliberately does not), the height is now the caller's to
 * state. Stating it in one place is what keeps "the same" true.
 *
 * ── WHY 240px, AND WHY A CLASS RATHER THAN A STYLE ──────────────────────────
 * `h-60` is 240px, which is `PanelCard.DEFAULT_CHART_HEIGHT` and
 * `MetricChart.METRIC_CHART_HEIGHT` — the analytics console's standard plot. So
 * an operator moving between the ops overview and the Traffic dashboard sees
 * charts of one size, and the pending skeleton `PanelCard` draws (also 240px)
 * reserves the exact box the plot will occupy, so nothing reflows when the query
 * lands.
 *
 * A Tailwind class rather than an inline `style` because the body is styled
 * through `PanelCard`'s `bodyClassName`, which merges with `cn` — an inline
 * height would have to travel by a second prop that does not exist.
 */
export const OPS_CHART_BODY = 'h-60';
