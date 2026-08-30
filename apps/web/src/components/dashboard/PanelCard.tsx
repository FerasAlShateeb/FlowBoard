import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { usePanelChromeCopy } from '@/components/dashboard/chrome-copy';

/**
 * The panel every dashboard section renders inside, and the reason one failing
 * endpoint cannot blank a page.
 *
 * ═══ THE STATE LADDER, IN THIS ORDER ═════════════════════════════════════
 *
 *     error  →  pending  →  empty  →  content
 *
 * **Error beats pending.** A background refetch of a query that has already
 * failed must not replace the retry button with a skeleton — the user watches
 * it flicker and never gets to click. **Empty beats content**, because an axis
 * pair with nothing between them reads as a bug rather than as "no data".
 * Nothing here is a Suspense boundary and nothing throws: a panel that cannot
 * draw renders a message inside its own frame and its neighbours are unaware.
 *
 * ═══ WHY THERE IS NO FIXED ASPECT (THE DELIBERATE SPLIT FROM `ReportCard`) ═
 *
 * `components/reports/ReportCard` pins its body to 16:10 so six chart tiles
 * stay the same height while their queries land one by one. That is right for a
 * grid of six charts and WRONG for the analytics console, which puts a KPI row,
 * a 240px chart, a percentile ladder and a twenty-row table on the same page.
 * Forcing 16:10 on a table panel gives it either a scrollbar at ten rows or a
 * lake of white space at three.
 *
 * So the height comes from the CONTENT, and the anti-reflow guarantee is moved
 * into the {@link PanelSkeleton}: a `chart` skeleton reserves the height the
 * chart will occupy, a `table` skeleton reserves `rows` row-heights. The panel
 * therefore stops jumping for the same reason — it just measures the right
 * thing.
 *
 * ═══ THE INFO TOOLTIP IS NOT DECORATION ══════════════════════════════════
 *
 * A metric nobody can read is a picture. One localized sentence, on a real
 * focusable `<button>` so it is reachable without a pointer — the same contract
 * `ReportCard` established.
 *
 * ═══ COPY ════════════════════════════════════════════════════════════════
 *
 * `title`, `info`, `emptyTitle` and `emptyMessage` are the caller's, already
 * translated. The two strings this component needs of its OWN — the info
 * button's accessible name and the fallback empty heading — come from
 * `chrome-copy.ts`'s {@link usePanelChromeCopy}, NOT from a `useTranslation`
 * here.
 *
 * That is the kit's rule, and this file used to be the one place breaking it
 * (R2 W3.5): `chrome-copy.ts` opens by saying no component in the kit calls
 * `t()` itself, precisely so the SHAPES it exports are the contract and the keys
 * behind them stay an implementation detail. A panel that reached into
 * `reports:` directly meant the reports dashboard's namespace could not be
 * reorganized without breaking the analytics console, and it left two of the
 * kit's strings outside the KEPT/MINTED table a reviewer checks against.
 */

/**
 * What to draw while a panel is pending.
 *
 * A discriminated union rather than three booleans: a panel is one shape, and
 * `{ kind: 'chart', height: 240 }` cannot be accidentally combined with
 * `{ kind: 'table', rows: 8 }`.
 */
export type PanelSkeleton =
  { kind: 'kpi' } | { kind: 'chart'; height?: number } | { kind: 'table'; rows?: number };

/** Default chart-skeleton height, matching the console's standard plot. */
export const DEFAULT_CHART_HEIGHT = 240;

/** Default table-skeleton depth. Enough to read as a table, not as a page. */
export const DEFAULT_SKELETON_ROWS = 5;

export interface PanelCardProps {
  /** Already-translated panel title. Rendered as an `<h2>`. */
  title: string;
  /** One localized sentence: what this panel measures. Renders the info button. */
  info?: string;
  /** Per-panel controls at the reading end of the header row. */
  toolbar?: ReactNode;
  /** A legend or sub-caption. Rendered ONLY in the content branch. */
  caption?: ReactNode;
  /** The query's error. Truthy ⇒ the error branch, whatever else is true. */
  error?: unknown;
  /** Usually the query's `refetch`. Omitted ⇒ no retry button. */
  onRetry?: () => void;
  /** The query's pending flag. */
  isPending?: boolean;
  /** True when the query succeeded but there is nothing to draw. */
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  /** What the pending branch draws. Defaults to a chart-shaped block. */
  skeleton?: PanelSkeleton;
  /** The panel's real content. Rendered ONLY in the success-and-non-empty branch. */
  children: ReactNode;
  className?: string;
  /** Extra classes on the body wrapper — a min-height, a scroll container. */
  bodyClassName?: string;
  /** `data-testid` on the card. */
  testId?: string;
}

export function PanelCard({
  title,
  info,
  toolbar,
  caption,
  error,
  onRetry,
  isPending = false,
  isEmpty = false,
  emptyTitle,
  emptyMessage,
  skeleton = { kind: 'chart' },
  children,
  className,
  bodyClassName,
  testId,
}: PanelCardProps) {
  const copy = usePanelChromeCopy();

  const showContent = !error && !isPending && !isEmpty;

  return (
    <Card data-slot="panel-card" data-testid={testId} className={cn('gap-3', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          {info === undefined ? null : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={copy.infoLabel}
                  data-testid="panel-info"
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors duration-[var(--speed)] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <Info className="size-3.5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{info}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {toolbar === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5" data-print-hide>
            {toolbar}
          </div>
        )}
      </div>

      {/* A legend only belongs above content that actually exists. */}
      {showContent && caption !== undefined ? caption : null}

      <div className={cn('w-full', bodyClassName)}>
        {error ? (
          <ErrorState error={error} onRetry={onRetry} className="py-8" />
        ) : isPending ? (
          <PanelSkeletonBody skeleton={skeleton} />
        ) : isEmpty ? (
          <EmptyState
            title={emptyTitle ?? copy.emptyTitle}
            message={emptyMessage}
            className="py-8"
          />
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

/**
 * The three pending shapes.
 *
 * Each one reserves roughly the box its real content will occupy, which is what
 * replaces `ReportCard`'s fixed aspect ratio as the anti-reflow guarantee. The
 * `Skeleton` primitive is `aria-hidden` by default, and the wrapper carries no
 * role of its own: the panel's `aria-busy` story belongs to whatever renders
 * the query, not to a placeholder box.
 */
function PanelSkeletonBody({ skeleton }: { skeleton: PanelSkeleton }) {
  if (skeleton.kind === 'kpi') {
    return (
      <div className="flex flex-col gap-2" data-testid="panel-skeleton-kpi">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-3 w-40" />
      </div>
    );
  }

  if (skeleton.kind === 'table') {
    const rows = Math.max(1, skeleton.rows ?? DEFAULT_SKELETON_ROWS);
    return (
      <div className="flex flex-col gap-2" data-testid="panel-skeleton-table">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={`row-${String(index)}`} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  return (
    <Skeleton
      data-testid="panel-skeleton-chart"
      className="w-full"
      style={{ blockSize: skeleton.height ?? DEFAULT_CHART_HEIGHT }}
    />
  );
}
