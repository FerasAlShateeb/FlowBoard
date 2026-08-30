import { useTranslation } from 'react-i18next';
import type { TopEndpoint } from '@flowboard/shared';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PanelCard } from '@/components/dashboard/PanelCard';
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
 * ── W3.1: THIS IS A `PanelCard` NOW ─────────────────────────────────────────
 * It was a hand-rolled `Card` with its own `error → pending → empty → content`
 * ladder and its own skeleton, written before W1.4's dashboard kit existed and
 * explicitly NOT on `ReportCard`, whose fixed 16:10 plot aspect is exactly
 * wrong for a table whose height is its row count. `PanelCard` is the shell
 * that solved that: same ladder, same order, and a `table` skeleton that
 * reserves row-heights instead of a plot. Adopting it deletes a duplicate
 * ladder and makes this panel the same object as every analytics drill-down.
 *
 * The subtitle moved from a `<p>` beside the heading into the info tooltip,
 * which is where `PanelCard` puts one-sentence explanations — and where it is
 * reachable by keyboard rather than being a line of grey text that wraps under
 * a narrow column.
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
    <PanelCard
      title={t('admin:endpoints.title')}
      info={t('admin:endpoints.subtitle')}
      className={className}
      testId="top-endpoints-card"
      error={query.error}
      onRetry={() => void query.refetch()}
      isPending={query.isPending}
      isEmpty={endpoints.length === 0}
      emptyTitle={t('admin:endpoints.empty')}
      emptyMessage={t('admin:endpoints.emptyBody')}
      skeleton={{ kind: 'table', rows: SKELETON_ROWS }}
    >
      <TopEndpointsTable endpoints={endpoints} />
    </PanelCard>
  );
}

/** Deep enough to read as a table, shallow enough not to read as a page. */
const SKELETON_ROWS = 5;

export default TopEndpointsTable;
