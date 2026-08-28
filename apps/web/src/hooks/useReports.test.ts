import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/useAuthStore';
import {
  burndownQueryOptions,
  burnupQueryOptions,
  cumulativeFlowQueryOptions,
  cycleTimeQueryOptions,
  velocityQueryOptions,
  workloadQueryOptions,
} from '@/hooks/useReports';

/**
 * The six report queries.
 *
 * `fetch` IS MOCKED, NOT `api.get`. Stubbing the transport seam would skip the
 * one thing worth asserting here — that each response goes through its shared
 * zod schema — and would let a report whose payload drifted from the contract
 * sail into a chart. Mocking the global keeps `lib/api`'s envelope unwrap, its
 * error mapping and the schema parse all real; only the network is fake.
 *
 * THE OPTIONS FACTORIES ARE THE UNIT, not the hooks. `useBurndown` is
 * `useQuery(burndownQueryOptions(...))` and nothing else, and the package's
 * test environment is deliberately DOM-free (`vitest.config.ts`), so exercising
 * the factory through a real `QueryClient` covers the key, the URL, the parse
 * and the enabled-gate without booting React.
 */

const PROJECT = '11111111-1111-4111-8111-111111111111';
const SPRINT = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const RANGE = { from: '2026-08-01', to: '2026-08-14' };

let fetchMock: ReturnType<typeof vi.fn>;

/** A `{ success, data }` envelope, the shape `lib/api` unwraps. */
function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A client with retries off, so a rejected parse fails the test immediately. */
function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** The URL the single mocked call was made with. */
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

const BURNDOWN = {
  days: [
    { date: '2026-08-01', remainingPoints: 20, idealPoints: 20 },
    { date: '2026-08-02', remainingPoints: 13, idealPoints: 16 },
  ],
};

const BURNUP = {
  days: [
    { date: '2026-08-01', completedPoints: 0, scopePoints: 20 },
    { date: '2026-08-02', completedPoints: 7, scopePoints: 22 },
  ],
};

const FLOW = {
  days: [{ date: '2026-08-01', counts: { todo: 4, in_progress: 2, done: 1 } }],
};

const VELOCITY = {
  sprints: [{ sprintId: SPRINT, name: 'Sprint 1', committedPoints: 20, completedPoints: 17 }],
};

const CYCLE_TIME = {
  tasks: [
    {
      taskId: TASK,
      key: 'FB-142',
      startedAt: '2026-08-01T09:00:00.000Z',
      resolvedAt: '2026-08-02T09:00:00.000Z',
      hours: 24,
    },
  ],
  p50: 24,
  p90: 40,
};

const WORKLOAD = {
  assignees: [
    { user: { id: USER, name: 'Ada Lovelace', avatarUrl: null }, openTasks: 3, openPoints: 8 },
    { user: null, openTasks: 1, openPoints: 2 },
  ],
};

describe('burndown', () => {
  it('parses the contract and calls the sprint-scoped endpoint', async () => {
    fetchMock.mockResolvedValue(ok(BURNDOWN));
    const data = await client().fetchQuery(burndownQueryOptions(PROJECT, SPRINT));

    expect(data).toEqual(BURNDOWN);
    expect(calledUrl()).toContain(`/api/projects/${PROJECT}/reports/burndown`);
    expect(calledUrl()).toContain(`sprintId=${SPRINT}`);
  });

  it('surfaces a schema mismatch as an error rather than a half-drawn chart', async () => {
    // `idealPoints` dropped: the ideal line would silently vanish.
    fetchMock.mockResolvedValue(ok({ days: [{ date: '2026-08-01', remainingPoints: 20 }] }));
    await expect(client().fetchQuery(burndownQueryOptions(PROJECT, SPRINT))).rejects.toThrow();
  });

  it('keys by sprint, so two sprints never share a cache entry', () => {
    expect(burndownQueryOptions(PROJECT, SPRINT).queryKey).not.toEqual(
      burndownQueryOptions(PROJECT, TASK).queryKey,
    );
  });

  it('is disabled until BOTH the project and the sprint are known', () => {
    expect(burndownQueryOptions(null, SPRINT).enabled).toBe(false);
    expect(burndownQueryOptions(PROJECT, null).enabled).toBe(false);
    expect(burndownQueryOptions(PROJECT, SPRINT).enabled).toBe(true);
  });
});

describe('burnup', () => {
  it('parses the contract', async () => {
    fetchMock.mockResolvedValue(ok(BURNUP));
    const data = await client().fetchQuery(burnupQueryOptions(PROJECT, SPRINT));
    expect(data).toEqual(BURNUP);
    expect(calledUrl()).toContain('/reports/burnup');
  });

  it('rejects a negative point total', async () => {
    fetchMock.mockResolvedValue(
      ok({ days: [{ date: '2026-08-01', completedPoints: -1, scopePoints: 20 }] }),
    );
    await expect(client().fetchQuery(burnupQueryOptions(PROJECT, SPRINT))).rejects.toThrow();
  });
});

describe('cumulative flow', () => {
  it('parses the exhaustive category record and sends the window', async () => {
    fetchMock.mockResolvedValue(ok(FLOW));
    const data = await client().fetchQuery(cumulativeFlowQueryOptions(PROJECT, RANGE));

    expect(data).toEqual(FLOW);
    expect(calledUrl()).toContain('/reports/cumulative-flow');
    expect(calledUrl()).toContain('from=2026-08-01');
    expect(calledUrl()).toContain('to=2026-08-14');
  });

  it('rejects a day whose counts are not all integers', async () => {
    fetchMock.mockResolvedValue(
      ok({ days: [{ date: '2026-08-01', counts: { todo: 1.5, in_progress: 0, done: 0 } }] }),
    );
    await expect(client().fetchQuery(cumulativeFlowQueryOptions(PROJECT, RANGE))).rejects.toThrow();
  });

  it('keys by the window, so widening the range refetches', () => {
    expect(cumulativeFlowQueryOptions(PROJECT, RANGE).queryKey).not.toEqual(
      cumulativeFlowQueryOptions(PROJECT, { from: '2026-07-01', to: '2026-08-14' }).queryKey,
    );
  });
});

describe('velocity', () => {
  it('parses the contract and takes no range parameter', async () => {
    fetchMock.mockResolvedValue(ok(VELOCITY));
    const data = await client().fetchQuery(velocityQueryOptions(PROJECT));

    expect(data).toEqual(VELOCITY);
    expect(calledUrl()).toContain('/reports/velocity');
    expect(calledUrl()).not.toContain('?');
  });

  it('surfaces a mismatch when a stamp is missing', async () => {
    fetchMock.mockResolvedValue(ok({ sprints: [{ sprintId: SPRINT, name: 'Sprint 1' }] }));
    await expect(client().fetchQuery(velocityQueryOptions(PROJECT))).rejects.toThrow();
  });
});

describe('cycle time', () => {
  it('parses tasks together with the server percentiles', async () => {
    fetchMock.mockResolvedValue(ok(CYCLE_TIME));
    const data = await client().fetchQuery(cycleTimeQueryOptions(PROJECT, RANGE));

    expect(data).toEqual(CYCLE_TIME);
    expect(calledUrl()).toContain('/reports/cycle-time');
  });

  it('accepts null percentiles — nothing resolved is a valid answer', async () => {
    fetchMock.mockResolvedValue(ok({ tasks: [], p50: null, p90: null }));
    await expect(client().fetchQuery(cycleTimeQueryOptions(PROJECT, RANGE))).resolves.toEqual({
      tasks: [],
      p50: null,
      p90: null,
    });
  });

  it('rejects a malformed task key', async () => {
    fetchMock.mockResolvedValue(
      ok({ ...CYCLE_TIME, tasks: [{ ...CYCLE_TIME.tasks[0], key: 'not a key' }] }),
    );
    await expect(client().fetchQuery(cycleTimeQueryOptions(PROJECT, RANGE))).rejects.toThrow();
  });
});

describe('workload', () => {
  it('parses both a named assignee and the unassigned bucket', async () => {
    fetchMock.mockResolvedValue(ok(WORKLOAD));
    const data = await client().fetchQuery(workloadQueryOptions(PROJECT));

    expect(data).toEqual(WORKLOAD);
    expect(data.assignees[1]?.user).toBeNull();
  });

  it('surfaces a mismatch on a fractional task count', async () => {
    fetchMock.mockResolvedValue(ok({ assignees: [{ user: null, openTasks: 1.5, openPoints: 2 }] }));
    await expect(client().fetchQuery(workloadQueryOptions(PROJECT))).rejects.toThrow();
  });

  it('is disabled until the project id resolves', () => {
    expect(workloadQueryOptions(null).enabled).toBe(false);
    expect(velocityQueryOptions(undefined).enabled).toBe(false);
    expect(cycleTimeQueryOptions(null, RANGE).enabled).toBe(false);
    expect(cumulativeFlowQueryOptions(null, RANGE).enabled).toBe(false);
  });
});

describe('cache separation', () => {
  it('gives every report its own key under the project prefix', () => {
    const keys = [
      burndownQueryOptions(PROJECT, SPRINT).queryKey,
      burnupQueryOptions(PROJECT, SPRINT).queryKey,
      cumulativeFlowQueryOptions(PROJECT, RANGE).queryKey,
      velocityQueryOptions(PROJECT).queryKey,
      cycleTimeQueryOptions(PROJECT, RANGE).queryKey,
      workloadQueryOptions(PROJECT).queryKey,
    ].map((key) => JSON.stringify(key));

    expect(new Set(keys).size).toBe(6);
    // Every one of them sits under `['project', id, 'reports', …]`, which is
    // the prefix a sprint mutation invalidates.
    for (const key of keys) {
      expect(key.startsWith(`["project","${PROJECT}","reports"`)).toBe(true);
    }
  });
});
