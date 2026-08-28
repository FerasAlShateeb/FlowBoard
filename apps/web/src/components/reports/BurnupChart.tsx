import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BurnupDay } from '@flowboard/shared';

import { useBurnup } from '@/hooks/useReports';

import ChartFrame from './ChartFrame';
import ReportCard from './ReportCard';
import ChartLegend from './ChartLegend';
import { ChartTooltipContent } from './ChartTooltip';
import { useChartFormat } from './chart-format';
import { AXIS_TICK, CHART_CHROME, CHART_SERIES, DASH, PLOT_MARGIN, STROKE } from './chart-theme';
import { burnupHeadline } from './report-summaries';

/**
 * Burnup — completed points climbing towards the sprint's scope.
 *
 * WHY THIS SITS NEXT TO THE BURNDOWN rather than replacing it: a burndown shows
 * a team falling behind and a team whose scope grew as the same flat line. The
 * burnup separates them, because scope is its own series. A rising `scopePoints`
 * line is the chart's entire reason to exist.
 *
 * SCOPE USES THE "PLANNED" TOKEN (`--chart-4`) and completion the "delivered"
 * one (`--chart-2`) — the same pairing the velocity bars use, so the two cards
 * teach the reader one colour code between them.
 */
export function BurnupChart({ days }: { days: readonly BurnupDay[] }) {
  const { t } = useTranslation(['reports']);
  const format = useChartFormat();
  const headline = burnupHeadline(days);

  const summary = t('reports:burnup.summary', {
    days: format.count(headline?.days ?? 0),
    completed: format.decimal(headline?.completed ?? 0),
    scope: format.decimal(headline?.scope ?? 0),
  });

  const labels = {
    completedPoints: t('reports:burnup.completed'),
    scopePoints: t('reports:burnup.scope'),
  };

  return (
    <ChartFrame summary={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={[...days]} margin={{ ...PLOT_MARGIN }}>
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
            width={36}
            tickFormatter={format.decimal}
          />
          <Tooltip
            cursor={{ stroke: CHART_CHROME.grid }}
            content={(props) => (
              <ChartTooltipContent
                {...props}
                labels={labels}
                formatHeading={format.dayFull}
                formatValue={format.decimal}
                unit={t('reports:units.points')}
              />
            )}
          />
          {/* Scope first: it is the ceiling the completion line rises to. */}
          <Line
            type="stepAfter"
            dataKey="scopePoints"
            stroke={CHART_SERIES.planned}
            strokeWidth={STROKE.guide}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="completedPoints"
            stroke={CHART_SERIES.delivered}
            strokeWidth={STROKE.data}
            dot={false}
            activeDot={{ r: 3, fill: CHART_SERIES.delivered }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function BurnupLegend() {
  const { t } = useTranslation(['reports']);
  return (
    <ChartLegend
      entries={[
        { label: t('reports:burnup.completed'), color: CHART_SERIES.delivered },
        { label: t('reports:burnup.scope'), color: CHART_SERIES.planned },
      ]}
    />
  );
}

/** The dashboard tile — same two empty cases as the burndown. */
export function BurnupCard({
  projectId,
  sprintId,
}: {
  projectId: string | null;
  sprintId: string | null;
}) {
  const { t } = useTranslation(['reports']);
  const query = useBurnup(projectId, sprintId);
  const days = query.data?.days ?? [];
  const hasSprint = Boolean(sprintId);

  return (
    <ReportCard
      title={t('reports:burnup.title')}
      info={t('reports:burnup.info')}
      caption={<BurnupLegend />}
      isPending={hasSprint && query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={!hasSprint || burnupHeadline(days) === null}
      emptyTitle={hasSprint ? t('reports:burnup.empty.noDays') : t('reports:burnup.empty.noSprint')}
      emptyMessage={
        hasSprint ? t('reports:burnup.empty.noDaysBody') : t('reports:burnup.empty.noSprintBody')
      }
    >
      <BurnupChart days={days} />
    </ReportCard>
  );
}

export default BurnupChart;
