import { useTranslation } from 'react-i18next';
import type { WipState } from '@/hooks/useTaskMutations';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * `n/limit` in a column header, tinted by how full the column is.
 *
 * THREE STATES, THREE TREATMENTS:
 *   - **under** — muted outline. A limit nobody is near is background
 *     information, and colouring it teaches the eye to ignore the colour.
 *   - **at limit** — warning tint. One more card breaches it, which is
 *     precisely when a WIP limit is supposed to be visible.
 *   - **over** — danger tint. Reachable WITHOUT anyone having dropped a card:
 *     lowering the limit in the workflow editor, or a bulk import, leaves a
 *     column legitimately over. The board renders that rather than refusing to
 *     draw, because the number is the truth and the limit is the goal.
 *
 * Renders NOTHING when the column has no limit — an unlimited column showing
 * "12/∞" is noise in a header that is already carrying a name, a colour and a
 * count.
 */
export function WipLimitBadge({
  wip,
  statusName,
  className,
}: {
  wip: WipState;
  /** Named in the tooltip so the message stands alone for a screen reader. */
  statusName: string;
  className?: string;
}) {
  const { t } = useTranslation(['board']);

  if (wip.limit === null) return null;

  const variant = wip.over ? 'soft-danger' : wip.atLimit ? 'soft-warning' : 'outline';
  const state = wip.over
    ? t('board:wip.over')
    : wip.atLimit
      ? t('board:wip.atLimit')
      : t('board:wip.label', { count: wip.count, limit: wip.limit });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={variant}
          data-slot="wip-badge"
          data-wip={wip.over ? 'over' : wip.atLimit ? 'at-limit' : 'under'}
          // `tabular-nums` so the badge does not jitter in width as the count
          // ticks between 9 and 10 during a drag.
          className={cn('font-mono text-[11px] tabular-nums', className)}
          aria-label={`${statusName} — ${t('board:wip.label', { count: wip.count, limit: wip.limit })}`}
        >
          {/* An LTR island: `12/3` is a figure pair, and mirroring it under RTL
              would read as the limit over the count. */}
          <span dir="ltr">{t('board:wip.badge', { count: wip.count, limit: wip.limit })}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{state}</TooltipContent>
    </Tooltip>
  );
}

export default WipLimitBadge;
