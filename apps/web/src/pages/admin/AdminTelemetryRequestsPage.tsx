import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import PageHeader from '@/components/common/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import TelemetryRangePicker from '@/components/admin/TelemetryRangePicker';
import TelemetryBucketToggle from '@/components/admin/TelemetryBucketToggle';
import { RequestsCard } from '@/components/admin/RequestsChart';
import { LatencyCard } from '@/components/admin/LatencyChart';
import { TopEndpointsCard } from '@/components/admin/TopEndpointsTable';
import { DOMAIN_PATHS } from '@/components/admin/analytics/metric-registry';
import {
  DEFAULT_TELEMETRY_PRESET,
  presetBucket,
  presetWindow,
  type TelemetryBucket,
  type TelemetryFilterPreset,
  type TelemetryPreset,
} from '@/components/admin/telemetry-range';

/**
 * Request analytics — now a THIN page that keeps its one unique instrument and
 * hands everything else to the Traffic dashboard.
 *
 * ── WHY IT WAS FOLDED, AND WHY IT WAS NOT DELETED ───────────────────────────
 * Volume, response time and the busiest endpoints all live on
 * `/admin/analytics/traffic` now, where they share ONE window with error rate,
 * status classes and the rest of the console — which is the whole point of the
 * analytics port: five endpoints with five ranges that could disagree became
 * one round trip with one range.
 *
 * Two options were on the table. A REDIRECT to Traffic would have been tidier
 * to write and worse to use: this route is in people's history and their
 * bookmarks, a silent bounce gives no explanation, and — decisively — this page
 * owns something Traffic does not.
 *
 * ── THE ONE THING THIS PAGE HAS THAT TRAFFIC DOES NOT ───────────────────────
 * An explicit hour/day toggle. On the analytics dashboards the bucket is
 * DERIVED from the span (`intervalForSpan`), because there it is a detail; here
 * granularity is the instrument. An hourly view finds the spike, a daily view
 * answers whether the spike is a trend, and flipping between them over the same
 * window is most of what this page is for.
 *
 * So the page keeps working, keeps the toggle, and says out loud — in a real
 * banner with a real link, not a tooltip — where the rest of the story moved.
 *
 * ── AND WHY IT KEEPS `TelemetryRangePicker` ─────────────────────────────────
 * The rest of the console moved to `dashboard/RangePicker` in Round 2, and this
 * page did not, for one reason: the console's shortest preset is 7d, and this
 * page's whole subject is the 24-HOUR hourly view. A range control that cannot
 * express the window the page exists for is not a consolidation. (The full
 * argument, and the events feed's parallel one, is in that picker's header.)
 *
 * THE TOGGLE FOLLOWS THE WINDOW UNTIL IT IS TOUCHED. Changing the range resets
 * the bucket to that range's sensible default (`presetBucket`), so widening to
 * 30 days does not leave 720 hourly marks on a 600-pixel canvas. After the user
 * picks a bucket explicitly it stays picked — a control that silently undoes
 * itself is worse than no control. That is the whole reason `bucketOverride` is
 * separate state rather than one derived value.
 *
 * ── THE TWO CHARTS SHARE AN X-AXIS DOMAIN, EXACTLY ──────────────────────────
 * Both endpoints build their series from the same `generate_series` spine over
 * the same window, including the empty buckets, so a spike in the volume chart
 * sits directly above the latency it caused. That alignment is a server-side
 * property (`admin-telemetry.service.ts`), which is why neither chart tries to
 * reconcile axes on the client.
 */

/** The top-endpoints table is longer here than on the overview. */
const ENDPOINT_LIMIT = 20;

export default function AdminTelemetryRequestsPage() {
  const { t } = useTranslation(['admin', 'analytics']);
  const [preset, setPreset] = useState<TelemetryPreset>(DEFAULT_TELEMETRY_PRESET);
  /** `null` until the user picks one — see the header. */
  const [bucketOverride, setBucketOverride] = useState<TelemetryBucket | null>(null);

  // `presetWindow()` reads the clock, so it goes through `useMemo` keyed on the
  // preset: as a plain expression it would mint a new `{from,to}` on every
  // render, and that object is part of three query keys.
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
              // The chart picker never offers "all" — narrowing here keeps the
              // page's state honest without a cast.
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
        <Alert data-testid="telemetry-requests-fold-note">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('analytics:ops.requests.note')}</span>
            <Button asChild variant="outline" size="sm">
              <Link to={DOMAIN_PATHS.traffic} data-testid="telemetry-requests-traffic-link">
                {t('analytics:ops.requests.link')}
                <ArrowRight className="rtl:rotate-180" aria-hidden />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 gap-[var(--gap)] xl:grid-cols-2">
          <RequestsCard window={window} bucket={bucket} />
          <LatencyCard window={window} bucket={bucket} />
        </div>

        <TopEndpointsCard window={window} limit={ENDPOINT_LIMIT} />
      </div>
    </>
  );
}
