import { useTranslation } from 'react-i18next';
import type { TopEndpoint } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import { useTopEndpoints } from '@/hooks/useAdminTelemetry';

import { useTelemetryFormat } from './telemetry-format';
import type { TelemetryWindow } from './telemetry-range';

/**
 * The busiest endpoints in the window, with their latency and error share.
 *
 * ── THE ERROR RATE IS COLOURED IN THREE STEPS, NOT SHADED ───────────────────
 * A continuous gradient would ask the reader to distinguish 1.8% from 2.4% by
 * hue, which nobody can do and nobody needs to. There are three ANSWERS worth
 * giving — "fine", "worth a look", "on fire" — so there are three treatments:
 *
 *     0        → muted. Zero is the expected state; painting it green would
 *                make the healthy majority the loudest thing in the table.
 *     < 1%     → warning tint.
 *     ≥ 1%     → danger tint.
 *
 * One in a hundred requests failing with a 5xx is already a bad day for an
 * endpoint, which is why the danger threshold is that low. The tokens come from
 * `ui/badge`'s `soft-*` variants, so the tints follow the Theme Studio.
 *
 * ── THE PATH IS A PATTERN, AND IS RENDERED LTR ──────────────────────────────
 * `request_logs.path` stores `/api/projects/:projectId/tasks`, never the
 * interpolated URL — otherwise this table would be a list of uuids (see
 * `db/schema/telemetry.ts`). A path is code, so its cell keeps `dir="ltr"` even
 * in Arabic: a leading slash rendered at the reading end of an RTL run turns
 * `/api/tasks` into `api/tasks/`.
 */

/** The share above which an endpoint is a problem rather than a curiosity. */
const DANGER_ERROR_RATE = 0.01;

function errorVariant(rate: number): 'secondary' | 'soft-warning' | 'soft-danger' {
  if (rate === 0) return 'secondary';
  return rate >= DANGER_ERROR_RATE ? 'soft-danger' : 'soft-warning';
}

export function TopEndpointsTable({
  endpoints,
  className,
}: {
  endpoints: readonly TopEndpoint[];
  className?: string;
}) {
  const { t } = useTranslation(['admin']);
  const format = useTelemetryFormat();

  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('admin:endpoints.column.endpoint')}</TableHead>
          <TableHead className="text-end">{t('admin:endpoints.column.count')}</TableHead>
          <TableHead className="text-end">{t('admin:endpoints.column.avg')}</TableHead>
          <TableHead className="text-end">{t('admin:endpoints.column.errorRate')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {endpoints.map((endpoint) => (
          <TableRow key={`${endpoint.method} ${endpoint.path}`}>
            <TableCell className="max-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                  {endpoint.method}
                </Badge>
                <span dir="ltr" className="truncate font-mono text-xs text-foreground">
                  {endpoint.path}
                </span>
              </div>
            </TableCell>
            <TableCell className="text-end [font-variant-numeric:tabular-nums]">
              {format.count(endpoint.count)}
            </TableCell>
            <TableCell className="text-end [font-variant-numeric:tabular-nums]">
              {format.ms(endpoint.avgDurationMs)}
              <span className="ms-1 text-xs text-muted-foreground">{t('admin:units.ms')}</span>
            </TableCell>
            <TableCell className="text-end">
              <Badge
                variant={errorVariant(endpoint.errorRate)}
                className="[font-variant-numeric:tabular-nums]"
              >
                {format.share(endpoint.errorRate)}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The panel: the query, and the three states every surface in FlowBoard owes
 * the user.
 *
 * Not built on `ReportCard` — that shell has a fixed 16:10 plot aspect so six
 * charts stay the same height, which is exactly wrong for a table whose height
 * is its row count.
 */
export function TopEndpointsCard({
  window,
  limit,
  className,
}: {
  window: TelemetryWindow;
  limit?: number;
  className?: string;
}) {
  const { t } = useTranslation(['admin']);
  const query = useTopEndpoints(window, limit);
  const endpoints = query.data?.endpoints ?? [];

  return (
    <Card className={cn('flex flex-col gap-3 p-[var(--card-pad)]', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t('admin:endpoints.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('admin:endpoints.subtitle')}</p>
      </div>

      {query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} className="py-8" />
      ) : query.isPending ? (
        <div className="flex flex-col gap-2" data-testid="top-endpoints-skeleton">
          {SKELETON_ROWS.map((width) => (
            <Skeleton key={width} className="h-6" style={{ width: `${width}%` }} />
          ))}
        </div>
      ) : endpoints.length === 0 ? (
        <EmptyState
          title={t('admin:endpoints.empty')}
          message={t('admin:endpoints.emptyBody')}
          className="py-8"
        />
      ) : (
        <TopEndpointsTable endpoints={endpoints} />
      )}
    </Card>
  );
}

/** A ragged profile — an even one reads as a loaded table. */
const SKELETON_ROWS = [100, 92, 84, 78, 70] as const;

export default TopEndpointsTable;
