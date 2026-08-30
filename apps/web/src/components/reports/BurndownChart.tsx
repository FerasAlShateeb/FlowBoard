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
import type { BurndownDay } from '@flowboard/shared';

import { useBurndown } from '@/hooks/useReports';

import ChartFrame from './ChartFrame';
import ReportCard from './ReportCard';
import ChartLegend from './ChartLegend';
import { ChartTooltipContent } from './ChartTooltip';
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
import { burndownHeadline } from './report-summaries';

/**
 * Burndown — points still open per sprint day, against the straight line from
 * the commitment to zero.
 *
 * BOTH SERIES COME FROM ONE PAYLOAD. `idealPoints` is computed server-side (see
 * `burndownDaySchema`) rather than derived here from the first day's total, so
 * the two lines can never disagree about how long the sprint is — a client-side
 * ideal drifts the moment the sprint's dates are edited mid-flight.
 *
 * THE IDEAL LINE IS DRAWN FIRST and in the muted TEXT colour, dashed: it is
 * furniture, and the remaining line has to cross it without either one
 * disappearing. Drawing it second would put the guide on top of the data.
 */
export function BurndownChart({ days }: { days: readonly BurndownDay[] }) {
  const { t } = useTranslation(['reports']);
  const format = useChartFormat();
  // Registry entry #6: a COLD load draws itself in, a warm refetch does not,
  // and Reduced motion never does. One call, spread onto every series below.
  const animation = chartAnimation(useColdChart());
  const headline = burndownHeadline(days);

  const summary = t('reports:burndown.summary', {
    days: format.count(headline?.days ?? 0),
    remaining: format.decimal(headline?.remaining ?? 0),
    ideal: format.decimal(headline?.ideal ?? 0),
  });

  const labels = {
    remainingPoints: t('reports:burndown.remaining'),
    idealPoints: t('reports:burndown.ideal'),
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
          <Line
            type="linear"
            dataKey="idealPoints"
            stroke={CHART_CHROME.guide}
            strokeWidth={STROKE.guide}
            strokeDasharray={DASH.guide}
            dot={false}
            activeDot={false}
            {...animation}
          />
          <Line
            type="monotone"
            dataKey="remainingPoints"
            stroke={CHART_SERIES.primary}
            strokeWidth={STROKE.data}
            dot={false}
            activeDot={{ r: 3, fill: CHART_SERIES.primary }}
            {...animation}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** The legend for this chart, rendered by the card above the plot. */
function BurndownLegend() {
  const { t } = useTranslation(['reports']);
  return (
    <ChartLegend
      entries={[
        { label: t('reports:burndown.remaining'), color: CHART_SERIES.primary },
        { label: t('reports:burndown.ideal'), color: CHART_CHROME.guide, dashed: true },
      ]}
    />
  );
}

/**
 * The dashboard tile: this chart's query, its three states, and its two empty
 * cases — "you have not picked a sprint" and "the sprint you picked has no
 * days yet". Distinguishing them is the difference between a hint and a shrug.
 *
 * The query is DISABLED while no sprint is selected, which leaves it
 * permanently `isPending`; the `hasSprint &&` guard is what turns that into the
 * empty state instead of an eternal skeleton.
 */
export function BurndownCard({
  projectId,
  sprintId,
}: {
  projectId: string | null;
  sprintId: string | null;
}) {
  const { t } = useTranslation(['reports']);
  const query = useBurndown(projectId, sprintId);
  const days = query.data?.days ?? [];
  const hasSprint = Boolean(sprintId);

  return (
    <ReportCard
      title={t('reports:burndown.title')}
      info={t('reports:burndown.info')}
      caption={<BurndownLegend />}
      isPending={hasSprint && query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={!hasSprint || burndownHeadline(days) === null}
      emptyTitle={
        hasSprint ? t('reports:burndown.empty.noDays') : t('reports:burndown.empty.noSprint')
      }
      emptyMessage={
        hasSprint
          ? t('reports:burndown.empty.noDaysBody')
          : t('reports:burndown.empty.noSprintBody')
      }
    >
      <BurndownChart days={days} />
    </ReportCard>
  );
}

export default BurndownChart;
