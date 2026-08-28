// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@flowboard/shared';

import { qk } from '@/lib/query-keys';

/**
 * `useTaskByKey`, and the mirror its own docstring promised for three waves
 * before anything wrote it.
 *
 * The deep-linked sheet (`/t/FB-142`) reads `qk.tasks.byKey(projectId, key)`.
 * Every mutation that touches ONE task writes `qk.task.detail(uuid)`, because a
 * uuid is the only id a mutation has. Two names for one row, and nothing
 * connecting them: an invalidation of the detail entry refetched a query the
 * page was not rendering, and a write to it was simply invisible.
 *
 * Mirroring here is what makes the promise true and gives every future
 * single-task write ONE address to target.
 */

const get = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, get: (...args: unknown[]) => get(...args) as unknown },
  };
});

const { useTaskByKey } = await import('@/hooks/useTasks');

const PROJECT_ID = 'pppppppp-pppp-4ppp-8ppp-pppppppppppp';
const TASK_ID = 'tttttttt-tttt-4ttt-8ttt-tttttttttttt';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    projectKey: 'FB',
    number: 142,
    key: 'FB-142',
    title: 'Ship it',
    description: null,
    type: 'task',
    statusId: 'todo',
    priority: 'medium',
    assignee: null,
    reporter: null,
    storyPoints: null,
    startDate: null,
    dueDate: null,
    sprintId: null,
    epicId: null,
    epic: null,
    parentId: null,
    boardRank: 'a1',
    backlogRank: 'a1',
    resolvedAt: null,
    labels: [],
    watcherIds: [],
    dependencies: { blockers: [], blocked: [] },
    subtaskIds: [],
    commentCount: 0,
    attachmentCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-03-04T10:00:00.000Z',
    ...overrides,
  };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('useTaskByKey', () => {
  it('mirrors its result into qk.task.detail(id), the address every mutation writes', async () => {
    get.mockResolvedValue(task());

    const { result } = renderHook(() => useTaskByKey(PROJECT_ID, 'FB-142'), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
    await waitFor(() => {
      expect(queryClient.getQueryData<Task>(qk.task.detail(TASK_ID))).toMatchObject({
        id: TASK_ID,
        title: 'Ship it',
      });
    });
  });

  it('normalises the key to upper case before asking for it', async () => {
    get.mockResolvedValue(task());

    renderHook(() => useTaskByKey(PROJECT_ID, 'fb-142'), { wrapper });

    await waitFor(() => {
      expect(get).toHaveBeenCalled();
    });
    const [path] = get.mock.calls[0] as [string];
    expect(path).toBe(`/projects/${PROJECT_ID}/tasks/by-key/FB-142`);
  });

  /**
   * The mirror must not walk the detail entry BACKWARDS. A by-key response can
   * resolve after a mutation has already written a newer version of the same
   * row under the uuid — that is the ordinary shape of "edit a field, then the
   * deep-link query that was in flight lands".
   */
  it('does not overwrite a NEWER detail entry with an older by-key response', async () => {
    const newer = task({ title: 'Edited a moment ago', updatedAt: '2026-03-04T11:00:00.000Z' });
    queryClient.setQueryData(qk.task.detail(TASK_ID), newer);

    get.mockResolvedValue(task({ title: 'Stale', updatedAt: '2026-03-04T10:00:00.000Z' }));

    const { result } = renderHook(() => useTaskByKey(PROJECT_ID, 'FB-142'), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });
    expect(queryClient.getQueryData<Task>(qk.task.detail(TASK_ID))?.title).toBe(
      'Edited a moment ago',
    );
  });

  it('fetches nothing without a project or a key', () => {
    renderHook(() => useTaskByKey(null, 'FB-142'), { wrapper });
    renderHook(() => useTaskByKey(PROJECT_ID, null), { wrapper });

    expect(get).not.toHaveBeenCalled();
  });
});
