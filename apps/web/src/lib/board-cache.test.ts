import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  initialRanks,
  type BoardResponse,
  type Status,
  type Task,
  type TaskSummary,
  type Transition,
} from '@flowboard/shared';

import { qk } from '@/lib/query-keys';
import {
  applyBacklogRank,
  applyBoardMove,
  checkDrop,
  columnOf,
  findBoardTask,
  isStaleTaskWrite,
  isTransitionAllowed,
  planBacklogRank,
  planBoardMove,
  planRank,
  removeBoardTask,
  removeFromBucket,
  taskToSummary,
  upsertBoardTask,
  wipStateOf,
  writeTaskEverywhere,
  writeTaskSummaryEverywhere,
} from '@/lib/board-cache';

/**
 * The board cache is where an optimistic drag can go wrong in ways no type
 * catches: a card that exists twice, a rank computed against a stale
 * neighbour, a same-column reorder that throws because it compared a task with
 * itself. These are the properties that keep those from happening.
 */

const [R0 = 'a0', R1 = 'a1', R2 = 'a2', R3 = 'a3'] = initialRanks(4);

function summary(
  id: string,
  statusId: string,
  boardRank: string,
  extra: Partial<TaskSummary> = {},
): TaskSummary {
  return {
    id,
    number: Number(id.replace(/\D/g, '')) || 1,
    title: `Task ${id}`,
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
    boardRank,
    backlogRank: boardRank,
    sprintId: null,
    hasDescription: false,
    commentCount: 0,
    attachmentCount: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

function status(id: string, overrides: Partial<Status> = {}): Status {
  return {
    id,
    projectId: 'p-1',
    name: id,
    category: 'todo',
    color: '#3b82f6',
    position: 0,
    wipLimit: null,
    ...overrides,
  };
}

/** Two columns: `todo` holds three cards, `doing` holds one. */
function board(): BoardResponse {
  return {
    columns: {
      todo: [summary('t1', 'todo', R0), summary('t2', 'todo', R1), summary('t3', 'todo', R2)],
      doing: [summary('t4', 'doing', R0)],
    },
  };
}

/** Every id on the board, so "did we lose or duplicate a card" is one assertion. */
function idsOf(value: BoardResponse): string[] {
  return Object.values(value.columns)
    .flat()
    .map((task) => task.id)
    .sort();
}

describe('planRank', () => {
  it('names the NEXT task as the before-neighbour when inserting mid-list', () => {
    const list = [summary('a', 'todo', R0), summary('b', 'todo', R1)];
    const plan = planRank(list, 1, (task) => task.boardRank);

    expect(plan.beforeTaskId).toBe('b');
    expect(plan.afterTaskId).toBeUndefined();
    // Strictly between the two neighbours — that is the whole contract.
    expect(plan.clientRank > R0).toBe(true);
    expect(plan.clientRank < R1).toBe(true);
  });

  it('names the PREVIOUS task when appending at the end', () => {
    const list = [summary('a', 'todo', R0), summary('b', 'todo', R1)];
    const plan = planRank(list, 2, (task) => task.boardRank);

    expect(plan.afterTaskId).toBe('b');
    expect(plan.beforeTaskId).toBeUndefined();
    expect(plan.clientRank > R1).toBe(true);
  });

  it('names no neighbour at all for an empty destination', () => {
    const plan = planRank([], 0, (task) => task.boardRank);
    expect(plan.beforeTaskId).toBeUndefined();
    expect(plan.afterTaskId).toBeUndefined();
    expect(plan.clientRank.length).toBeGreaterThan(0);
  });

  it('clamps an out-of-range index instead of throwing', () => {
    const list = [summary('a', 'todo', R0)];
    expect(planRank(list, 99, (task) => task.boardRank).afterTaskId).toBe('a');
    expect(planRank(list, -5, (task) => task.boardRank).beforeTaskId).toBe('a');
  });
});

describe('planBoardMove', () => {
  it('computes neighbours from the target column with the card already lifted', () => {
    // Same-column reorder: t1 (index 0) dropped at index 2. With t1 removed the
    // target is [t2, t3], so index 2 is "after t3".
    const plan = planBoardMove(board(), {
      taskId: 't1',
      fromStatusId: 'todo',
      toStatusId: 'todo',
      toIndex: 2,
    });

    expect(plan).not.toBeNull();
    expect(plan?.afterTaskId).toBe('t3');
    expect(plan?.clientRank).toBeDefined();
  });

  it('does NOT throw on a same-column no-op drop', () => {
    // The regression this guards: computing neighbours WITHOUT lifting the card
    // first makes `rankBetween` compare a rank with itself, which throws.
    expect(() =>
      planBoardMove(board(), {
        taskId: 't2',
        fromStatusId: 'todo',
        toStatusId: 'todo',
        toIndex: 1,
      }),
    ).not.toThrow();
  });

  it('returns null for a card the board no longer holds', () => {
    const plan = planBoardMove(board(), {
      taskId: 'ghost',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      toIndex: 0,
    });
    expect(plan).toBeNull();
  });
});

describe('applyBoardMove', () => {
  it('moves the card across columns and restamps its status and rank', () => {
    const before = board();
    const plan = planBoardMove(before, {
      taskId: 't1',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      toIndex: 1,
    });
    const after = applyBoardMove(before, plan!);

    expect(columnOf(after, 'todo').map((task) => task.id)).toEqual(['t2', 't3']);
    expect(columnOf(after, 'doing').map((task) => task.id)).toEqual(['t4', 't1']);
    expect(findBoardTask(after, 't1')?.statusId).toBe('doing');
    expect(findBoardTask(after, 't1')?.boardRank).toBe(plan!.clientRank);
  });

  it('never duplicates or loses a card', () => {
    const before = board();
    const plan = planBoardMove(before, {
      taskId: 't3',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      toIndex: 0,
    });
    expect(idsOf(applyBoardMove(before, plan!))).toEqual(idsOf(before));
  });

  it('leaves the snapshot untouched — the cache is compared by reference', () => {
    const before = board();
    const plan = planBoardMove(before, {
      taskId: 't1',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      toIndex: 0,
    });
    const after = applyBoardMove(before, plan!);

    expect(columnOf(before, 'todo').map((task) => task.id)).toEqual(['t1', 't2', 't3']);
    expect(after).not.toBe(before);
  });

  it('creates a destination column the snapshot did not have', () => {
    const before = board();
    const plan = planBoardMove(before, {
      taskId: 't1',
      fromStatusId: 'todo',
      toStatusId: 'review',
      toIndex: 0,
    });
    const after = applyBoardMove(before, plan!);
    expect(columnOf(after, 'review').map((task) => task.id)).toEqual(['t1']);
  });

  it('orders the destination by RANK, not by the drop index', () => {
    // A card whose rank sorts first must land first even if it was appended.
    const before: BoardResponse = { columns: { todo: [summary('a', 'todo', R2)] } };
    const after = upsertBoardTask(before, summary('b', 'todo', R0));
    expect(columnOf(after, 'todo').map((task) => task.id)).toEqual(['b', 'a']);
  });
});

describe('upsertBoardTask / removeBoardTask', () => {
  it('relocates a card whose status changed rather than leaving two copies', () => {
    const after = upsertBoardTask(board(), summary('t1', 'doing', R3));
    expect(columnOf(after, 'todo').map((task) => task.id)).toEqual(['t2', 't3']);
    expect(columnOf(after, 'doing').map((task) => task.id)).toEqual(['t4', 't1']);
  });

  it('drops a card from every column', () => {
    expect(idsOf(removeBoardTask(board(), 't2'))).toEqual(['t1', 't3', 't4']);
  });
});

describe('backlog buckets', () => {
  it('plans a cross-bucket move against the target bucket', () => {
    const target = [summary('b1', 'todo', R0), summary('b2', 'todo', R1)];
    const plan = planBacklogRank(target, {
      taskId: 'x',
      fromSprintId: null,
      toSprintId: 's-1',
      toIndex: 1,
    });

    expect(plan.beforeTaskId).toBe('b2');
    expect(plan.toSprintId).toBe('s-1');
  });

  it('restamps sprint and backlog rank when applied', () => {
    const moved = summary('x', 'todo', R3, { sprintId: null, backlogRank: R3 });
    const target = [summary('b1', 'todo', R0)];
    const plan = planBacklogRank(target, {
      taskId: 'x',
      fromSprintId: null,
      toSprintId: 's-1',
      toIndex: 0,
    });

    const after = applyBacklogRank(target, moved, plan);
    expect(after.map((task) => task.id)).toEqual(['x', 'b1']);
    expect(after[0]?.sprintId).toBe('s-1');
    expect(after[0]?.backlogRank).toBe(plan.clientRank);
  });

  it('does not duplicate on a same-bucket reorder', () => {
    const bucket = [summary('b1', 'todo', R0), summary('b2', 'todo', R1)];
    const plan = planBacklogRank(bucket, {
      taskId: 'b1',
      fromSprintId: 's-1',
      toSprintId: 's-1',
      toIndex: 2,
    });
    const after = applyBacklogRank(bucket, bucket[0]!, plan);
    expect(after.map((task) => task.id)).toEqual(['b2', 'b1']);
  });

  it('removes without disturbing the rest', () => {
    const bucket = [summary('b1', 'todo', R0), summary('b2', 'todo', R1)];
    expect(removeFromBucket(bucket, 'b1').map((task) => task.id)).toEqual(['b2']);
  });
});

describe('isTransitionAllowed', () => {
  const edge = (from: string, to: string): Transition => ({
    id: `${from}-${to}`,
    projectId: 'p-1',
    fromStatusId: from,
    toStatusId: to,
  });

  it('allows everything when the project has no transitions at all', () => {
    expect(isTransitionAllowed([], 'todo', 'done')).toBe(true);
  });

  it('restricts only the statuses that have rows', () => {
    const transitions = [edge('todo', 'doing')];
    expect(isTransitionAllowed(transitions, 'todo', 'doing')).toBe(true);
    expect(isTransitionAllowed(transitions, 'todo', 'done')).toBe(false);
    // `doing` has no rows of its own, so it stays open.
    expect(isTransitionAllowed(transitions, 'doing', 'todo')).toBe(true);
  });

  it('always allows a status to itself — a reorder is not a transition', () => {
    expect(isTransitionAllowed([edge('todo', 'doing')], 'todo', 'todo')).toBe(true);
  });
});

describe('wipStateOf', () => {
  it('reports no limit as unlimited', () => {
    expect(wipStateOf(status('todo'), 99)).toEqual({
      count: 99,
      limit: null,
      atLimit: false,
      over: false,
    });
  });

  it('separates "at the limit" from "over it"', () => {
    const column = status('todo', { wipLimit: 3 });
    expect(wipStateOf(column, 2)).toMatchObject({ atLimit: false, over: false });
    expect(wipStateOf(column, 3)).toMatchObject({ atLimit: true, over: false });
    expect(wipStateOf(column, 4)).toMatchObject({ atLimit: true, over: true });
  });
});

describe('checkDrop', () => {
  const doing = status('doing', { wipLimit: 2 });

  it('allows a same-column reorder regardless of the limit', () => {
    const check = checkDrop({
      fromStatusId: 'doing',
      targetStatus: doing,
      targetCount: 5,
      transitions: [],
    });
    expect(check.allowed).toBe(true);
    // The count is NOT incremented for a same-column move: the card is already
    // in the column and moving it does not add occupancy.
    expect(check.wip.count).toBe(5);
  });

  it('counts the incoming card when the status changes', () => {
    const check = checkDrop({
      fromStatusId: 'todo',
      targetStatus: doing,
      targetCount: 2,
      transitions: [],
    });
    expect(check.wip.count).toBe(3);
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('wip');
  });

  it('reports a forbidden transition ahead of a WIP breach', () => {
    const check = checkDrop({
      fromStatusId: 'todo',
      targetStatus: doing,
      targetCount: 9,
      transitions: [{ id: '1', projectId: 'p-1', fromStatusId: 'todo', toStatusId: 'review' }],
    });
    // Both rules are broken; the transition is the one the server will refuse
    // outright, so it is the one reported.
    expect(check.reason).toBe('transition');
  });

  it('can report a WIP breach without refusing the drop', () => {
    const check = checkDrop({
      fromStatusId: 'todo',
      targetStatus: doing,
      targetCount: 5,
      transitions: [],
      enforceWip: false,
    });
    expect(check.allowed).toBe(true);
    expect(check.wip.over).toBe(true);
  });
});

describe('taskToSummary', () => {
  const task: Task = {
    id: 't1',
    projectId: 'p-1',
    projectKey: 'FB',
    number: 142,
    key: 'FB-142',
    title: 'Ship it',
    description: '  ',
    type: 'story',
    statusId: 'todo',
    priority: 'high',
    assignee: null,
    reporter: null,
    storyPoints: 3,
    startDate: null,
    dueDate: null,
    sprintId: null,
    epicId: null,
    epic: null,
    parentId: null,
    boardRank: R0,
    backlogRank: R1,
    resolvedAt: null,
    labels: [
      { id: 'l-1', projectId: 'p-1', name: 'ui', color: '#3b82f6' },
      { id: 'l-2', projectId: 'p-1', name: 'bug', color: '#ef4444' },
    ],
    watcherIds: [],
    dependencies: { blockers: [], blocked: [] },
    subtaskIds: [],
    commentCount: 2,
    attachmentCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };

  it('flattens labels to ids, the way the list endpoints do', () => {
    expect(taskToSummary(task).labelIds).toEqual(['l-1', 'l-2']);
  });

  it('collapses a whitespace-only description to "no notes"', () => {
    expect(taskToSummary(task).hasDescription).toBe(false);
    expect(taskToSummary({ ...task, description: 'real' }).hasDescription).toBe(true);
  });

  it('carries no description field into the list shape', () => {
    expect('description' in taskToSummary(task)).toBe(false);
  });
});

/**
 * THE STALENESS GUARD.
 *
 * Two authoritative copies of one task can be in flight at once — a PATCH
 * response and the `task:updated` broadcast the same edit produced, or two
 * edits whose responses crossed on the wire — and they do not have to arrive in
 * the order they were made. Without an ordering rule the last packet wins, and
 * a field visibly snaps back to a value the user already replaced.
 *
 * These assert the RULE in both directions, because a guard that is too eager
 * is worse than none: it silently swallows edits.
 */
describe('isStaleTaskWrite', () => {
  const cached = { updatedAt: '2026-03-04T10:00:00.000Z' };

  it('refuses a strictly OLDER write', () => {
    expect(isStaleTaskWrite(cached, { updatedAt: '2026-03-04T09:59:59.000Z' })).toBe(true);
  });

  it('accepts a NEWER write', () => {
    expect(isStaleTaskWrite(cached, { updatedAt: '2026-03-04T10:00:01.000Z' })).toBe(false);
  });

  /**
   * The case a naive `<=` gets wrong. Two edits inside one clock tick are
   * ordinary — a cell edited twice, a rename right after a status change — and
   * `updatedAt` cannot separate them, so a tie must still apply or the second
   * edit is dropped and never repainted.
   */
  it('ACCEPTS an equal stamp — same-tick edits are real', () => {
    expect(isStaleTaskWrite(cached, { updatedAt: cached.updatedAt })).toBe(false);
  });

  it('accepts anything when the cache holds nothing yet', () => {
    expect(isStaleTaskWrite(undefined, cached)).toBe(false);
    expect(isStaleTaskWrite(null, cached)).toBe(false);
  });

  it('accepts rather than vetoes when a stamp does not parse', () => {
    // A guard that swallowed updates over an unrecognised format would be far
    // worse than the race it prevents.
    expect(isStaleTaskWrite({ updatedAt: 'not a date' }, cached)).toBe(false);
    expect(isStaleTaskWrite(cached, { updatedAt: 'not a date' })).toBe(false);
  });
});

describe('writeTaskEverywhere', () => {
  const PROJECT = 'p-1';
  const AT = (iso: string) => iso;

  function detail(overrides: Partial<Task> = {}): Task {
    return {
      id: 't1',
      projectId: PROJECT,
      projectKey: 'FB',
      number: 1,
      key: 'FB-1',
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
      boardRank: R0,
      backlogRank: R0,
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

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const seeded = summary('t1', 'todo', R0, {
      title: 'Ship it',
      updatedAt: AT('2026-03-04T10:00:00.000Z'),
    });
    queryClient.setQueryData(qk.tasks.board(PROJECT), {
      columns: { todo: [seeded] },
    } satisfies BoardResponse);
    queryClient.setQueryData(qk.tasks.list(PROJECT), [seeded]);
    queryClient.setQueryData(qk.task.detail('t1'), detail());
  });

  afterEach(() => {
    queryClient.clear();
  });

  const boardCard = () =>
    queryClient.getQueryData<BoardResponse>(qk.tasks.board(PROJECT))?.columns.todo?.[0];
  const listRow = () => queryClient.getQueryData<TaskSummary[]>(qk.tasks.list(PROJECT))?.[0];
  const detailEntry = () => queryClient.getQueryData<Task>(qk.task.detail('t1'));

  it('writes a NEWER task into the detail entry, the board and the flat list', () => {
    writeTaskEverywhere(
      queryClient,
      PROJECT,
      detail({ title: 'Newer', updatedAt: '2026-03-04T10:00:05.000Z' }),
    );

    expect(detailEntry()?.title).toBe('Newer');
    expect(boardCard()?.title).toBe('Newer');
    expect(listRow()?.title).toBe('Newer');
  });

  it('DISCARDS a write whose updatedAt is older than what the cache holds', () => {
    writeTaskEverywhere(
      queryClient,
      PROJECT,
      detail({ title: 'Older', updatedAt: '2026-03-04T09:59:00.000Z' }),
    );

    expect(detailEntry()?.title).toBe('Ship it');
    expect(boardCard()?.title).toBe('Ship it');
    expect(listRow()?.title).toBe('Ship it');
  });

  it('applies a write with the SAME updatedAt — two edits inside one tick', () => {
    writeTaskEverywhere(
      queryClient,
      PROJECT,
      detail({ title: 'Same tick', updatedAt: '2026-03-04T10:00:00.000Z' }),
    );

    expect(detailEntry()?.title).toBe('Same tick');
    expect(boardCard()?.title).toBe('Same tick');
    expect(listRow()?.title).toBe('Same tick');
  });

  it('guards each entry independently — a lagging list does not veto a fresh board', () => {
    // A filtered list refetched a moment ago can legitimately be NEWER than the
    // board beside it; the write has to land on the one that is behind and skip
    // the one that is ahead.
    queryClient.setQueryData(qk.tasks.list(PROJECT), [
      summary('t1', 'todo', R0, { title: 'Ahead', updatedAt: '2026-03-04T11:00:00.000Z' }),
    ]);

    writeTaskEverywhere(
      queryClient,
      PROJECT,
      detail({ title: 'Middle', updatedAt: '2026-03-04T10:30:00.000Z' }),
    );

    expect(boardCard()?.title).toBe('Middle');
    expect(listRow()?.title).toBe('Ahead');
  });
});

describe('writeTaskSummaryEverywhere', () => {
  const PROJECT = 'p-1';
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(qk.tasks.board(PROJECT), {
      columns: { todo: [summary('t1', 'todo', R0, { updatedAt: '2026-03-04T10:00:00.000Z' })] },
    } satisfies BoardResponse);
  });

  afterEach(() => {
    queryClient.clear();
  });

  const boardCard = () =>
    queryClient.getQueryData<BoardResponse>(qk.tasks.board(PROJECT))?.columns.todo?.[0];

  it('applies the socket path the same way — newer in, older out', () => {
    writeTaskSummaryEverywhere(
      queryClient,
      PROJECT,
      summary('t1', 'todo', R0, { title: 'Remote newer', updatedAt: '2026-03-04T10:00:01.000Z' }),
    );
    expect(boardCard()?.title).toBe('Remote newer');

    writeTaskSummaryEverywhere(
      queryClient,
      PROJECT,
      summary('t1', 'todo', R0, { title: 'Remote older', updatedAt: '2026-03-04T09:00:00.000Z' }),
    );
    expect(boardCard()?.title).toBe('Remote newer');
  });
});
