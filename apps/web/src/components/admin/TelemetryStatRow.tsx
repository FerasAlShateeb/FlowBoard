import type { LucideIcon } from 'lucide-react';
import { Activity, CheckCircle2, FolderKanban, PlusCircle, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TelemetryOverview } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import ErrorState from '@/components/common/ErrorState';

import { useTelemetryFormat } from './telemetry-format';

/**
 * The five headline numbers, above the charts.
 *
 * ── ONE ERROR STATE FOR FIVE TILES, DELIBERATELY ────────────────────────────
 * The opposite of the reports dashboard's per-card degradation, and for a
 * reason: those six cards are six INDEPENDENT queries, so one failing is
 * genuinely local news. These five numbers come from ONE request. If it fails
 * there is nothing to show in any tile, and five identical error boxes would be
 * five times the noise for one piece of information — so the row renders one.
 *
 * ── THE SKELETON HAS THE ROW'S EXACT FOOTPRINT ──────────────────────────────
 * Same grid, same tile height. A stat row that pops into existence pushes the
 * charts down the page as the request resolves, which is the visual signature
 * of a slow dashboard even on a fast one.
 *
 * ── VALUES ARE `tabular-nums` AND `dir="ltr"` ───────────────────────────────
 * The digits are Latin in Arabic too (`lib/lang-policy`), and a number pinned
 * LTR inside an RTL card is how `1,204` stays `1,204` rather than acquiring a
 * mirrored thousands separator. The LABEL flips with the page; the numeral does
 * not.
 */
export function TelemetryStatRow({
  overview,
  isPending,
  error,
  onRetry,
  className,
}: {
  overview: TelemetryOverview | undefined;
  isPending: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation(['admin']);
  const format = useTelemetryFormat();

  const tiles: { key: string; label: string; hint: string; icon: LucideIcon; value: number }[] = [
    {
      key: 'dau',
      label: t('admin:overview.dau'),
      hint: t('admin:overview.dauHint'),
      icon: Users,
      value: overview?.dau ?? 0,
    },
    {
      key: 'eventsToday',
      label: t('admin:overview.eventsToday'),
      hint: t('admin:overview.eventsTodayHint'),
      icon: Activity,
      value: overview?.eventsToday ?? 0,
    },
    {
      key: 'tasksCreated7d',
      label: t('admin:overview.tasksCreated'),
      hint: t('admin:overview.tasksCreatedHint'),
      icon: PlusCircle,
      value: overview?.tasksCreated7d ?? 0,
    },
    {
      key: 'tasksCompleted7d',
      label: t('admin:overview.tasksCompleted'),
      hint: t('admin:overview.tasksCompletedHint'),
      icon: CheckCircle2,
      value: overview?.tasksCompleted7d ?? 0,
    },
    {
      key: 'activeProjects',
      label: t('admin:overview.activeProjects'),
      hint: t('admin:overview.activeProjectsHint'),
      icon: FolderKanban,
      value: overview?.activeProjects ?? 0,
    },
  ];

  if (error) {
    return (
      <Card className={cn('p-[var(--card-pad)]', className)}>
        <ErrorState error={error} onRetry={onRetry} className="py-6" />
      </Card>
    );
  }

  return (
    <div
      data-testid="telemetry-stat-row"
      className={cn('grid grid-cols-2 gap-[var(--gap)] sm:grid-cols-3 xl:grid-cols-5', className)}
    >
      {tiles.map((tile) => (
        <Card
          key={tile.key}
          data-slot="telemetry-stat"
          className="flex flex-col gap-1.5 p-[var(--card-pad)]"
        >
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <tile.icon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{tile.label}</span>
          </div>

          {isPending ? (
            <Skeleton className="h-7 w-16" />
          ) : (
            <p
              dir="ltr"
              className="text-2xl leading-tight font-semibold text-foreground [font-variant-numeric:tabular-nums]"
            >
              {format.count(tile.value)}
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">{tile.hint}</p>
        </Card>
      ))}
    </div>
  );
}

export default TelemetryStatRow;
