import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/useAuthStore';
import {
  latencyQueryOptions,
  requestsOverTimeQueryOptions,
  telemetryEventsQueryOptions,
  telemetryOverviewQueryOptions,
  topEndpointsQueryOptions,
} from '@/hooks/useAdminTelemetry';
import { presetWindow } from '@/components/admin/telemetry-range';

/**
 * The five admin telemetry queries.
 *
 * `fetch` IS MOCKED, NOT `api.get` — same reasoning as `useReports.test.ts`.
 * Stubbing the transport seam would skip the one thing worth asserting here:
 * that every response goes through its SHARED zod schema on the way into a
 * chart. Mocking the global keeps the envelope unwrap, the `meta` extraction
 * and the parse all real; only the network is fake.
 *
 * THE OPTIONS FACTORIES ARE THE UNIT, not the hooks. Each hook is
 * `useQuery(factory(...))` and nothing else, and this package's default test
 * environment is DOM-free, so driving the factory through a real `QueryClient`
 * covers the key, the URL, the query string and the parse without booting
 * React.
 */

const WINDOW = presetWindow('24h', new Date('2026-08-27T12:00:00.000Z'));
const USER = '44444444-4444-4444-8444-444444444444';
const PROJECT = '11111111-1111-4111-8111-111111111111';

let fetchMock: ReturnType<typeof vi.fn>;

function ok(data: unknown, meta?: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, meta }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Retries off, so a rejected parse fails the test immediately. */
function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function calledUrl(): string {
  return String(fetchMock.mock.calls[0]?.[0]);
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ───────────────────────────────────────────────────────────────────────────
// Fixtures — the smallest payload each contract accepts.
// ───────────────────────────────────────────────────────────────────────────

const OVERVIEW = {
  dau: 12,
  eventsToday: 340,
  tasksCreated7d: 58,
  tasksCompleted7d: 41,
  activeProjects: 6,
};

const EVENTS = [
  {
    id: '1042',
    type: 'page_view',
    userId: USER,
    orgId: null,
    projectId: PROJECT,
    payload: { path: '/o/:orgSlug/p/:projectKey/board' },
    createdAt: '2026-08-27T11:59:00.000Z',
    userName: 'Ada Lovelace',
  },
];

const REQUESTS = {
  buckets: [
    { ts: '2026-08-27T11:00:00.000Z', count: 2, avgDurationMs: 200 },
    { ts: '2026-08-27T12:00:00.000Z', count: 0, avgDurationMs: 0 },
  ],
};

const ENDPOINTS = {
  endpoints: [
    {
      method: 'GET',
      path: '/api/tasks/:taskId',
      count: 4,
      avgDurationMs: 250,
      errorRate: 0.25,
    },
  ],
};

const LATENCY = {
  buckets: [
    { ts: '2026-08-27T11:00:00.000Z', p50: 25, p90: 37, p95: 38.5, p99: 39.7, max: 40, count: 4 },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════

describe('overview', () => {
  it('parses the KPI contract and sends no range at all', async () => {
    fetchMock.mockResolvedValue(ok(OVERVIEW));
    const data = await client().fetchQuery(telemetryOverviewQueryOptions());

    expect(data).toEqual(OVERVIEW);
    expect(calledUrl()).toContain('/api/admin/telemetry/overview');
    // The windows are fixed server-side so two people quoting DAU mean the same
    // thing; a range parameter here would make that untrue.
    expect(calledUrl()).not.toContain('?');
  });

  it('surfaces a fractional user count as an error rather than rendering it', async () => {
    fetchMock.mockResolvedValue(ok({ ...OVERVIEW, dau: 1.5 }));
    await expect(client().fetchQuery(telemetryOverviewQueryOptions())).rejects.toThrow();
  });
});

describe('events', () => {
  it('parses the rows and keeps pagination in the ENVELOPE', async () => {
    fetchMock.mockResolvedValue(ok(EVENTS, { page: 1, pageSize: 25, total: 1, totalPages: 1 }));
    const page = await client().fetchQuery(
      telemetryEventsQueryOptions({}, { page: 1, pageSize: 25 }),
    );

    expect(page.rows).toEqual(EVENTS);
    // `data` is a plain array on every list endpoint in FlowBoard; the counts
    // ride beside it.
    expect(page.meta).toEqual({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
  });

  it('serialises every filter into the query string', async () => {
    fetchMock.mockResolvedValue(ok(EVENTS));
    await client().fetchQuery(
      telemetryEventsQueryOptions(
        { type: ['page_view', 'task_created'], userId: USER, from: WINDOW.from, to: WINDOW.to },
        { page: 2, pageSize: 50, sort: 'createdAt:asc' },
      ),
    );

    const url = calledUrl();
    // Comma-joined, not repeated — the project's multi-value convention.
    expect(url).toContain('type=page_view%2Ctask_created');
    expect(url).toContain(`userId=${USER}`);
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
    expect(url).toContain('sort=createdAt%3Aasc');
  });

  it('rejects a bigserial id sent as a number', async () => {
    // `bigIntId` is a decimal STRING: a 64-bit id does not survive JSON's
    // float64, and accepting a number here would let it round at scale.
    fetchMock.mockResolvedValue(ok([{ ...EVENTS[0], id: 1042 }]));
    await expect(
      client().fetchQuery(telemetryEventsQueryOptions({}, { page: 1, pageSize: 25 })),
    ).rejects.toThrow();
  });

  it('keys separately per filter set and per page', () => {
    const base = telemetryEventsQueryOptions({}, { page: 1, pageSize: 25 }).queryKey;
    expect(base).not.toEqual(
      telemetryEventsQueryOptions({ type: ['page_view'] }, { page: 1, pageSize: 25 }).queryKey,
    );
    expect(base).not.toEqual(telemetryEventsQueryOptions({}, { page: 2, pageSize: 25 }).queryKey);
  });
});

describe('requests over time', () => {
  it('parses the zero-filled series and sends the window with its bucket', async () => {
    fetchMock.mockResolvedValue(ok(REQUESTS));
    const data = await client().fetchQuery(requestsOverTimeQueryOptions(WINDOW, 'hour'));

    // The empty bucket is part of the contract, not noise to be filtered: it is
    // what makes an outage a visible gap instead of a straight line.
    expect(data.buckets[1]).toEqual({
      ts: '2026-08-27T12:00:00.000Z',
      count: 0,
      avgDurationMs: 0,
    });
    expect(calledUrl()).toContain('/api/admin/telemetry/requests-over-time');
    expect(calledUrl()).toContain('bucket=hour');
  });

  it('gives the hourly and daily series different cache entries', () => {
    expect(requestsOverTimeQueryOptions(WINDOW, 'hour').queryKey).not.toEqual(
      requestsOverTimeQueryOptions(WINDOW, 'day').queryKey,
    );
  });
});

describe('top endpoints', () => {
  it('parses the table and passes the limit through', async () => {
    fetchMock.mockResolvedValue(ok(ENDPOINTS));
    const data = await client().fetchQuery(topEndpointsQueryOptions(WINDOW, 20));

    expect(data.endpoints[0]?.errorRate).toBe(0.25);
    expect(calledUrl()).toContain('limit=20');
  });

  it('rejects an error rate outside [0,1] — it is a SHARE, not a percentage', async () => {
    fetchMock.mockResolvedValue(ok({ endpoints: [{ ...ENDPOINTS.endpoints[0], errorRate: 25 }] }));
    await expect(client().fetchQuery(topEndpointsQueryOptions(WINDOW))).rejects.toThrow();
  });

  it('keys by the limit, so widening the table refetches', () => {
    expect(topEndpointsQueryOptions(WINDOW, 10).queryKey).not.toEqual(
      topEndpointsQueryOptions(WINDOW, 20).queryKey,
    );
  });
});

describe('latency', () => {
  it('parses all four percentiles plus the max and the count', async () => {
    fetchMock.mockResolvedValue(ok(LATENCY));
    const data = await client().fetchQuery(latencyQueryOptions(WINDOW, 'hour'));

    expect(data.buckets[0]).toEqual(LATENCY.buckets[0]);
    expect(calledUrl()).toContain('/api/admin/telemetry/latency');
  });

  it('surfaces a mismatch when a percentile is missing', async () => {
    // Dropping p99 would silently vanish the tail line rather than break it.
    fetchMock.mockResolvedValue(
      ok({
        buckets: [{ ts: '2026-08-27T11:00:00.000Z', p50: 1, p90: 1, p95: 1, max: 1, count: 1 }],
      }),
    );
    await expect(client().fetchQuery(latencyQueryOptions(WINDOW, 'hour'))).rejects.toThrow();
  });
});

describe('cache separation', () => {
  it('gives every telemetry query its own key under the admin prefix', () => {
    const keys = [
      telemetryOverviewQueryOptions().queryKey,
      telemetryEventsQueryOptions({}, { page: 1, pageSize: 25 }).queryKey,
      requestsOverTimeQueryOptions(WINDOW, 'hour').queryKey,
      topEndpointsQueryOptions(WINDOW).queryKey,
      latencyQueryOptions(WINDOW, 'hour').queryKey,
    ].map((key) => JSON.stringify(key));

    expect(new Set(keys).size).toBe(5);
    // A separate root from the rest of the app, so a non-admin never prefetches
    // any of it and signing out drops the lot in one invalidation.
    for (const key of keys) {
      expect(key.startsWith('["admin","telemetry"')).toBe(true);
    }
  });
});
