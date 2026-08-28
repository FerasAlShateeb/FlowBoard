import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { qk } from '@/lib/query-keys';
import type { DependencyEdge } from '@/components/gantt/gantt-arrows';

/**
 * The Roadmap's edge fetch: ONE project-wide request, not one per visible row.
 *
 * WHY A `QueryObserver` RATHER THAN `renderHook`. The web package's default test
 * environment is DOM-free (`vitest.config.ts`), and the part worth asserting
 * here is not the React binding — it is the request that leaves, the `enabled`
 * gate, and the `select` that turns the wire's `blockerTaskId` vocabulary into
 * the arrow layer's `blockerId` one. An observer over the exported options runs
 * exactly that chain.
 */

const get = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, get: (...args: unknown[]) => get(...args) } };
});

const { ganttDependenciesQueryOptions, toEdges } =
  await import('@/components/gantt/useGanttDependencies');

const PROJECT_ID = 'p-1';
const A = 'task-a';
const B = 'task-b';
const C = 'task-c';

let queryClient: QueryClient;

beforeEach(() => {
  get.mockReset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

/** Runs the query to settlement and returns what a consumer would render. */
async function run(enabled = true): Promise<DependencyEdge[] | undefined> {
  const options = ganttDependenciesQueryOptions(PROJECT_ID, enabled);
  const observer = new QueryObserver(queryClient, options);
  const result = await observer.fetchOptimistic(options);
  return result.data;
}

describe('useGanttDependencies — the project-wide edge query', () => {
  it('asks the project ONCE, with no per-row ids in the URL', async () => {
    get.mockResolvedValue({ edges: [] });

    await run();

    expect(get).toHaveBeenCalledTimes(1);
    const [path] = get.mock.calls[0] as [string];
    expect(path).toBe(`/projects/${PROJECT_ID}/dependencies`);
  });

  it('caches under the project prefix, not under any task', () => {
    expect(ganttDependenciesQueryOptions(PROJECT_ID, true).queryKey).toEqual(
      qk.project.dependencies(PROJECT_ID),
    );
  });

  it('translates the contract vocabulary into the arrow layer’s', async () => {
    get.mockResolvedValue({
      edges: [
        { blockerTaskId: A, blockedTaskId: B },
        { blockerTaskId: B, blockedTaskId: C },
      ],
    });

    expect(await run()).toEqual([
      { blockerId: A, blockedId: B },
      { blockerId: B, blockedId: C },
    ]);
  });

  it('returns edges whose OTHER end is off screen — the old per-row fetch could not', async () => {
    // The regression this replaces: reading edges out of visible rows' detail
    // payloads meant an edge only existed once one of its ends was fetched.
    get.mockResolvedValue({ edges: [{ blockerTaskId: 'row-1', blockedTaskId: 'row-900' }] });

    expect(await run()).toEqual([{ blockerId: 'row-1', blockedId: 'row-900' }]);
  });

  it('fetches nothing while the toolbar toggle is off', () => {
    expect(ganttDependenciesQueryOptions(PROJECT_ID, false).enabled).toBe(false);
    expect(ganttDependenciesQueryOptions(PROJECT_ID, true).enabled).toBe(true);
    // …and nothing at all before the project resolves.
    expect(ganttDependenciesQueryOptions(undefined, true).enabled).toBe(false);
  });

  it('drops duplicates and self-edges rather than drawing a loop over one bar', () => {
    expect(
      toEdges({
        edges: [
          { blockerTaskId: A, blockedTaskId: B },
          { blockerTaskId: A, blockedTaskId: B },
          { blockerTaskId: C, blockedTaskId: C },
        ],
      }),
    ).toEqual([{ blockerId: A, blockedId: B }]);
  });
});
