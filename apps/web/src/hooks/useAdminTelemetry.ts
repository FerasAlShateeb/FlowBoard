import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  latencyReportSchema,
  requestsOverTimeSchema,
  telemetryEventsResponseSchema,
  telemetryOverviewSchema,
  topEndpointsSchema,
  type LatencyReport,
  type PaginationMeta,
  type RequestsOverTime,
  type TelemetryEventRow,
  type TelemetryEventType,
  type TelemetryOverview,
  type TopEndpoints,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk, type FilterValue, type PageParams } from '@/lib/query-keys';
import {
  windowKey,
  type TelemetryBucket,
  type TelemetryWindow,
} from '@/components/admin/telemetry-range';

/**
 * The five global-admin telemetry queries.
 *
 * Same shape as `useReports`, and for the same reasons — this file is that
 * pattern applied to a second dashboard, deliberately, so a reader who has seen
 * one has seen both:
 *
 *  - **OPTIONS FACTORIES ARE EXPORTED ALONGSIDE THE HOOKS.** The factory is
 *    plain data: it can be handed to a `QueryObserver` in a DOM-free test,
 *    prefetched, or composed. The hook is the two-line React binding. Every
 *    test in `useAdminTelemetry.test.ts` drives the factories.
 *  - **EVERY RESPONSE IS ZOD-PARSED** with the shared contract through `api`'s
 *    `schema` option. An endpoint that stopped emitting `errorRate` must fail in
 *    the table that reads it, not render a column of `undefined`.
 *  - **ONE QUERY PER PANEL, NEVER ONE PER PAGE.** The requests page draws three
 *    things — volume, latency, top endpoints — from three endpoints, so a slow
 *    percentile scan costs the reader one card rather than the screen.
 *
 * ── WHAT IS DIFFERENT FROM `useReports` ─────────────────────────────────────
 * There is no `enabled` gating. A report needs a `projectId` that arrives
 * asynchronously (slug → org → key → project); these endpoints are global and
 * every parameter they take is already in hand at render time. The queries are
 * therefore always live, and the route guard (`RequireGlobalAdmin`) — not a
 * disabled flag — is what stops a non-admin ever mounting them.
 *
 * The EVENT FEED is the one query that needs the envelope's `meta`, so it goes
 * through `api.paged` and resolves to `{ rows, meta }`. Pagination lives in the
 * envelope on every list endpoint in FlowBoard; `data` stays a plain array.
 */

const BASE = '/admin/telemetry';

// ───────────────────────────────────────────────────────────────────────────
// 1. Overview — the KPI row
// ───────────────────────────────────────────────────────────────────────────

/**
 * `GET /admin/telemetry/overview`.
 *
 * Takes NO window. Every figure on the card is defined against a fixed one —
 * "today" for two of them and "the last 7 days" for the other three — because
 * the whole point of a KPI row is that two people quoting it mean the same
 * thing. Letting the range picker retune it would make "DAU" a number that
 * depends on what the reader last clicked.
 */
export function telemetryOverviewQueryOptions() {
  return queryOptions({
    // The key's range segment is a constant: there is only ever one overview.
    queryKey: qk.admin.telemetryOverview('current'),
    queryFn: ({ signal }) =>
      api.get(`${BASE}/overview`, { schema: telemetryOverviewSchema, signal }),
  });
}

export function useTelemetryOverview(): UseQueryResult<TelemetryOverview> {
  return useQuery(telemetryOverviewQueryOptions());
}

// ───────────────────────────────────────────────────────────────────────────
// 2. The raw event feed
// ───────────────────────────────────────────────────────────────────────────

/** The filter bar's state, in the shape the endpoint's query string takes. */
export interface TelemetryEventFilters {
  /** Comma-joined by `lib/api`'s `toQuery` — the multi-value convention. */
  type?: readonly TelemetryEventType[];
  userId?: string;
  projectId?: string;
  from?: string;
  to?: string;
}

/** A page of the feed: the rows, plus the envelope's pagination block. */
export interface TelemetryEventsPage {
  rows: TelemetryEventRow[];
  meta: PaginationMeta | undefined;
}

/**
 * A filter bag as the query-key factory's canonical string.
 *
 * `filtersKey` (inside `qk.admin.telemetryEvents`) sorts keys and drops empties,
 * so a cleared filter and an absent one share one cache entry — which is what
 * makes clearing the type chips return to the page the user was already on
 * instead of refetching an identical list.
 */
function filterRecord(filters: TelemetryEventFilters): Record<string, FilterValue> {
  return {
    type: filters.type,
    userId: filters.userId,
    projectId: filters.projectId,
    from: filters.from,
    to: filters.to,
  };
}

/** `GET /admin/telemetry/events?type=&userId=&projectId=&from=&to=&page=&pageSize=`. */
export function telemetryEventsQueryOptions(filters: TelemetryEventFilters, page: PageParams) {
  return queryOptions({
    queryKey: qk.admin.telemetryEvents(filterRecord(filters), page),
    queryFn: async ({ signal }): Promise<TelemetryEventsPage> => {
      const result = await api.paged(`${BASE}/events`, {
        schema: telemetryEventsResponseSchema,
        query: {
          ...filterRecord(filters),
          page: page.page,
          pageSize: page.pageSize,
          sort: page.sort,
        },
        signal,
      });
      return { rows: result.data, meta: result.meta };
    },
    // A live feed whose page 1 is three seconds stale reads as broken. Cheap
    // to refetch: it is one indexed, paginated scan.
    staleTime: 10_000,
  });
}

export function useTelemetryEvents(
  filters: TelemetryEventFilters,
  page: PageParams,
): UseQueryResult<TelemetryEventsPage> {
  return useQuery(telemetryEventsQueryOptions(filters, page));
}

// ───────────────────────────────────────────────────────────────────────────
// 3-5. The request charts
// ───────────────────────────────────────────────────────────────────────────

/** `GET /admin/telemetry/requests-over-time?bucket=&from=&to=`. */
export function requestsOverTimeQueryOptions(window: TelemetryWindow, bucket: TelemetryBucket) {
  return queryOptions({
    queryKey: qk.admin.telemetryRequests(windowKey(window, bucket)),
    queryFn: ({ signal }) =>
      api.get(`${BASE}/requests-over-time`, {
        schema: requestsOverTimeSchema,
        query: { from: window.from, to: window.to, bucket },
        signal,
      }),
  });
}

export function useRequestsOverTime(
  window: TelemetryWindow,
  bucket: TelemetryBucket,
): UseQueryResult<RequestsOverTime> {
  return useQuery(requestsOverTimeQueryOptions(window, bucket));
}

/**
 * `GET /admin/telemetry/top-endpoints?from=&to=&limit=`.
 *
 * The limit is in the KEY as well as the query string: widening the table from
 * ten rows to twenty is a different result set, and reusing the cached ten
 * would silently ignore the control the user just used.
 */
export function topEndpointsQueryOptions(window: TelemetryWindow, limit = 10) {
  return queryOptions({
    queryKey: qk.admin.telemetryEndpoints(`${windowKey(window)}#${String(limit)}`),
    queryFn: ({ signal }) =>
      api.get(`${BASE}/top-endpoints`, {
        schema: topEndpointsSchema,
        query: { from: window.from, to: window.to, limit },
        signal,
      }),
  });
}

export function useTopEndpoints(
  window: TelemetryWindow,
  limit?: number,
): UseQueryResult<TopEndpoints> {
  return useQuery(topEndpointsQueryOptions(window, limit));
}

/** `GET /admin/telemetry/latency?bucket=&from=&to=` — percentiles over time. */
export function latencyQueryOptions(window: TelemetryWindow, bucket: TelemetryBucket) {
  return queryOptions({
    queryKey: qk.admin.telemetryLatency(windowKey(window, bucket)),
    queryFn: ({ signal }) =>
      api.get(`${BASE}/latency`, {
        schema: latencyReportSchema,
        query: { from: window.from, to: window.to, bucket },
        signal,
      }),
  });
}

export function useLatency(
  window: TelemetryWindow,
  bucket: TelemetryBucket,
): UseQueryResult<LatencyReport> {
  return useQuery(latencyQueryOptions(window, bucket));
}
