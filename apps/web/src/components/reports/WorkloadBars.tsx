import { useTranslation } from 'react-i18next';
import type { WorkloadAssignee } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import UserAvatar from '@/components/common/UserAvatar';
import { useWorkload } from '@/hooks/useReports';

import ReportCard from './ReportCard';
import { useChartFormat } from './chart-format';
import { CHART_SERIES } from './chart-theme';
import { workloadHeadline, workloadRows, workloadScale } from './report-summaries';

/**
 * Workload — open points per assignee, heaviest first, unassigned last.
 *
 * ── WHY THIS ONE IS NOT RECHARTS (a deliberate deviation) ─────────────────
 * The other five reports are Recharts plots. This one is CSS: a row per person,
 * each with an avatar, a name and a proportional track. Three reasons, all of
 * which Recharts loses on:
 *
 *   1. **Avatars.** The row label is a person, and a person is a face plus a
 *      name. Recharts' category axis renders SVG `<text>`; getting an `<img>`
 *      and a coloured initials fallback in there means a custom tick with a
 *      `<foreignObject>`, which is exactly the HTML this component already is —
 *      only nested inside an SVG and unstyleable by Tailwind.
 *   2. **RTL.** Every other chart is an LTR island because Recharts cannot
 *      mirror (see `ChartFrame`). A horizontal bar chart is the one shape where
 *      that hurts: a bar must grow from the READING START, so under Arabic it
 *      has to grow right-to-left. As HTML with logical properties it does,
 *      automatically, and the whole island exception disappears.
 *   3. **Accessibility.** A list of names with values is genuinely readable as
 *      text. `role="img"` + one summary sentence — correct for a line chart,
 *      where the alternative is a bag of paths — would here THROW AWAY per-row
 *      detail a screen-reader user can otherwise have in full. So the summary
 *      is a `<figcaption>` and the rows stay a real list.
 *
 * The colours still come from the same `--chart-*` tokens as the plots, so it
 * reads as part of the set.
 *
 * BAR LENGTH IS OPEN POINTS, annotated with the task count — with a documented
 * fallback to counts when nothing is estimated (see `workloadScale`).
 */
export function WorkloadBars({ assignees }: { assignees: readonly WorkloadAssignee[] }) {
  const { t } = useTranslation(['reports']);
  const format = useChartFormat();

  const rows = workloadRows(assignees);
  const scale = workloadScale(rows);
  const headline = workloadHeadline(assignees);

  const summary = t('reports:workload.summary', {
    people: format.count(headline?.people ?? 0),
    tasks: format.count(headline?.tasks ?? 0),
    points: format.decimal(headline?.points ?? 0),
  });

  return (
    <figure className="flex h-full w-full flex-col" data-slot="workload-bars">
      <figcaption className="sr-only">{summary}</figcaption>
      <ul className="flex h-full flex-col justify-center gap-2 overflow-y-auto pe-1">
        {rows.map((row) => {
          const value = scale.metric === 'points' ? row.openPoints : row.openTasks;
          // `max` is > 0 whenever a row survived the filter, but a division is
          // not the place to rely on that.
          const width = scale.max > 0 ? Math.max((value / scale.max) * 100, 2) : 0;
          const name = row.user?.name ?? t('reports:workload.unassigned');

          return (
            <li key={row.user?.id ?? 'unassigned'} className="flex flex-col gap-1">
              <div className="flex min-w-0 items-center gap-2">
                <UserAvatar user={row.user} size="xs" label="" />
                <span
                  className={cn(
                    'truncate text-xs',
                    row.user ? 'text-foreground' : 'text-muted-foreground italic',
                  )}
                >
                  {name}
                </span>
                <span className="ms-auto shrink-0 text-[11px] text-muted-foreground [font-variant-numeric:tabular-nums]">
                  {t('reports:workload.points', { points: format.decimal(row.openPoints) })}
                  {' · '}
                  {t('reports:workload.tasks', { tasks: format.count(row.openTasks) })}
                </span>
              </div>
              {/*
                A native progress semantics pair: the track is decorative, the
                accessible value lives on the row text above, so the bar itself
                is hidden from AT rather than announced twice.
              */}
              <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full transition-[width] duration-[var(--speed)]"
                  style={{ width: `${width}%`, backgroundColor: CHART_SERIES.primary }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

/**
 * The dashboard tile.
 *
 * "No open work" is a legitimate, cheerful answer here rather than a failure —
 * the message says which of the two ways it can happen (everything done, or
 * nothing estimated) so the reader does not go looking for a broken endpoint.
 */
export function WorkloadCard({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation(['reports']);
  const query = useWorkload(projectId);
  const assignees = query.data?.assignees ?? [];

  return (
    <ReportCard
      title={t('reports:workload.title')}
      info={t('reports:workload.info')}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={workloadHeadline(assignees) === null}
      emptyTitle={t('reports:workload.empty.title')}
      emptyMessage={t('reports:workload.empty.body')}
    >
      <WorkloadBars assignees={assignees} />
    </ReportCard>
  );
}

export default WorkloadBars;
