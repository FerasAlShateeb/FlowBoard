import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { PanelCard } from '@/components/dashboard/PanelCard';

/**
 * A {@link PanelCard} whose header carries a "Details →" link into the metric's
 * drill-down page.
 *
 * ═══ THE LINK IS IN THE HEADER, NEVER AROUND THE CARD ════════════════════
 *
 * {@link import('./MetricTile').MetricTile} wraps its whole card in a `<Link>`,
 * and that is right for a number. It is WRONG for a chart: a plot is
 * interactive — tooltips, hover cursors, an axis you drag-select by accident —
 * and a card-wide anchor swallows every one of those and turns a hover into a
 * navigation. So the affordance is one small control in the header's toolbar
 * slot, which is also the only place a reader looks for "and then what".
 *
 * ═══ WHO OWNS THE LOADING LADDER ═════════════════════════════════════════
 *
 * `PanelCard` ships an `error → pending → empty → content` ladder, and this
 * component deliberately uses only the FIRST rung. The other three belong to
 * `MetricChart`, because the console's "empty" rule is series-specific: a
 * gap-filled window of twenty-four zeroes is *empty*, not a flat line, and a
 * panel that only knows `rows.length > 0` cannot tell those apart. Passing
 * `isPending`/`isEmpty` here as well would mean two components racing to draw
 * the same skeleton.
 *
 * Errors DO stay with the card only when a caller passes one; the domain
 * dashboards handle their single per-domain failure at page level instead (one
 * endpoint, one parse, one retry) and never hand an error down here.
 *
 * ═══ TESTIDS ════════════════════════════════════════════════════════════
 *
 * `testId` lands on the CARD — so it resolves in every state, including while
 * the chart inside is still a skeleton — and the drill link is
 * `<testId>-details`. The plot itself is addressed through `MetricChart`'s own
 * `testId`, which the caller passes down.
 */
export interface DrillChartCardProps {
  /** Already-translated card title. Rendered as the panel's `<h2>`. */
  title: string;
  /** One localized sentence: what this panel measures. Renders the info button. */
  info?: string;
  /** Where "Details →" goes — normally `detailPath(domain, metric)`. */
  to: string;
  /** `data-testid` on the card; the link becomes `<testId>-details`. */
  testId?: string;
  /** Extra classes on the card (e.g. `xl:col-span-2`). */
  className?: string;
  /** A legend or caption under the header. */
  caption?: ReactNode;
  /** Truthy ⇒ the card renders the error branch instead of its children. */
  error?: unknown;
  onRetry?: () => void;
  children: ReactNode;
}

export function DrillChartCard({
  title,
  info,
  to,
  testId,
  className,
  caption,
  error,
  onRetry,
  children,
}: DrillChartCardProps) {
  const { t } = useTranslation(['analytics']);

  return (
    <PanelCard
      title={title}
      info={info}
      caption={caption}
      error={error}
      onRetry={onRetry}
      testId={testId}
      className={className}
      toolbar={
        <Link
          to={to}
          aria-label={t('analytics:card.openBreakdown', { label: title })}
          data-testid={testId === undefined ? undefined : `${testId}-details`}
          className="inline-flex items-center gap-1 rounded-[var(--btn-radius)] px-1.5 py-0.5 text-xs font-medium text-primary transition-opacity duration-[var(--speed)] outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {t('analytics:card.details')}
          {/* Directional: "onward" is toward the reading END, which is left in
              Arabic. The glyph mirrors; the semantics do not. */}
          <ArrowRight className="size-3 rtl:rotate-180" aria-hidden />
        </Link>
      }
    >
      {children}
    </PanelCard>
  );
}

export default DrillChartCard;
