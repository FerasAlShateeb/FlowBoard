import { useTranslation } from 'react-i18next';
import type { TelemetryOverview } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import ErrorState from '@/components/common/ErrorState';
import MetricTile, { KpiSkeleton } from '@/components/admin/analytics/MetricTile';
import { detailPath } from '@/components/admin/analytics/metric-registry';

import { useTelemetryFormat } from './telemetry-format';

/**
 * The five headline numbers, above the ops charts — now the console's entry
 * point rather than a dead end.
 *
 * ── ROUND 2: EVERY TILE DRILLS ──────────────────────────────────────────────
 * These were five static cards: an admin read "58 tasks created" and had
 * nowhere to go with it. Each is now a {@link MetricTile}, so the whole card is
 * a link into the analytics drill-down that explains the number — the same
 * doctrine every KPI in the console follows.
 *
 * The destinations are per-METRIC, not all pointed at one dashboard: DAU and
 * the event count belong to Engagement, the task figures and active projects to
 * Work. A tile that drilled into a domain that does not measure it would be a
 * link that lies, which is worse than the dead end it replaced.
 *
 * ── THE WINDOWS DO NOT MATCH, AND THAT IS FINE ──────────────────────────────
 * `/admin/telemetry/overview` takes NO range: two of these are defined against
 * "today" and three against "the last 7 days", fixed, so that two people
 * quoting DAU mean the same thing. The drill-down opens on its own 30-day
 * default. Each tile's caption states its own window precisely so the reader is
 * never comparing two numbers that measure different spans without knowing it.
 *
 * ── ONE ERROR STATE FOR FIVE TILES, DELIBERATELY ────────────────────────────
 * The opposite of the reports dashboard's per-card degradation, and for a
 * reason: those six cards are six INDEPENDENT queries, so one failing is
 * genuinely local news. These five numbers come from ONE request. If it fails
 * there is nothing to show in any tile, and five identical error boxes would be
 * five times the noise for one piece of information — so the row renders one.
 *
 * ── THE SKELETON HAS THE ROW'S EXACT FOOTPRINT ──────────────────────────────
 * Same grid, same tile height (`KpiSkeleton` is the tile's own shape). A stat
 * row that pops into existence pushes the charts down the page as the request
 * resolves, which is the visual signature of a slow dashboard even on a fast
 * one.
 */

/** Tile → where its number is explained. Typed, so a bad link cannot ship. */
const TILE_LINKS = {
  dau: detailPath('engagement', 'dau'),
  eventsToday: detailPath('engagement', 'events-by-type'),
  tasksCreated7d: detailPath('work', 'tasks-created'),
  tasksCompleted7d: detailPath('work', 'tasks-completed'),
  activeProjects: detailPath('work', 'by-project'),
} as const;

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

  const tiles = [
    {
      key: 'dau' as const,
      label: t('admin:overview.dau'),
      hint: t('admin:overview.dauHint'),
      value: overview?.dau ?? 0,
    },
    {
      key: 'eventsToday' as const,
      label: t('admin:overview.eventsToday'),
      hint: t('admin:overview.eventsTodayHint'),
      value: overview?.eventsToday ?? 0,
    },
    {
      key: 'tasksCreated7d' as const,
      label: t('admin:overview.tasksCreated'),
      hint: t('admin:overview.tasksCreatedHint'),
      value: overview?.tasksCreated7d ?? 0,
    },
    {
      key: 'tasksCompleted7d' as const,
      label: t('admin:overview.tasksCompleted'),
      hint: t('admin:overview.tasksCompletedHint'),
      value: overview?.tasksCompleted7d ?? 0,
    },
    {
      key: 'activeProjects' as const,
      label: t('admin:overview.activeProjects'),
      hint: t('admin:overview.activeProjectsHint'),
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
      {tiles.map((tile) =>
        isPending ? (
          <KpiSkeleton key={tile.key} />
        ) : (
          <MetricTile
            key={tile.key}
            metric={tile.key}
            label={tile.label}
            // The digits are Latin in Arabic too (`lib/lang-policy`), and
            // `StatTile` already pins the value cell to `tabular-nums`.
            value={format.count(tile.value)}
            caption={tile.hint}
            to={TILE_LINKS[tile.key]}
          />
        ),
      )}
    </div>
  );
}

export default TelemetryStatRow;
