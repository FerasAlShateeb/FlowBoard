import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageHeader from '@/components/common/PageHeader';
import { useTelemetryOverview } from '@/hooks/useAdminTelemetry';
import TelemetryStatRow from '@/components/admin/TelemetryStatRow';
import TelemetryRangePicker from '@/components/admin/TelemetryRangePicker';
import { RequestsCard } from '@/components/admin/RequestsChart';
import { LatencyCard } from '@/components/admin/LatencyChart';
import { TopEndpointsCard } from '@/components/admin/TopEndpointsTable';
import {
  DEFAULT_TELEMETRY_PRESET,
  presetBucket,
  presetWindow,
  type TelemetryFilterPreset,
  type TelemetryPreset,
} from '@/components/admin/telemetry-range';

/**
 * The telemetry overview — the page an admin opens to answer "is anything
 * wrong, and is anyone using this".
 *
 * ── WHAT THIS PAGE OWNS ─────────────────────────────────────────────────────
 * One piece of state: the window. Every panel owns its own query, its own
 * skeleton, its own error state with a retry, and its own empty message — the
 * same per-tile degradation the reports dashboard is built around, for the same
 * reason: a percentile scan that times out should cost the reader one card, not
 * the screen. There is deliberately no page-level "is anything loading" gate.
 *
 * ── THE KPI ROW IGNORES THE WINDOW, ON PURPOSE ──────────────────────────────
 * `/overview` takes no range: two of its five numbers are defined against
 * "today" and three against "the last 7 days", fixed, so that two people
 * quoting DAU mean the same thing. If the range picker retuned it, the headline
 * number on the page would depend on what the reader last clicked — which is
 * the one property a KPI must not have. The picker drives the CHARTS below,
 * where a window is exactly the right question.
 *
 * ── THE BUCKET IS DERIVED ───────────────────────────────────────────────────
 * 24h and 7d read at hourly resolution, 30d at daily (see `telemetry-range`).
 * The explicit hour/day toggle lives on the requests page, where granularity is
 * the thing being inspected rather than a detail.
 *
 * ── RTL ─────────────────────────────────────────────────────────────────────
 * Everything flips with the language except the plot interiors, which are
 * `dir="ltr"` islands (`components/reports/ChartFrame`), and the machine text —
 * route patterns, timestamps — which is pinned LTR cell by cell.
 */
export default function AdminTelemetryPage() {
  const { t } = useTranslation(['admin']);
  const [preset, setPreset] = useState<TelemetryPreset>(DEFAULT_TELEMETRY_PRESET);

  const overview = useTelemetryOverview();

  // `presetWindow()` reads the clock, so it goes through `useMemo` keyed on the
  // preset: as a plain expression it would mint a new `{from,to}` on every
  // render, and that object is part of three query keys.
  const window = useMemo(() => presetWindow(preset), [preset]);
  const bucket = presetBucket(preset);

  return (
    <>
      <PageHeader title={t('admin:telemetry.title')} description={t('admin:telemetry.description')}>
        <TelemetryRangePicker
          value={preset}
          onChange={(next: TelemetryFilterPreset) => {
            // The chart picker never offers "all" — narrowing here keeps the
            // page's state honest without a cast.
            if (next !== 'all') setPreset(next);
          }}
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
          <RequestsCard window={window} bucket={bucket} />
          <LatencyCard window={window} bucket={bucket} />
        </div>

        <TopEndpointsCard window={window} />
      </div>
    </>
  );
}
