import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageHeader from '@/components/common/PageHeader';
import TelemetryRangePicker from '@/components/admin/TelemetryRangePicker';
import TelemetryBucketToggle from '@/components/admin/TelemetryBucketToggle';
import { RequestsCard } from '@/components/admin/RequestsChart';
import { LatencyCard } from '@/components/admin/LatencyChart';
import { TopEndpointsCard } from '@/components/admin/TopEndpointsTable';
import {
  DEFAULT_TELEMETRY_PRESET,
  presetBucket,
  presetWindow,
  type TelemetryBucket,
  type TelemetryFilterPreset,
  type TelemetryPreset,
} from '@/components/admin/telemetry-range';

/** The top-endpoints table is longer here than on the overview: this IS the page for it. */
const ENDPOINT_LIMIT = 20;

/**
 * Request analytics: volume, latency percentiles, and the busiest endpoints.
 *
 * ── THE ONE THING THIS PAGE HAS THAT THE OVERVIEW DOES NOT ──────────────────
 * An explicit hour/day toggle. On the overview the bucket is derived from the
 * window, because there it is a detail; here granularity is the instrument. An
 * hourly view finds the spike, a daily view answers whether the spike is a
 * trend, and being able to flip between them over the same window is most of
 * what this page is for.
 *
 * THE TOGGLE FOLLOWS THE WINDOW UNTIL IT IS TOUCHED. Changing the range resets
 * the bucket to that range's sensible default (`presetBucket`), so widening to
 * 30 days does not leave 720 hourly marks on a 600-pixel canvas. After the user
 * picks a bucket explicitly it stays picked — a control that silently undoes
 * itself is worse than no control. That is the whole reason `bucketOverride` is
 * a separate piece of state from `preset` rather than one derived value.
 *
 * ── THE TWO CHARTS SHARE AN X-AXIS DOMAIN, EXACTLY ──────────────────────────
 * Both endpoints build their series from the same `generate_series` spine over
 * the same window, including the empty buckets, so a spike in the volume chart
 * sits directly above the latency it caused. That alignment is a server-side
 * property (see `admin-telemetry.service.ts`), which is why neither chart tries
 * to reconcile axes on the client.
 */
export default function AdminTelemetryRequestsPage() {
  const { t } = useTranslation(['admin']);
  const [preset, setPreset] = useState<TelemetryPreset>(DEFAULT_TELEMETRY_PRESET);
  /** `null` until the user picks one — see the header. */
  const [bucketOverride, setBucketOverride] = useState<TelemetryBucket | null>(null);

  const window = useMemo(() => presetWindow(preset), [preset]);
  const bucket = bucketOverride ?? presetBucket(preset);

  return (
    <>
      <PageHeader
        title={t('admin:requestsPage.title')}
        description={t('admin:requestsPage.description')}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <TelemetryRangePicker
            value={preset}
            onChange={(next: TelemetryFilterPreset) => {
              if (next === 'all') return;
              setPreset(next);
              // A new window brings its own sensible granularity back.
              setBucketOverride(null);
            }}
          />
          <TelemetryBucketToggle value={bucket} onChange={setBucketOverride} />
        </div>
      </PageHeader>

      <div className="flex flex-col gap-[var(--gap)]">
        <div className="grid grid-cols-1 gap-[var(--gap)] xl:grid-cols-2">
          <RequestsCard window={window} bucket={bucket} />
          <LatencyCard window={window} bucket={bucket} />
        </div>

        <TopEndpointsCard window={window} limit={ENDPOINT_LIMIT} />
      </div>
    </>
  );
}
