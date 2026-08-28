import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';

/**
 * The shell all six reports render inside — and the reason one failing endpoint
 * cannot blank the dashboard.
 *
 * PER-TILE DEGRADATION IS THE WHOLE DESIGN. Each card takes ITS OWN query's
 * three states and resolves them in a fixed order:
 *
 *     error  →  loading  →  empty  →  chart
 *
 * Error beats loading because a background refetch of a query that has already
 * failed must not replace the retry button with a skeleton (the user would
 * watch it flicker and never get to click). Empty beats chart because an axis
 * pair with nothing between them reads as a bug.
 *
 * Nothing here is a Suspense boundary and nothing throws: a card that cannot
 * draw renders a message inside its own frame, and the other five are unaware.
 *
 * THE BODY HAS A FIXED ASPECT so all six tiles are the same height whatever
 * state they are in — a grid that reflows as queries resolve one by one is the
 * visual signature of a slow dashboard even when it is fast.
 *
 * THE INFO TOOLTIP is not decoration: a burndown nobody can read is a picture.
 * One localized sentence, on a real focusable button so it is reachable by
 * keyboard.
 */
export interface ReportCardProps {
  /** Already translated. */
  title: string;
  /** One localized sentence: what this chart measures. */
  info: string;
  /** Per-card controls, rendered at the reading-end of the header row. */
  toolbar?: ReactNode;
  /** A legend or sub-caption, between the header and the plot. */
  caption?: ReactNode;
  isPending: boolean;
  error: unknown;
  onRetry?: () => void;
  /** True when the query succeeded but there is nothing to draw. */
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  /** The chart. Rendered ONLY in the success-and-non-empty branch. */
  children: ReactNode;
  className?: string;
}

export function ReportCard({
  title,
  info,
  toolbar,
  caption,
  isPending,
  error,
  onRetry,
  isEmpty = false,
  emptyTitle,
  emptyMessage,
  children,
  className,
}: ReportCardProps) {
  const { t } = useTranslation(['reports', 'common']);

  return (
    <Card
      data-slot="report-card"
      className={cn('flex flex-col gap-3 p-[var(--card-pad)]', className)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                // A button, not an icon on a div: the explanation has to be
                // reachable without a pointer.
                aria-label={t('reports:card.infoLabel')}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors duration-[var(--speed)] hover:text-foreground"
              >
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{info}</TooltipContent>
          </Tooltip>
        </div>
        {toolbar ? <div className="flex shrink-0 items-center gap-1.5">{toolbar}</div> : null}
      </div>

      {/* The legend only belongs above a plot that actually exists. */}
      {caption && !isPending && !error && !isEmpty ? caption : null}

      <div
        // 16:10 with a floor: wide enough for a 56-day axis, tall enough that
        // the workload bars do not squash on a phone.
        className="relative aspect-[16/10] min-h-[200px] w-full"
      >
        {error ? (
          <ErrorState error={error} onRetry={onRetry} className="h-full justify-center py-0" />
        ) : isPending ? (
          <ReportCardSkeleton />
        ) : isEmpty ? (
          <EmptyState
            title={emptyTitle ?? t('common:states.empty')}
            message={emptyMessage}
            className="h-full justify-center py-0"
          />
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

/**
 * The loading placeholder — a chart-SHAPED skeleton (an axis rail plus a ragged
 * row of bars), not a grey rectangle. It occupies the same footprint the plot
 * will, so nothing moves when the data lands.
 */
function ReportCardSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-2" data-testid="report-card-skeleton">
      <div className="flex flex-1 items-end gap-2">
        {SKELETON_BAR_HEIGHTS.map((height, index) => (
          <Skeleton
            // Static, ordered, never reordered — the index IS the identity here.
            key={index}
            className="min-w-2 flex-1"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
      <Skeleton className="h-2 w-full shrink-0" />
    </div>
  );
}

/** A deliberately irregular profile: an even one reads as a loaded bar chart. */
const SKELETON_BAR_HEIGHTS = [42, 68, 55, 80, 38, 62, 74, 48] as const;

export default ReportCard;
