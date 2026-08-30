import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  type ScatterPointItem,
  type TooltipContentProps,
} from 'recharts';
import type { CycleTimeReport, CycleTimeTask } from '@flowboard/shared';

import { useCycleTime } from '@/hooks/useReports';

import ChartFrame from './ChartFrame';
import ChartLegend from './ChartLegend';
import ReportCard from './ReportCard';
import type { DateRange } from './report-range';
import { useChartFormat } from './chart-format';
import {
  AXIS_TICK,
  CHART_CHROME,
  CHART_SERIES,
  chartAnimation,
  DASH,
  PLOT_MARGIN,
  STROKE,
  useColdChart,
} from './chart-theme';
import { cycleTimeHeadline } from './report-summaries';

/**
 * Cycle time — one dot per resolved task: when it was done (x) against how long
 * it took (y), with the p50 and p90 reference lines through the cloud.
 *
 * A SCATTER, NOT AN AVERAGE LINE. Cycle time is a DISTRIBUTION, and its
 * interesting feature is the tail: the three tickets that took eleven days are
 * the ones worth a conversation, and any aggregation hides exactly those. The
 * percentiles are drawn as lines THROUGH the cloud so the reader sees both the
 * summary and what it is summarising.
 *
 * THE PERCENTILES ARE THE SERVER'S. They are computed over the same rows
 * returned in `tasks` (see `cycleTimeReportSchema`), so the lines can never
 * disagree with the dots — recomputing them here on a paginated or filtered
 * subset is precisely how that drifts.
 *
 * THE CLOCK STARTS AT FIRST `in_progress`, not at creation: a year in the
 * backlog is not cycle time. That is server-side too; the tooltip shows both
 * ends so the number is auditable.
 *
 * CLICKING A DOT OPENS THE TASK. `key` is on the contract (`taskKeySchema`), so
 * the dashboard can deep-link into the route-layered task sheet
 * (`…/dashboard/t/FB-142`) without a lookup.
 */
interface ScatterRow {
  /** The resolution instant, as epoch ms — a numeric x axis. */
  x: number;
  hours: number;
  key: string;
  startedAt: string;
  resolvedAt: string;
}

/** Report rows → plottable points. Rows with an unparseable stamp are dropped. */
export function toScatterRows(tasks: readonly CycleTimeTask[]): ScatterRow[] {
  const rows: ScatterRow[] = [];
  for (const task of tasks) {
    const at = Date.parse(task.resolvedAt);
    if (Number.isNaN(at)) continue;
    rows.push({
      x: at,
      hours: task.hours,
      key: task.key,
      startedAt: task.startedAt,
      resolvedAt: task.resolvedAt,
    });
  }
  return rows;
}

/** Narrows Recharts' `any`-typed point payload back to our own row shape. */
function rowOf(payload: unknown): ScatterRow | null {
  if (payload === null || typeof payload !== 'object') return null;
  const candidate = payload as Partial<ScatterRow>;
  return typeof candidate.key === 'string' && typeof candidate.hours === 'number'
    ? (candidate as ScatterRow)
    : null;
}

export function CycleTimeScatter({
  report,
  onSelectTask,
}: {
  report: CycleTimeReport;
  /** Opens the task sheet. Omitted, the dots are informational only. */
  onSelectTask?: (taskKey: string) => void;
}) {
  const { t } = useTranslation(['reports']);
  const format = useChartFormat();
  // Registry entry #6: a COLD load draws itself in, a warm refetch does not,
  // and Reduced motion never does. One call, spread onto every series below.
  const animation = chartAnimation(useColdChart());
  const rows = useMemo(() => toScatterRows(report.tasks), [report.tasks]);
  const headline = cycleTimeHeadline(report);

  // `p50`/`p90` are legitimately `null` (nothing resolved in the window), and a
  // sentence reading "median null hours" is worse than no sentence at all.
  const summary = t('reports:cycleTime.summary', {
    tasks: format.count(headline?.tasks ?? 0),
    p50: headline?.p50 == null ? '—' : format.decimal(headline.p50),
    p90: headline?.p90 == null ? '—' : format.decimal(headline.p90),
  });

  const handleClick = (point: ScatterPointItem): void => {
    if (!onSelectTask) return;
    const row = rowOf(point.payload);
    if (row) onSelectTask(row.key);
  };

  return (
    <ChartFrame summary={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ ...PLOT_MARGIN }}>
          <CartesianGrid stroke={CHART_CHROME.grid} strokeDasharray={DASH.grid} vertical={false} />
          <XAxis
            type="number"
            dataKey="x"
            // A time axis, so the gaps between resolution days are real gaps —
            // a category axis would space three tickets a month apart evenly.
            domain={['dataMin', 'dataMax']}
            scale="time"
            tickFormatter={format.instantTick}
            stroke={CHART_CHROME.axis}
            tick={{ ...AXIS_TICK }}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis
            type="number"
            dataKey="hours"
            stroke={CHART_CHROME.axis}
            tick={{ ...AXIS_TICK }}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={format.decimal}
          />
          {/* Uniform dot size: the third dimension carries no meaning here. */}
          <ZAxis range={[36, 36]} />
          <Tooltip
            cursor={{ stroke: CHART_CHROME.grid, strokeDasharray: DASH.grid }}
            content={(props) => <CycleTimeTooltip {...props} />}
          />
          {report.p50 === null ? null : (
            <ReferenceLine
              y={report.p50}
              stroke={CHART_CHROME.guide}
              strokeWidth={STROKE.guide}
              strokeDasharray={DASH.guide}
              label={{
                value: `${t('reports:cycleTime.p50')} · ${format.decimal(report.p50)}`,
                position: 'insideTopLeft',
                fill: CHART_CHROME.text,
                fontSize: 11,
              }}
            />
          )}
          {report.p90 === null ? null : (
            <ReferenceLine
              y={report.p90}
              stroke={CHART_SERIES.warning}
              strokeWidth={STROKE.guide}
              strokeDasharray={DASH.guide}
              label={{
                value: `${t('reports:cycleTime.p90')} · ${format.decimal(report.p90)}`,
                position: 'insideTopLeft',
                fill: CHART_CHROME.text,
                fontSize: 11,
              }}
            />
          )}
          <Scatter
            data={rows}
            fill={CHART_SERIES.primary}
            fillOpacity={0.75}
            onClick={handleClick}
            style={onSelectTask ? { cursor: 'pointer' } : undefined}
            {...animation}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/**
 * The scatter's own hover card. Bespoke rather than the shared
 * `ChartTooltipContent` because a scatter point is ONE entity with several
 * facts (task, duration, both ends of the clock), not several series sharing an
 * x — a row-per-series layout would print "x: 1756252800000".
 */
function CycleTimeTooltip({ active, payload }: TooltipContentProps) {
  const { t } = useTranslation(['reports']);
  const format = useChartFormat();

  if (!active || !payload || payload.length === 0) return null;
  const row = rowOf(payload[0]?.payload);
  if (!row) return null;

  return (
    <div className="pointer-events-none rounded-[var(--radius)] border border-border bg-surface-raised px-2.5 py-1.5 text-xs shadow-[var(--shadow-2)] [font-variant-numeric:tabular-nums]">
      {/* A task key is a Latin identifier in every locale. */}
      <p className="mb-1 font-medium text-foreground" dir="ltr">
        {row.key}
      </p>
      <p className="text-muted-foreground">
        {format.decimal(row.hours)} {t('reports:units.hours')}
      </p>
      <p className="text-muted-foreground">{format.instantTick(row.resolvedAt)}</p>
    </div>
  );
}

function CycleTimeLegend({ report }: { report: CycleTimeReport }) {
  const { t } = useTranslation(['reports']);
  return (
    <ChartLegend
      entries={[
        { label: t('reports:cycleTime.tasks'), color: CHART_SERIES.primary },
        ...(report.p50 === null
          ? []
          : [{ label: t('reports:cycleTime.p50'), color: CHART_CHROME.guide, dashed: true }]),
        ...(report.p90 === null
          ? []
          : [{ label: t('reports:cycleTime.p90'), color: CHART_SERIES.warning, dashed: true }]),
      ]}
    />
  );
}

/** An empty report, so the card can render its legend/chart props unconditionally. */
const NO_CYCLE_TIME: CycleTimeReport = { tasks: [], p50: null, p90: null };

/** The dashboard tile. */
export function CycleTimeCard({
  projectId,
  range,
  onSelectTask,
}: {
  projectId: string | null;
  range: DateRange;
  onSelectTask?: (taskKey: string) => void;
}) {
  const { t } = useTranslation(['reports']);
  const query = useCycleTime(projectId, range);
  const report = query.data ?? NO_CYCLE_TIME;

  return (
    <ReportCard
      title={t('reports:cycleTime.title')}
      info={t('reports:cycleTime.info')}
      caption={<CycleTimeLegend report={report} />}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={cycleTimeHeadline(report) === null}
      emptyTitle={t('reports:cycleTime.empty.title')}
      emptyMessage={t('reports:cycleTime.empty.body')}
    >
      <CycleTimeScatter report={report} onSelectTask={onSelectTask} />
    </ReportCard>
  );
}

export default CycleTimeScatter;
