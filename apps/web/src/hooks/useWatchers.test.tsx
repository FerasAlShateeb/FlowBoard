// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskSummary, WatcherResponse } from '@flowboard/shared';

import { qk } from '@/lib/query-keys';
import { useAuthStore, type AuthUser } from '@/stores/useAuthStore';

/**
 * The watch toggle, against the TWO cache entries a task sheet can be rendered
 * from.
 *
 * `/t/FB-142` — the URL people paste into Slack — resolves through
 * `useTaskByKey`, which caches under `qk.tasks.byKey(projectId, 'FB-142')`.
 * `qk.task.detail(uuid)` is the entry every single-task mutation writes,
 * because a uuid is the only id a mutation has. The two are the same row under
 * two names, and until WP5.6 the watch mutations wrote only the second: on the
 * deep-linked route the button flipped nothing the user could see, because the
 * page was rendering the entry nobody wrote.
 *
 * So the assertions here are deliberately about BOTH entries at once. A fix
 * that repaired the visible symptom by hard-coding the by-key address would
 * pass a test that only looked at one of them, and would break again the moment
 * a third address appeared.
 */

const put = vi.fn();
const del = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      put: (...args: unknown[]) => put(...args) as unknown,
      del: (...args: unknown[]) => del(...args) as unknown,
    },
  };
});

vi.mock('@/i18n/errors', () => ({ useApiErrorToast: () => vi.fn() }));

const { useWatchTask, useUnwatchTask } = await import('@/hooks/useWatchers');

const PROJECT_ID = 'pppppppp-pppp-4ppp-8ppp-pppppppppppp';
const TASK_ID = 'tttttttt-tttt-4ttt-8ttt-tttttttttttt';
const TASK_KEY = 'FB-142';
const MY_ID = '11111111-1111-4111-8111-111111111111';
const SOMEONE_ELSE = '22222222-2222-4222-8222-222222222222';

const USER: AuthUser = {
  id: MY_ID,
  email: 'ada@flowboard.dev',
  name: 'Ada Lovelace',
  avatarUrl: null,
  isGlobalAdmin: false,
  locale: 'en',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function task(watcherIds: string[]): Task {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    projectKey: 'FB',
    number: 142,
    key: TASK_KEY,
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
    watcherIds,
    dependencies: { blockers: [], blocked: [] },
    subtaskIds: [],
    commentCount: 0,
    attachmentCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-03-04T10:00:00.000Z',
  };
}

const WATCHED: WatcherResponse = {
  taskId: TASK_ID,
  userId: MY_ID,
  watching: true,
  isMuted: false,
};

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** Seed BOTH addresses of the same task, the way an open deep link leaves them. */
function seed(watcherIds: string[]): void {
  queryClient.setQueryData(qk.task.detail(TASK_ID), task(watcherIds));
  queryClient.setQueryData(qk.tasks.byKey(PROJECT_ID, TASK_KEY), task(watcherIds));
}

const detailWatchers = () => queryClient.getQueryData<Task>(qk.task.detail(TASK_ID))?.watcherIds;
const byKeyWatchers = () =>
  queryClient.getQueryData<Task>(qk.tasks.byKey(PROJECT_ID, TASK_KEY))?.watcherIds;

beforeEach(() => {
  put.mockReset();
  del.mockReset();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  useAuthStore.setState({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    user: USER,
    sessionGeneration: 1,
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('useWatchTask', () => {
  it('adds me to BOTH the uuid entry and the by-key entry the sheet renders from', async () => {
    seed([SOMEONE_ELSE]);
    put.mockResolvedValue(WATCHED);

    const { result } = renderHook(() => useWatchTask(TASK_ID), { wrapper });
    result.current.mutate({});

    // Optimistic: both are patched before the request resolves.
    await waitFor(() => {
      expect(detailWatchers()).toEqual([SOMEONE_ELSE, MY_ID]);
    });
    expect(byKeyWatchers()).toEqual([SOMEONE_ELSE, MY_ID]);
  });

  it('does not add me twice when I am already watching', async () => {
    seed([MY_ID]);
    put.mockResolvedValue(WATCHED);

    const { result } = renderHook(() => useWatchTask(TASK_ID), { wrapper });
    result.current.mutate({});

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(byKeyWatchers()).toEqual([MY_ID]);
  });

  it('rolls BOTH entries back when the request fails', async () => {
    seed([SOMEONE_ELSE]);
    put.mockRejectedValue(new Error('nope'));

    const { result } = renderHook(() => useWatchTask(TASK_ID), { wrapper });
    result.current.mutate({});

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(detailWatchers()).toEqual([SOMEONE_ELSE]);
    expect(byKeyWatchers()).toEqual([SOMEONE_ELSE]);
  });

  it('invalidates both addresses on success, so the server has the last word', async () => {
    seed([SOMEONE_ELSE]);
    put.mockResolvedValue(WATCHED);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useWatchTask(TASK_ID), { wrapper });
    result.current.mutate({});

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // `isMuted` and the authoritative roster belong to the server (a second
    // device may have muted the same task), so the flip is reconciled.
    expect(queryClient.getQueryState(qk.task.detail(TASK_ID))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(qk.tasks.byKey(PROJECT_ID, TASK_KEY))?.isInvalidated).toBe(
      true,
    );
    expect(invalidate).toHaveBeenCalled();
  });

  /**
   * The predicate selects entries by SHAPE, and a `TaskSummary` in a board or a
   * flat list carries `id` too. Patching one would write a `watcherIds` field
   * onto a shape that has no such field and no way to render it.
   */
  it('leaves collection caches holding the same task alone', async () => {
    seed([SOMEONE_ELSE]);
    put.mockResolvedValue(WATCHED);

    const summary: TaskSummary = {
      id: TASK_ID,
      number: 142,
      title: 'Ship it',
      type: 'task',
      priority: 'medium',
      statusId: 'todo',
      assignee: null,
      storyPoints: null,
      startDate: null,
      dueDate: null,
      labelIds: [],
      epicId: null,
      parentId: null,
      boardRank: 'a1',
      backlogRank: 'a1',
      sprintId: null,
      hasDescription: false,
      commentCount: 0,
      attachmentCount: 0,
      updatedAt: '2026-03-04T10:00:00.000Z',
    };
    queryClient.setQueryData(qk.tasks.list(PROJECT_ID), [summary]);

    const { result } = renderHook(() => useWatchTask(TASK_ID), { wrapper });
    result.current.mutate({});

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(queryClient.getQueryData<TaskSummary[]>(qk.tasks.list(PROJECT_ID))?.[0]).toEqual(
      summary,
    );
  });
});

describe('useUnwatchTask', () => {
  it('removes me from BOTH entries', async () => {
    seed([SOMEONE_ELSE, MY_ID]);
    del.mockResolvedValue({ ...WATCHED, watching: false });

    const { result } = renderHook(() => useUnwatchTask(TASK_ID), { wrapper });
    result.current.mutate();

    await waitFor(() => {
      expect(detailWatchers()).toEqual([SOMEONE_ELSE]);
    });
    expect(byKeyWatchers()).toEqual([SOMEONE_ELSE]);
  });

  it('rolls BOTH entries back when the request fails', async () => {
    seed([SOMEONE_ELSE, MY_ID]);
    del.mockRejectedValue(new Error('nope'));

    const { result } = renderHook(() => useUnwatchTask(TASK_ID), { wrapper });
    result.current.mutate();

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(detailWatchers()).toEqual([SOMEONE_ELSE, MY_ID]);
    expect(byKeyWatchers()).toEqual([SOMEONE_ELSE, MY_ID]);
  });
});
