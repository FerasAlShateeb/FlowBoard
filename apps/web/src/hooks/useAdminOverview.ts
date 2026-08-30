import {
  keepPreviousData,
  queryOptions,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import { analyticsOverviewSchema, type AnalyticsOverview } from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

/**
 * `GET /api/admin/analytics/overview` — the admin landing page's one request.
 *
 * ═══ WHY IT IS NOT IN THE ANALYTICS STORE ═════════════════════════════════
 *
 * The four DRILLABLE domains (engagement, work, traffic, growth) share one
 * range picker and one preset-keyed cache, because switching domains must not
 * reset the window an operator just chose. Overview has no window at all: its
 * KPIs are fixed trailing counts and its two series are fixed at 14 daily and
 * 24 hourly buckets, on purpose (see `analyticsOverviewSchema`) — a health
 * summary whose sparkline silently rescales is a card nobody can read at a
 * glance. So it is an ordinary query with an ordinary key, and the range store
 * has nothing to hold for it.
 *
 * ═══ AUTO-REFRESH IS THE CALLER'S, AND IT IS OPT-IN ═══════════════════════
 *
 * `refetchIntervalMs` is passed by the page from a switch that starts OFF.
 * Polling a five-query dashboard by default is a background load on every
 * deployment for a page that is usually open because somebody is reading it
 * once. `refetchIntervalInBackground` is left false, so a forgotten tab stops
 * costing anything the moment it loses focus.
 *
 * COLD-VS-WARM. `placeholderData` keeps the previous payload on screen while a
 * refresh is in flight, so the skeleton ladder is only ever seen on a genuinely
 * cold load — a KPI grid that blinks back to grey every thirty seconds is
 * unreadable, and the numbers it replaces were not wrong.
 */

/** How often the opt-in auto-refresh re-asks. Matches the analytics console. */
export const OVERVIEW_REFRESH_MS = 30_000;

export function adminOverviewQueryOptions(refetchIntervalMs?: number) {
  return queryOptions({
    queryKey: qk.analytics.domain('overview', ''),
    queryFn: ({ signal }) =>
      api.get('/admin/analytics/overview', { schema: analyticsOverviewSchema, signal }),
    // Long enough that walking away from the page and back does not re-ask,
    // short enough that a manual navigation after a change shows it.
    staleTime: 30_000,
    refetchInterval: refetchIntervalMs ?? false,
    placeholderData: keepPreviousData,
  });
}

export function useAdminOverview(refetchIntervalMs?: number): UseQueryResult<AnalyticsOverview> {
  return useQuery(adminOverviewQueryOptions(refetchIntervalMs));
}
