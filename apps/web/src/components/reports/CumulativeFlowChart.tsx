import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CumulativeFlowDay } from '@flowboard/shared';

import { useCumulativeFlow } from '@/hooks/useReports';
import { useThemeStore } from '@/stores/useThemeStore';

import ChartFrame from './ChartFrame';
import ReportCard from './ReportCard';
import type { DateRange } from './report-range';
import ChartLegend from './ChartLegend';
import { ChartTooltipContent } from './ChartTooltip';
import { useChartFormat } from './chart-format';
import {
  AREA_FILL_OPACITY,
  AXIS_TICK,
  CHART_CHROME,
  CHART_SERIES,
  DASH,
  PLANNED_FILL_OPACITY,
  PLOT_MARGIN,
  fillOpacityFor,
} from './chart-theme';
import { cumulativeFlowHeadline } from './report-summaries';

/**
 * The cumulative-flow diagram — how many tasks sat in each status CATEGORY on
 * each day of the window.
 *
 * CATEGORIES, NOT COLUMNS. The API keys the counts by `todo` / `in_progress` /
 * `done` rather than by status id so the chart stays comparable across a
 * workflow edit — renaming or deleting a column would otherwise punch a hole in
 * the middle of the history (see `cumulativeFlowDaySchema`). The record is
 * exhaustive, zeroes included, so the three bands never gap and the stack is
 * always the full height of the backlog.
 *
 * STACK ORDER IS FIXED — to-do at the bottom, then in progress, then done —
 * because the shape a reader is trained to look for is the WIDTH of the middle
 * band: a widening `in_progress` ribbon is work piling up between the two
 * stable edges. Sorting the bands by size, or letting them float, destroys that
 * reading.
 *
 * The to-do band is `--chart-5` at low opacity: it is usually the largest area
 * on the chart and at full strength it would shout down the band that matters.
 */
interface FlowRow {
  date: string;
  todo: number;
  inProgress: number;
  done: number;
}

/** Flattens the per-day `counts` record into the flat rows Recharts wants. */
export function toFlowRows(days: readonly CumulativeFlowDay[]): FlowRow[] {
  return days.map((day) => ({
    date: day.date,
    todo: day.counts.todo,
    inProgress: day.counts.in_progress,
    done: day.counts.done,
  }));
}

export function CumulativeFlowChart({ days }: { days: readonly CumulativeFlowDay[] }) {
  const { t } = useTranslation(['reports']);
  const format = useChartFormat();
  const rows = useMemo(() => toFlowRows(days), [days]);
  const headline = cumulativeFlowHeadline(days);

  const summary = t('reports:cumulativeFlow.summary', {
    days: format.count(headline?.days ?? 0),
    todo: format.count(headline?.todo ?? 0),
    inProgress: format.count(headline?.inProgress ?? 0),
    done: format.count(headline?.done ?? 0),
  });

  const labels = {
    todo: t('reports:cumulativeFlow.todo'),
    inProgress: t('reports:cumulativeFlow.inProgress'),
    done: t('reports:cumulativeFlow.done'),
  };

  /**
   * THE `chartStyle` TOKEN, HONOURED (WP5.6).
   *
   * The Theme Studio has offered a "Filled areas or plain lines on the reports
   * dashboard" switch since WP4.5, and nothing read it: the token was written,
   * persisted and exported, and every chart ignored it. This is the dashboard's
   * only filled chart — burndown, burnup, velocity and cycle time are already
   * lines — so it is the one place the switch can mean anything, and honouring
   * it here is what makes the control stop lying.
   *
   * `line` drops the fill and leaves the stroke, which turns the stacked bands
   * into three cumulative lines. The stack ORDER is untouched: the shape a
   * reader looks for is the gap between the curves either way.
   */
  const chartStyle = useThemeStore((state) => state.chartStyle());
  const areaFill = fillOpacityFor(chartStyle, AREA_FILL_OPACITY);
  const plannedFill = fillOpacityFor(chartStyle, PLANNED_FILL_OPACITY);

  return (
    <ChartFrame summary={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ ...PLOT_MARGIN }}>
          <CartesianGrid stroke={CHART_CHROME.grid} strokeDasharray={DASH.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={format.dayTick}
            stroke={CHART_CHROME.axis}
            tick={{ ...AXIS_TICK }}
            tickLine={false}
            minTickGap={24}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke={CHART_CHROME.axis}
            tick={{ ...AXIS_TICK }}
            tickLine={false}
            axisLine={false}
            width={32}
            allowDecimals={false}
            tickFormatter={format.count}
          />
          <Tooltip
            cursor={{ stroke: CHART_CHROME.grid }}
            content={(props) => (
              <ChartTooltipContent
                {...props}
                labels={labels}
                formatHeading={format.dayFull}
                formatValue={format.count}
                unit={t('reports:units.tasks')}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="todo"
            stackId="flow"
            stroke={CHART_SERIES.quiet}
            fill={CHART_SERIES.quiet}
            fillOpacity={plannedFill}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="inProgress"
            stackId="flow"
            stroke={CHART_SERIES.primary}
            fill={CHART_SERIES.primary}
            fillOpacity={areaFill}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="done"
            stackId="flow"
            stroke={CHART_SERIES.delivered}
            fill={CHART_SERIES.delivered}
            fillOpacity={areaFill}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function CumulativeFlowLegend() {
  const { t } = useTranslation(['reports']);
  return (
    <ChartLegend
      entries={[
        { label: t('reports:cumulativeFlow.todo'), color: CHART_SERIES.quiet, faded: true },
        { label: t('reports:cumulativeFlow.inProgress'), color: CHART_SERIES.primary },
        { label: t('reports:cumulativeFlow.done'), color: CHART_SERIES.delivered },
      ]}
    />
  );
}

/**
 * The dashboard tile. Its empty case is "no flow in this window" — which the
 * headline reports for a window that is genuinely empty AND for one whose every
 * bucket is zero, because three flat zero bands are not a chart (see
 * `cumulativeFlowHeadline`). The message names the fix: widen the range.
 */
export function CumulativeFlowCard({
  projectId,
  range,
}: {
  projectId: string | null;
  range: DateRange;
}) {
  const { t } = useTranslation(['reports']);
  const query = useCumulativeFlow(projectId, range);
  const days = query.data?.days ?? [];

  return (
    <ReportCard
      title={t('reports:cumulativeFlow.title')}
      info={t('reports:cumulativeFlow.info')}
      caption={<CumulativeFlowLegend />}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={cumulativeFlowHeadline(days) === null}
      emptyTitle={t('reports:cumulativeFlow.empty.title')}
      emptyMessage={t('reports:cumulativeFlow.empty.body')}
    >
      <CumulativeFlowChart days={days} />
    </ReportCard>
  );
}

export default CumulativeFlowChart;
