import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { VelocitySprint } from '@flowboard/shared';

import { useVelocity } from '@/hooks/useReports';

import ChartFrame from './ChartFrame';
import ReportCard from './ReportCard';
import ChartLegend from './ChartLegend';
import { ChartTooltipContent } from './ChartTooltip';
import { useChartFormat } from './chart-format';
import {
  AXIS_TICK,
  CHART_CHROME,
  CHART_SERIES,
  DASH,
  PLANNED_FILL_OPACITY,
  PLOT_MARGIN,
  STROKE,
} from './chart-theme';
import { velocityAverage, velocityHeadline } from './report-summaries';

/**
 * Velocity — what each completed sprint committed to, next to what it actually
 * delivered.
 *
 * BOTH NUMBERS ARE STAMPS, NEVER RECOMPUTED. `committedPoints` is frozen when
 * the sprint starts and `completedPoints` when it completes (see
 * `sprints.schema.ts`); that is what stops velocity from being a moving target
 * that improves every time someone re-estimates an old ticket.
 *
 * GROUPED, NOT STACKED. The question is "did we deliver what we promised", and
 * only side-by-side bars let the eye compare two quantities directly — stacking
 * them would draw their SUM, which means nothing at all here.
 *
 * The committed bar is the "planned" token at low opacity and the completed bar
 * is the "delivered" token at full strength: the plan recedes, the fact reads.
 *
 * THE AVERAGE LINE is the number a planner actually leaves with, drawn in the
 * same dashed guide style as the burndown's ideal so guides look like guides
 * everywhere on the dashboard.
 */
export function VelocityChart({ sprints }: { sprints: readonly VelocitySprint[] }) {
  const { t } = useTranslation(['reports']);
  const format = useChartFormat();
  const headline = velocityHeadline(sprints);
  const average = velocityAverage(sprints);

  const summary = t('reports:velocity.summary', {
    sprints: format.count(headline?.sprints ?? 0),
    average: format.decimal(headline?.average ?? 0),
    last: format.decimal(headline?.last ?? 0),
  });

  const labels = {
    committedPoints: t('reports:velocity.committed'),
    completedPoints: t('reports:velocity.completed'),
  };

  return (
    <ChartFrame summary={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={[...sprints]} margin={{ ...PLOT_MARGIN }} barGap={2}>
          <CartesianGrid stroke={CHART_CHROME.grid} strokeDasharray={DASH.grid} vertical={false} />
          <XAxis
            dataKey="name"
            stroke={CHART_CHROME.axis}
            tick={{ ...AXIS_TICK }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={8}
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
            // A filled cursor rather than a line: on bars, a vertical rule sits
            // between the pair instead of highlighting it.
            cursor={{ fill: CHART_CHROME.grid, fillOpacity: 0.35 }}
            content={(props) => (
              <ChartTooltipContent
                {...props}
                labels={labels}
                formatValue={format.decimal}
                unit={t('reports:units.points')}
              />
            )}
          />
          <Bar
            dataKey="committedPoints"
            fill={CHART_SERIES.planned}
            fillOpacity={PLANNED_FILL_OPACITY}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="completedPoints"
            fill={CHART_SERIES.delivered}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
          {average === null ? null : (
            <ReferenceLine
              y={average}
              stroke={CHART_CHROME.guide}
              strokeWidth={STROKE.guide}
              strokeDasharray={DASH.guide}
              ifOverflow="extendDomain"
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function VelocityLegend({ sprints }: { sprints: readonly VelocitySprint[] }) {
  const { t } = useTranslation(['reports']);
  const format = useChartFormat();
  const average = velocityAverage(sprints);

  return (
    <ChartLegend
      entries={[
        { label: t('reports:velocity.committed'), color: CHART_SERIES.planned, faded: true },
        { label: t('reports:velocity.completed'), color: CHART_SERIES.delivered },
        ...(average === null
          ? []
          : [
              {
                label: `${t('reports:velocity.average')} · ${format.decimal(average)}`,
                color: CHART_CHROME.guide,
                dashed: true,
              },
            ]),
      ]}
    />
  );
}

/**
 * The dashboard tile. Its empty state is the one that most needs a REASON:
 * "no data" on a velocity chart sends people hunting for a bug, when the truth
 * is simply that no sprint has been completed yet and the numbers are stamped
 * at completion. The message says so.
 */
export function VelocityCard({ projectId }: { projectId: string | null }) {
  const { t } = useTranslation(['reports']);
  const query = useVelocity(projectId);
  const sprints = query.data?.sprints ?? [];

  return (
    <ReportCard
      title={t('reports:velocity.title')}
      info={t('reports:velocity.info')}
      caption={<VelocityLegend sprints={sprints} />}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={velocityHeadline(sprints) === null}
      emptyTitle={t('reports:velocity.empty.title')}
      emptyMessage={t('reports:velocity.empty.body')}
    >
      <VelocityChart sprints={sprints} />
    </ReportCard>
  );
}

export default VelocityChart;
