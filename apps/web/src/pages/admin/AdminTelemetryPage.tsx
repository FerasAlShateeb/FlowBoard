import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageHeader from '@/components/common/PageHeader';
import { RangePicker } from '@/components/dashboard/RangePicker';
import {
  DEFAULT_RANGE,
  windowFor,
  type RangeValue,
  type WindowInterval,
} from '@/components/dashboard/range';
import { useTelemetryOverview } from '@/hooks/useAdminTelemetry';
import TelemetryStatRow from '@/components/admin/TelemetryStatRow';
import { RequestsCard } from '@/components/admin/RequestsChart';
import { LatencyCard } from '@/components/admin/LatencyChart';
import { TopEndpointsCard } from '@/components/admin/TopEndpointsTable';
import type { TelemetryBucket } from '@/components/admin/telemetry-range';
import AutoRefreshSwitch from '@/components/admin/analytics/AutoRefreshSwitch';

/**
 * The ops overview — the page an admin opens to answer "is anything wrong, and
 * is anyone using this".
 *
 * ── ROUND 2: IT IS NOW A DOOR, NOT A ROOM ───────────────────────────────────
 * Three things changed, and each closes a dead end:
 *
 *  1. **Every KPI drills.** `TelemetryStatRow` renders `MetricTile`s that link
 *     into the analytics console, so "58 tasks created" leads somewhere.
 *  2. **One range vocabulary.** The bespoke `TelemetryRangePicker` chips
 *     (24h/7d/30d) are replaced by the console-wide `RangePicker` — the same
 *     four presets plus a custom calendar that every analytics dashboard uses,
 *     so an operator does not learn two window controls in one product.
 *  3. **Opt-in 30-second refresh**, for the same reason the Traffic dashboard
 *     has one: this is a page people leave open while something is happening.
 *
 * ── THE KPI ROW STILL IGNORES THE WINDOW, ON PURPOSE ────────────────────────
 * `/admin/telemetry/overview` takes no range: two of its five numbers are
 * defined against "today" and three against "the last 7 days", fixed, so that
 * two people quoting DAU mean the same thing. If the range picker retuned it,
 * the headline number would depend on what the reader last clicked — the one
 * property a KPI must not have. The picker drives the CHARTS below, where a
 * window is exactly the right question.
 *
 * ── THE RESOLVED WINDOW IS STATE ────────────────────────────────────────────
 * `windowFor()` reads the CLOCK, so calling it inline would mint a fresh
 * `{from,to}` on every render — and that object is part of three query keys, so
 * the three panels would refetch forever. Exactly two events may move it: the
 * picker and the auto-refresh tick. See the note on `chartWindow` below; this
 * is the same preset-is-not-a-window rule the analytics store is built on.
 *
 * ── PER-PANEL DEGRADATION ───────────────────────────────────────────────────
 * Every panel owns its own query, skeleton, error state with a retry and empty
 * message. A percentile scan that times out costs the reader one card, not the
 * screen. There is deliberately no page-level "is anything loading" gate.
 */

/**
 * The console's bucket vocabulary → the telemetry endpoints' narrower one.
 *
 * `/admin/telemetry/*` predates the analytics console and speaks
 * `minute|hour|day`; the console's `windowFor` also yields `week` and `month`
 * for the long presets. Both of those collapse to DAILY here rather than being
 * rejected: a 12-month request chart bucketed weekly is a chart this endpoint
 * cannot build, and a daily one over the same window is the honest nearest
 * answer. (The analytics `traffic` domain does support week/month natively —
 * which is one more reason the drill-downs live there.)
 */
function telemetryBucketFor(interval: WindowInterval): TelemetryBucket {
  return interval === 'hour' ? 'hour' : 'day';
}

/**
 * Traffic keeps HOURLY buckets across a whole week — the same cut-off the
 * analytics store gives its `traffic` domain, so this page and the Traffic
 * dashboard bucket a given window identically.
 */
const TRAFFIC_HOURLY_DAYS = 7;

/** The top-endpoints table is short here; the drill-down carries the full list. */
const ENDPOINT_LIMIT = 10;

export default function AdminTelemetryPage() {
  const { t } = useTranslation(['admin', 'analytics']);
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const [autoRefresh, setAutoRefresh] = useState(false);

  /**
   * The resolved window is STATE, not a memo.
   *
   * `windowFor()` reads the clock, so a render-time call would mint a fresh
   * `{from,to}` every render — and that object is part of three query keys, so
   * the panels would refetch forever. A memo would fix the churn but hide the
   * real rule, which is that exactly TWO events may move this window: the
   * picker, and an auto-refresh tick. Holding it as state says that out loud
   * and needs no dependency array to be read as intentional.
   */
  const [chartWindow, setChartWindow] = useState(() => windowFor(range, TRAFFIC_HOURLY_DAYS));
  const bucket = telemetryBucketFor(chartWindow.interval);

  const overview = useTelemetryOverview();

  return (
    <>
      <PageHeader
        title={t('admin:telemetry.title')}
        description={t('admin:telemetry.description')}
        actions={
          <AutoRefreshSwitch
            enabled={autoRefresh}
            onEnabledChange={setAutoRefresh}
            // The KPI row refetches directly; the three panels below follow
            // because re-resolving the window mints a new `to`, and the window
            // is part of their query keys. One tick, one coherent page.
            onRefresh={() => {
              setChartWindow(windowFor(range, TRAFFIC_HOURLY_DAYS));
              void overview.refetch();
            }}
            testId="admin-telemetry-auto-refresh"
          />
        }
      >
        <RangePicker
          value={range}
          onChange={(next) => {
            setRange(next);
            setChartWindow(windowFor(next, TRAFFIC_HOURLY_DAYS));
          }}
          testId="admin-telemetry-range"
        />
      </PageHeader>

      <div className="flex flex-col gap-[var(--gap)]">
        <TelemetryStatRow
          overview={overview.data}
          isPending={overview.isPending}
          error={overview.error}
          onRetry={() => void overview.refetch()}
        />

        <div className="grid grid-cols-1 gap-[var(--gap)] xl:grid-cols-2">
          <RequestsCard window={chartWindow} bucket={bucket} />
          <LatencyCard window={chartWindow} bucket={bucket} />
        </div>

        <TopEndpointsCard window={chartWindow} limit={ENDPOINT_LIMIT} />
      </div>
    </>
  );
}
