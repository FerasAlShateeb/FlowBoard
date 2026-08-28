import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initialRanks,
  type BoardResponse,
  type Label,
  type MoveTaskResponse,
  type PatchTaskInput,
  type Task,
  type TaskSummary,
  type UserSummary,
} from '@flowboard/shared';

import { qk } from '@/lib/query-keys';
import { columnOf, findBoardTask, planBoardMove } from '@/lib/board-cache';

/**
 * The optimistic move, exercised through TanStack's REAL mutation lifecycle.
 *
 * WHY IT IS NOT `renderHook`. The web package's test environment is DOM-free by
 * design (`vitest.config.ts`: `environment: 'node'`), and no jsdom or
 * `@testing-library/react` is in the frozen manifest. Rendering a provider to
 * reach four callbacks would mean adding a DOM to every suite in the package.
 *
 * A `MutationObserver` over a real `QueryClient` is the honest equivalent: it
 * is the same class `useMutation` wraps, it runs `onMutate → mutationFn →
 * onSuccess/onError` in the same order with the same context threading, and the
 * assertions are about CACHE CONTENTS — which is what actually has to be right.
 * Only the React binding is skipped, and that is the part with no logic in it.
 */

// The transport is mocked; `ApiError` and everything else stay real, because
// `lib/query-client` imports `ApiError` for its retry policy and a stubbed
// class would break `instanceof`.
const post = vi.fn();
const patch = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      post: (...args: unknown[]) => post(...args),
      patch: (...args: unknown[]) => patch(...args),
    },
  };
});

const { moveTaskMutationOptions, patchTaskMutationOptions, rankTaskMutationOptions } =
  await import('@/hooks/useTaskMutations');

const PROJECT_ID = 'p-1';
const [R0 = 'a0', R1 = 'a1', R2 = 'a2'] = initialRanks(3);

function summary(id: string, statusId: string, rank: string): TaskSummary {
  return {
    id,
    number: 1,
    title: id,
    type: 'task',
    priority: 'medium',
    statusId,
    assignee: null,
    storyPoints: null,
    startDate: null,
    dueDate: null,
    labelIds: [],
    epicId: null,
    parentId: null,
    boardRank: rank,
    backlogRank: rank,
    sprintId: null,
    hasDescription: false,
    commentCount: 0,
    attachmentCount: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** The authoritative task the server answers a move with. */
function serverTask(id: string, statusId: string, boardRank: string): Task {
  return {
    id,
    projectId: PROJECT_ID,
    projectKey: 'FB',
    number: 1,
    key: 'FB-1',
    title: id,
    description: null,
    type: 'task',
    statusId,
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
    boardRank,
    backlogRank: boardRank,
    resolvedAt: null,
    labels: [],
    watcherIds: [],
    dependencies: { blockers: [], blocked: [] },
    subtaskIds: [],
    commentCount: 0,
    attachmentCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
  };
}

function seedBoard(): BoardResponse {
  return {
    columns: {
      todo: [summary('t1', 'todo', R0), summary('t2', 'todo', R1)],
      doing: [summary('t3', 'doing', R0)],
    },
  };
}

let queryClient: QueryClient;
const onError = vi.fn();

beforeEach(() => {
  post.mockReset();
  patch.mockReset();
  onError.mockReset();
  queryClient = new QueryClient({
    // No retries: a failure path must reach `onError` once, immediately.
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  queryClient.setQueryData(qk.tasks.board(PROJECT_ID), seedBoard());
});

afterEach(() => {
  queryClient.clear();
});

/** Runs one move through the real lifecycle and resolves when it settles. */
async function runMove(intent: {
  taskId: string;
  fromStatusId: string;
  toStatusId: string;
  toIndex: number;
}) {
  const board = queryClient.getQueryData<BoardResponse>(qk.tasks.board(PROJECT_ID));
  const plan = planBoardMove(board!, intent);
  const observer = new MutationObserver(
    queryClient,
    moveTaskMutationOptions({ queryClient, projectId: PROJECT_ID, onError }),
  );
  return { plan, promise: observer.mutate(plan!) };
}

/**
 * Lets every pending microtask AND the timer queue drain.
 *
 * `onMutate` awaits `cancelQueries`, which is itself a promise chain of
 * unknown depth — counting `await Promise.resolve()` calls to match it is a
 * guess that breaks the next time TanStack changes an internal. One macrotask
 * is past all of it and still instant.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const boardNow = (): BoardResponse =>
  queryClient.getQueryData<BoardResponse>(qk.tasks.board(PROJECT_ID))!;

describe('useMoveTask — the optimistic board move', () => {
  it('sends the destination NEIGHBOURS and the client rank, never a position', async () => {
    post.mockResolvedValue({ task: serverTask('t1', 'doing', R2), rebalanced: false });

    const { plan, promise } = await runMove({
      taskId: 't1',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      toIndex: 0,
    });
    await promise;

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/tasks/t1/move');
    expect(body).toMatchObject({
      statusId: 'doing',
      beforeTaskId: 't3',
      clientRank: plan?.clientRank,
    });
    // The two neighbour fields are mutually exclusive in the contract.
    expect(body.afterTaskId).toBeUndefined();
  });

  it('splices the cache BEFORE the request resolves', async () => {
    // A promise that never settles: the assertion happens while the request is
    // still in flight, which is the entire point of an optimistic update.
    post.mockReturnValue(new Promise(() => {}));

    const { promise } = await runMove({
      taskId: 't1',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      toIndex: 0,
    });
    // The mutation never settles, so nothing awaits `promise`; it is voided
    // to keep the rejection-on-teardown lint quiet.
    void promise.catch(() => undefined);
    await flush();

    expect(columnOf(boardNow(), 'todo').map((task) => task.id)).toEqual(['t2']);
    expect(columnOf(boardNow(), 'doing').map((task) => task.id)).toEqual(['t1', 't3']);
    expect(findBoardTask(boardNow(), 't1')?.statusId).toBe('doing');
  });

  it('writes the AUTHORITATIVE task from the response on success', async () => {
    // The server hands back a rank the client did not choose — the cache must
    // end up with the server's, not the optimistic one.
    post.mockResolvedValue({ task: serverTask('t1', 'doing', R2), rebalanced: false });

    const { plan, promise } = await runMove({
      taskId: 't1',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      toIndex: 0,
    });
    await promise;

    expect(findBoardTask(boardNow(), 't1')?.boardRank).toBe(R2);
    expect(findBoardTask(boardNow(), 't1')?.boardRank).not.toBe(plan?.clientRank);
    // The detail cache is seeded from the same payload, so opening the sheet
    // straight after a drag does not refetch.
    expect(queryClient.getQueryData<Task>(qk.task.detail('t1'))?.boardRank).toBe(R2);
  });

  it('leaves exactly one copy of the card after a successful move', async () => {
    post.mockResolvedValue({ task: serverTask('t1', 'doing', R2), rebalanced: false });

    const { promise } = await runMove({
      taskId: 't1',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      toIndex: 0,
    });
    await promise;

    const ids = Object.values(boardNow().columns)
      .flat()
      .map((task) => task.id);
    expect(ids.filter((id) => id === 't1')).toHaveLength(1);
    expect(ids.sort()).toEqual(['t1', 't2', 't3']);
  });

  it('RESTORES the snapshot when the request fails', async () => {
    const before = structuredClone(seedBoard());
    post.mockRejectedValue(new Error('boom'));

    const { promise } = await runMove({
      taskId: 't1',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      toIndex: 0,
    });
    await expect(promise).rejects.toThrow('boom');

    expect(boardNow()).toEqual(before);
    expect(columnOf(boardNow(), 'todo').map((task) => task.id)).toEqual(['t1', 't2']);
    expect(findBoardTask(boardNow(), 't1')?.statusId).toBe('todo');
  });

  it('raises exactly one localized toast per failure', async () => {
    post.mockRejectedValue(new Error('boom'));

    const { promise } = await runMove({
      taskId: 't2',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      toIndex: 0,
    });
    await expect(promise).rejects.toThrow();

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('INVALIDATES rather than splices when the server reports a rebalance', async () => {
    post.mockResolvedValue({ task: serverTask('t1', 'doing', R2), rebalanced: true });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { promise } = await runMove({
      taskId: 't1',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      toIndex: 0,
    });
    await promise;

    // A rebalance rewrote every rank in the column, so every OTHER cached rank
    // is stale — only a refetch is correct.
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: qk.tasks.all(PROJECT_ID) }),
    );
    const [first] = invalidate.mock.calls as unknown as Array<[{ refetchType?: string }]>;
    expect(first?.[0].refetchType).toBeUndefined();
  });

  it('does not force a refetch on the ordinary success path', async () => {
    post.mockResolvedValue({ task: serverTask('t1', 'doing', R2), rebalanced: false });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { promise } = await runMove({
      taskId: 't1',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      toIndex: 0,
    });
    await promise;

    // Marked stale (`refetchType: 'none'`) so the next focus reconciles the
    // OTHER views, without a request per drag.
    const calls = invalidate.mock.calls as unknown as Array<[{ refetchType?: string }]>;
    expect(calls.length).toBeGreaterThan(0);
    for (const [args] of calls) {
      expect(args.refetchType).toBe('none');
    }
  });

  it('keeps a same-column reorder inside its column', async () => {
    post.mockResolvedValue({ task: serverTask('t1', 'todo', R2), rebalanced: false });

    const { promise } = await runMove({
      taskId: 't1',
      fromStatusId: 'todo',
      toStatusId: 'todo',
      toIndex: 1,
    });
    await promise;

    expect(columnOf(boardNow(), 'todo').map((task) => task.id)).toEqual(['t2', 't1']);
    expect(columnOf(boardNow(), 'doing').map((task) => task.id)).toEqual(['t3']);
  });
});

describe('usePatchTask — the optimistic field patch', () => {
  const listKey = qk.tasks.list(PROJECT_ID);
  const detailKey = qk.task.detail('t1');

  const ANA: UserSummary = { id: 'u-1', name: 'Ana Ruiz', avatarUrl: null };

  const UI_LABEL: Label = { id: 'l-1', projectId: PROJECT_ID, name: 'ui', color: '#22d3ee' };

  beforeEach(() => {
    queryClient.setQueryData(listKey, [summary('t1', 'todo', R0), summary('t2', 'todo', R1)]);
    queryClient.setQueryData(detailKey, serverTask('t1', 'todo', R0));
  });

  function runPatch(variables: PatchTaskInput & { taskId: string }) {
    const observer = new MutationObserver(
      queryClient,
      patchTaskMutationOptions({ queryClient, projectId: PROJECT_ID, onError }),
    );
    return observer.mutate(variables);
  }

  const listNow = (): TaskSummary[] => queryClient.getQueryData<TaskSummary[]>(listKey)!;
  const detailNow = (): Task => queryClient.getQueryData<Task>(detailKey)!;

  it('sends only the FIELDS — `taskId` addresses the row, it is not a column', async () => {
    patch.mockResolvedValue(serverTask('t1', 'todo', R0));

    await runPatch({ taskId: 't1', title: 'Renamed' });

    const [path, body] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/tasks/t1');
    expect(body).toEqual({ title: 'Renamed' });
  });

  it('paints board, flat list AND detail BEFORE the request resolves', async () => {
    patch.mockReturnValue(new Promise(() => {}));

    void runPatch({ taskId: 't1', title: 'Renamed', priority: 'highest' }).catch(() => undefined);
    await flush();

    expect(findBoardTask(boardNow(), 't1')?.title).toBe('Renamed');
    expect(findBoardTask(boardNow(), 't1')?.priority).toBe('highest');
    expect(listNow().find((task) => task.id === 't1')?.title).toBe('Renamed');
    expect(detailNow().title).toBe('Renamed');
  });

  it('moves the card to the new column when the patch changes `statusId`', async () => {
    patch.mockReturnValue(new Promise(() => {}));

    void runPatch({ taskId: 't1', statusId: 'doing' }).catch(() => undefined);
    await flush();

    // Exactly one copy: the card leaves `todo` rather than being duplicated.
    expect(columnOf(boardNow(), 'todo').map((task) => task.id)).toEqual(['t2']);
    expect(columnOf(boardNow(), 'doing').map((task) => task.id)).toContain('t1');
    const ids = Object.values(boardNow().columns)
      .flat()
      .map((task) => task.id);
    expect(ids.filter((id) => id === 't1')).toHaveLength(1);
  });

  it('leaves a field UNTOUCHED when the patch does not mention it', async () => {
    patch.mockReturnValue(new Promise(() => {}));

    void runPatch({ taskId: 't1', title: 'Renamed' }).catch(() => undefined);
    await flush();

    // The regression this guards: spreading a patch object writes `undefined`
    // over every key it merely declares as optional.
    expect(findBoardTask(boardNow(), 't1')?.priority).toBe('medium');
    expect(findBoardTask(boardNow(), 't1')?.statusId).toBe('todo');
    expect(detailNow().type).toBe('task');
  });

  it('writes `null` for a genuine clear — `null` is a value, `undefined` is silence', async () => {
    patch.mockReturnValue(new Promise(() => {}));

    void runPatch({ taskId: 't1', dueDate: null, storyPoints: null }).catch(() => undefined);
    await flush();

    expect(findBoardTask(boardNow(), 't1')?.dueDate).toBeNull();
    expect(detailNow().storyPoints).toBeNull();
  });

  it('expands `assigneeId` from the cached member list', async () => {
    queryClient.setQueryData(qk.project.members(PROJECT_ID), [
      { projectId: PROJECT_ID, user: ANA, role: 'member', joinedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    patch.mockReturnValue(new Promise(() => {}));

    void runPatch({ taskId: 't1', assigneeId: ANA.id }).catch(() => undefined);
    await flush();

    expect(findBoardTask(boardNow(), 't1')?.assignee).toEqual(ANA);
    expect(detailNow().assignee).toEqual(ANA);
  });

  it('leaves the assignee alone when the id cannot be expanded', async () => {
    // No member list cached: painting a blank avatar the user did not ask for
    // would be worse than one round trip of the previous value.
    patch.mockReturnValue(new Promise(() => {}));

    void runPatch({ taskId: 't1', assigneeId: 'u-unknown' }).catch(() => undefined);
    await flush();

    expect(findBoardTask(boardNow(), 't1')?.assignee).toBeNull();
  });

  it('unassigns immediately, because `null` needs no lookup', async () => {
    queryClient.setQueryData(listKey, [{ ...summary('t1', 'todo', R0), assignee: ANA }]);
    patch.mockReturnValue(new Promise(() => {}));

    void runPatch({ taskId: 't1', assigneeId: null }).catch(() => undefined);
    await flush();

    expect(listNow()[0]?.assignee).toBeNull();
  });

  it('paints `labelIds` on summaries and expands them on the detail entry', async () => {
    queryClient.setQueryData(qk.project.labels(PROJECT_ID), [UI_LABEL]);
    patch.mockReturnValue(new Promise(() => {}));

    void runPatch({ taskId: 't1', labelIds: [UI_LABEL.id] }).catch(() => undefined);
    await flush();

    expect(findBoardTask(boardNow(), 't1')?.labelIds).toEqual([UI_LABEL.id]);
    expect(detailNow().labels).toEqual([UI_LABEL]);
  });

  it('collapses a description to the `hasDescription` glyph on summaries', async () => {
    patch.mockReturnValue(new Promise(() => {}));

    void runPatch({ taskId: 't1', description: '  notes  ' }).catch(() => undefined);
    await flush();

    expect(findBoardTask(boardNow(), 't1')?.hasDescription).toBe(true);
    // The markdown itself never enters a list cache.
    expect(findBoardTask(boardNow(), 't1')).not.toHaveProperty('description');
    expect(detailNow().description).toBe('  notes  ');
  });

  it('does not INSERT the task into a list it was filtered out of', async () => {
    const otherKey = qk.tasks.list(PROJECT_ID, { assigneeId: 'someone-else' });
    queryClient.setQueryData(otherKey, [summary('t9', 'todo', R0)]);
    patch.mockReturnValue(new Promise(() => {}));

    void runPatch({ taskId: 't1', title: 'Renamed' }).catch(() => undefined);
    await flush();

    expect(queryClient.getQueryData<TaskSummary[]>(otherKey)?.map((t) => t.id)).toEqual(['t9']);
  });

  it('RESTORES every touched cache when the request fails, and toasts once', async () => {
    const boardBefore = structuredClone(boardNow());
    const listBefore = structuredClone(listNow());
    const detailBefore = structuredClone(detailNow());
    patch.mockRejectedValue(new Error('boom'));

    await expect(runPatch({ taskId: 't1', title: 'Renamed', statusId: 'doing' })).rejects.toThrow(
      'boom',
    );

    expect(boardNow()).toEqual(boardBefore);
    expect(listNow()).toEqual(listBefore);
    expect(detailNow()).toEqual(detailBefore);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('writes the AUTHORITATIVE task on success, not the optimistic guess', async () => {
    // The server normalizes the title; the cache must end up with ITS answer.
    patch.mockResolvedValue({ ...serverTask('t1', 'doing', R2), title: 'Renamed by server' });

    await runPatch({ taskId: 't1', title: 'renamed', statusId: 'doing' });

    expect(findBoardTask(boardNow(), 't1')?.title).toBe('Renamed by server');
    expect(findBoardTask(boardNow(), 't1')?.statusId).toBe('doing');
    expect(detailNow().title).toBe('Renamed by server');
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancels in-flight task queries so a refetch cannot repaint the old value', async () => {
    const cancel = vi.spyOn(queryClient, 'cancelQueries');
    patch.mockResolvedValue(serverTask('t1', 'todo', R0));

    await runPatch({ taskId: 't1', title: 'Renamed' });

    expect(cancel).toHaveBeenCalledWith({ queryKey: qk.tasks.all(PROJECT_ID) });
    expect(cancel).toHaveBeenCalledWith({ queryKey: qk.task.all('t1') });
  });
});

describe('useRankTask — the backlog reorder', () => {
  const backlogKey = qk.tasks.backlog(PROJECT_ID, { sprintId: 'none' });
  const sprintKey = qk.tasks.backlog(PROJECT_ID, { sprintId: 's-1' });

  beforeEach(() => {
    queryClient.setQueryData(backlogKey, [summary('b1', 'todo', R0), summary('b2', 'todo', R1)]);
    queryClient.setQueryData(sprintKey, [summary('s1', 'todo', R0)]);
  });

  async function runRank(toIndex: number) {
    const target = queryClient.getQueryData<TaskSummary[]>(sprintKey) ?? [];
    const { planBacklogRank } = await import('@/lib/board-cache');
    const plan = planBacklogRank(target, {
      taskId: 'b1',
      fromSprintId: null,
      toSprintId: 's-1',
      toIndex,
    });
    const observer = new MutationObserver(
      queryClient,
      rankTaskMutationOptions({ queryClient, projectId: PROJECT_ID, onError }),
    );
    return observer.mutate(plan);
  }

  it('moves the card between the two bucket caches optimistically', async () => {
    post.mockReturnValue(new Promise(() => {}));

    void runRank(0).catch(() => undefined);
    await flush();

    expect(queryClient.getQueryData<TaskSummary[]>(backlogKey)?.map((t) => t.id)).toEqual(['b2']);
    expect(queryClient.getQueryData<TaskSummary[]>(sprintKey)?.map((t) => t.id)).toEqual([
      'b1',
      's1',
    ]);
  });

  it('restores BOTH buckets when the request fails', async () => {
    post.mockRejectedValue(new Error('nope'));

    await expect(runRank(0)).rejects.toThrow('nope');

    expect(queryClient.getQueryData<TaskSummary[]>(backlogKey)?.map((t) => t.id)).toEqual([
      'b1',
      'b2',
    ]);
    expect(queryClient.getQueryData<TaskSummary[]>(sprintKey)?.map((t) => t.id)).toEqual(['s1']);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('sends the sprint id and the destination neighbour', async () => {
    const response: MoveTaskResponse = {
      task: serverTask('b1', 'todo', R2),
      rebalanced: false,
    };
    post.mockResolvedValue(response);

    await runRank(0);

    const [path, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/tasks/b1/rank');
    expect(body).toMatchObject({ sprintId: 's-1', beforeTaskId: 's1' });
  });
});
