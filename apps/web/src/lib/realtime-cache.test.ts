import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import type {
  BoardResponse,
  Notification,
  Status,
  TaskSummary,
  Transition,
} from '@flowboard/shared';

import { qk } from '@/lib/query-keys';
import type { NotificationPage } from '@/hooks/useNotifications';
import {
  applyCommentCreated,
  applyCommentDeleted,
  applyCommentUpdated,
  applyNotificationNew,
  applySprintChanged,
  applyTaskCreated,
  applyTaskDeleted,
  applyTaskMoved,
  applyTaskUpdated,
  applyWorkflowChanged,
  cancelProjectRefresh,
  createRealtimeCacheHandlers,
  PROJECT_REFRESH_DEBOUNCE_MS,
  scheduleProjectRefresh,
} from '@/lib/realtime-cache';

/**
 * The realtime cache layer, driven against a REAL `QueryClient` seeded with the
 * shapes a live app holds.
 *
 * The assertions are deliberately about the CACHE, not about which method was
 * called: "the card is in the To Do column with the new rank" is the property
 * the board renders, while "`setQueriesData` was invoked" would still pass if
 * the splice put the card in the wrong column. The one place spies appear is
 * `invalidateQueries`, because an invalidation's whole effect is a future
 * request that a headless client will not make.
 */

const PROJECT = '11111111-1111-4111-8111-111111111111';
const TODO = '22222222-2222-4222-8222-222222222222';
const DOING = '33333333-3333-4333-8333-333333333333';

function summary(id: string, overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    number: 1,
    title: `Task ${id}`,
    type: 'task',
    priority: 'medium',
    statusId: TODO,
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
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const TASK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** The stamp every seeded card carries — see `summary()`. */
const SEEDED_AT = '2026-01-01T00:00:00.000Z';
/** A move that happened AFTER the seeded state, so it is the newer write. */
const MOVED_AT = '2026-01-02T00:00:00.000Z';
/** A move that lost the race — older than what the cache already holds. */
const STALE_AT = '2025-12-31T00:00:00.000Z';

let queryClient: QueryClient;

/** A board with two cards in To Do, plus a flat list holding only the first. */
function seedCaches(): void {
  const board: BoardResponse = {
    columns: {
      [TODO]: [summary(TASK_A, { boardRank: 'a1' }), summary(TASK_B, { boardRank: 'a2' })],
      [DOING]: [],
    },
  };
  queryClient.setQueryData(qk.tasks.board(PROJECT), board);
  queryClient.setQueryData(qk.tasks.list(PROJECT, { assigneeId: 'me' }), [
    summary(TASK_A, { boardRank: 'a1' }),
  ]);
}

function board(): BoardResponse {
  const value = queryClient.getQueryData<BoardResponse>(qk.tasks.board(PROJECT));
  if (!value) throw new Error('board cache is missing');
  return value;
}

function flatList(): TaskSummary[] {
  return (
    queryClient.getQueryData<TaskSummary[]>(qk.tasks.list(PROJECT, { assigneeId: 'me' })) ?? []
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  seedCaches();
});

afterEach(() => {
  cancelProjectRefresh();
  queryClient.clear();
});

describe('task:moved', () => {
  it('splices the card into its new column at its new rank', () => {
    applyTaskMoved(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      statusId: DOING,
      boardRank: 'a5',
      rebalanced: false,
      updatedAt: MOVED_AT,
    });

    expect(board().columns[TODO]?.map((task) => task.id)).toEqual([TASK_B]);
    expect(board().columns[DOING]).toEqual([
      expect.objectContaining({ id: TASK_A, statusId: DOING, boardRank: 'a5' }),
    ]);
  });

  it('reorders within one column', () => {
    applyTaskMoved(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      statusId: TODO,
      boardRank: 'a3',
      rebalanced: false,
      updatedAt: MOVED_AT,
    });

    expect(board().columns[TODO]?.map((task) => task.id)).toEqual([TASK_B, TASK_A]);
  });

  /**
   * A rebalance rewrote every rank in the column, so every OTHER cached rank is
   * stale — splicing one card would leave the board ordered by a mix of old and
   * new keys. This is the one case where a refetch is the right answer.
   */
  it('invalidates the whole task prefix instead of splicing when rebalanced', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applyTaskMoved(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      statusId: DOING,
      boardRank: 'zz',
      rebalanced: true,
      updatedAt: MOVED_AT,
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.tasks.all(PROJECT) });
    // Untouched: the refetch is the source of truth now.
    expect(board().columns[TODO]?.map((task) => task.id)).toEqual([TASK_A, TASK_B]);
  });

  /** A filtered board that never held the card must not gain it. */
  it('leaves a board that does not hold the task alone', () => {
    const filteredKey = qk.tasks.board(PROJECT, { assigneeId: 'someone' });
    const empty: BoardResponse = { columns: { [TODO]: [], [DOING]: [] } };
    queryClient.setQueryData(filteredKey, empty);

    applyTaskMoved(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      statusId: DOING,
      boardRank: 'a5',
      rebalanced: false,
      updatedAt: MOVED_AT,
    });

    expect(queryClient.getQueryData<BoardResponse>(filteredKey)).toEqual(empty);
  });

  it('does not touch another project s caches', () => {
    const otherProject = '99999999-9999-4999-8999-999999999999';
    const otherBoard: BoardResponse = { columns: { [TODO]: [summary(TASK_A)] } };
    queryClient.setQueryData(qk.tasks.board(otherProject), otherBoard);

    applyTaskMoved(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      statusId: DOING,
      boardRank: 'a5',
      rebalanced: false,
      updatedAt: MOVED_AT,
    });

    expect(queryClient.getQueryData<BoardResponse>(qk.tasks.board(otherProject))).toEqual(
      otherBoard,
    );
  });

  /**
   * ── The staleness guard (WP5.6) ───────────────────────────────────────────
   * `task:moved` used to be the one task write with no version stamp, so two
   * moves of the same card broadcast out of order left the board showing the
   * first. The payload now carries the `updatedAt` the move transaction wrote,
   * and this splice consults the same `isStaleTaskWrite` rule as every other
   * writer in the app.
   */
  it('drops a move that is older than what the cache already holds', () => {
    // The cache has already advanced past this broadcast: TASK_A moved to DOING
    // at MOVED_AT, and only now does the earlier move arrive.
    applyTaskMoved(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      statusId: DOING,
      boardRank: 'a5',
      rebalanced: false,
      updatedAt: MOVED_AT,
    });

    applyTaskMoved(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      statusId: TODO,
      boardRank: 'a9',
      rebalanced: false,
      updatedAt: STALE_AT,
    });

    // The late arrival did NOT drag the card back to To Do.
    expect(board().columns[DOING]).toEqual([
      expect.objectContaining({ id: TASK_A, statusId: DOING, boardRank: 'a5' }),
    ]);
    expect(board().columns[TODO]?.map((task) => task.id)).toEqual([TASK_B]);
  });

  /**
   * Equal stamps still apply — two writes inside one clock tick are ordinary
   * and `updatedAt` has no sub-tick resolution to order them by. Refusing a tie
   * would drop the second move and leave the card where the first put it. See
   * `isStaleTaskWrite` for the full argument.
   */
  it('applies a move whose stamp EQUALS the cached one', () => {
    applyTaskMoved(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      statusId: DOING,
      boardRank: 'a5',
      rebalanced: false,
      updatedAt: SEEDED_AT,
    });

    expect(board().columns[DOING]).toEqual([
      expect.objectContaining({ id: TASK_A, statusId: DOING, boardRank: 'a5' }),
    ]);
  });

  /** The applied splice advances the row's stamp, or the next one cannot order against it. */
  it('writes the payload stamp onto the spliced card', () => {
    applyTaskMoved(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      statusId: DOING,
      boardRank: 'a5',
      rebalanced: false,
      updatedAt: MOVED_AT,
    });

    expect(board().columns[DOING]?.[0]?.updatedAt).toBe(MOVED_AT);
  });

  /**
   * The guard runs PER CACHE ENTRY, not once up front. Board queries are
   * fetched independently, so one can already hold a newer row than another; a
   * single decision at the top would either drop the write everywhere or apply
   * it everywhere, and both are wrong when the entries disagree.
   */
  it('drops the write only from the entry that has moved past it', () => {
    // A second board query for the same project, fetched later, so its copy of
    // the card is already NEWER than the broadcast below. The default board
    // (seeded at SEEDED_AT) is older than it.
    const aheadKey = qk.tasks.board(PROJECT, { assigneeId: 'someone' });
    queryClient.setQueryData(aheadKey, {
      columns: { [TODO]: [summary(TASK_A, { boardRank: 'a1', updatedAt: MOVED_AT })], [DOING]: [] },
    } satisfies BoardResponse);

    applyTaskMoved(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      statusId: DOING,
      boardRank: 'a7',
      rebalanced: false,
      // Between the two entries' stamps: newer than one, older than the other.
      updatedAt: '2026-01-01T12:00:00.000Z',
    });

    // Applied by the entry that is behind …
    expect(board().columns[DOING]).toEqual([
      expect.objectContaining({ id: TASK_A, boardRank: 'a7' }),
    ]);
    // … and refused by the one that is ahead, which keeps its own newer row.
    const ahead = queryClient.getQueryData<BoardResponse>(aheadKey);
    expect(ahead?.columns[DOING]).toEqual([]);
    expect(ahead?.columns[TODO]).toEqual([
      expect.objectContaining({ id: TASK_A, boardRank: 'a1', updatedAt: MOVED_AT }),
    ]);
  });

  /**
   * A `rebalanced` payload INVALIDATES rather than splices, and an invalidation
   * cannot paint a stale value — it throws the entry away and refetches. So the
   * guard deliberately does not gate that branch, and a late rebalance must
   * still trigger the refetch.
   */
  it('still invalidates on a rebalance whose stamp is older than the cache', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applyTaskMoved(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      statusId: DOING,
      boardRank: 'zz',
      rebalanced: true,
      updatedAt: STALE_AT,
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.tasks.all(PROJECT) });
  });
});

describe('task:updated', () => {
  it('replaces the card on the board', () => {
    applyTaskUpdated(queryClient, {
      projectId: PROJECT,
      task: summary(TASK_A, { title: 'Renamed remotely' }),
    });

    expect(board().columns[TODO]?.[0]).toMatchObject({ id: TASK_A, title: 'Renamed remotely' });
  });

  it('patches a flat list that already holds the task', () => {
    applyTaskUpdated(queryClient, {
      projectId: PROJECT,
      task: summary(TASK_A, { title: 'Renamed remotely' }),
    });

    expect(flatList()).toEqual([expect.objectContaining({ title: 'Renamed remotely' })]);
  });

  /**
   * A flat list is a FILTERED page. Inserting a row the server filtered out
   * would put a task on screen that the filter says does not belong there.
   */
  it('does NOT insert into a filtered list that never held the task', () => {
    applyTaskUpdated(queryClient, { projectId: PROJECT, task: summary(TASK_B) });

    expect(flatList().map((task) => task.id)).toEqual([TASK_A]);
  });

  /**
   * ORDERING, not arrival order.
   *
   * A broadcast and the mutation response it came from describe the SAME edit
   * and race each other on the wire; so do two edits a second apart. Whichever
   * lands last used to win, which is how a title the user just fixed snaps back
   * to the previous one and stays there. `updatedAt` is the server's own
   * version stamp, and the writers refuse anything strictly older than what the
   * cache holds.
   */
  it('discards a broadcast that is OLDER than the version already cached', () => {
    applyTaskUpdated(queryClient, {
      projectId: PROJECT,
      task: summary(TASK_A, { title: 'Newer', updatedAt: '2026-01-02T00:00:00.000Z' }),
    });

    applyTaskUpdated(queryClient, {
      projectId: PROJECT,
      task: summary(TASK_A, {
        title: 'Older, arrived late',
        updatedAt: '2026-01-01T12:00:00.000Z',
      }),
    });

    expect(board().columns[TODO]?.[0]).toMatchObject({ title: 'Newer' });
    expect(flatList()[0]).toMatchObject({ title: 'Newer' });
  });

  it('still applies a broadcast stamped in the SAME second — same-tick edits are real', () => {
    // The seeded caches are at `2026-01-01T00:00:00.000Z`; an equal stamp is a
    // second edit inside one tick, not a replay.
    applyTaskUpdated(queryClient, {
      projectId: PROJECT,
      task: summary(TASK_A, { title: 'Same tick', updatedAt: '2026-01-01T00:00:00.000Z' }),
    });

    expect(board().columns[TODO]?.[0]).toMatchObject({ title: 'Same tick' });
  });

  it('invalidates the task detail rather than overwriting it with a summary', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applyTaskUpdated(queryClient, { projectId: PROJECT, task: summary(TASK_A) });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.task.detail(TASK_A) });
  });

  /**
   * The Roadmap's arrow layer lives OUTSIDE the `qk.tasks` prefix, so no task
   * invalidation reaches it — and dependency edges arrive as an ordinary
   * `task:updated`, because the API collapses four mutations into that one
   * event. `changedFields` is what tells them apart.
   */
  it('marks the dependency caches stale when the edges actually changed', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applyTaskUpdated(queryClient, {
      projectId: PROJECT,
      task: summary(TASK_A),
      changedFields: ['dependencies'],
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: qk.project.dependencies(PROJECT),
      refetchType: 'none',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.task.dependencies(TASK_A) });
  });

  /**
   * The whole point of the field. A remote title edit used to mark the entire
   * project's edge set stale, on every keystroke somebody else typed.
   */
  it('leaves the dependency graph alone for an unrelated field change', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applyTaskUpdated(queryClient, {
      projectId: PROJECT,
      task: summary(TASK_A),
      changedFields: ['title'],
    });

    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: qk.project.dependencies(PROJECT) }),
    );
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: qk.task.dependencies(TASK_A) }),
    );
  });

  /**
   * ABSENT MEANS UNKNOWN, NOT "NO". The field is optional on the wire; a
   * publisher that cannot enumerate its change omits it, and reading that as
   * "no dependency change" would silently stop updating the Roadmap. The
   * conservative reading costs one invalidation of a usually-unmounted query.
   */
  it('falls back to invalidating when the publisher named no fields', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applyTaskUpdated(queryClient, { projectId: PROJECT, task: summary(TASK_A) });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: qk.project.dependencies(PROJECT),
      refetchType: 'none',
    });
  });

  /** The list caches are marked stale, never refetched on a remote keystroke. */
  it('marks task collections stale without firing a request', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applyTaskUpdated(queryClient, { projectId: PROJECT, task: summary(TASK_A) });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: qk.tasks.all(PROJECT),
      refetchType: 'none',
    });
  });
});

describe('task:created', () => {
  it('inserts the new card into the board', () => {
    const created = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    applyTaskCreated(queryClient, {
      projectId: PROJECT,
      task: summary(created, { boardRank: 'a3' }),
    });

    expect(board().columns[TODO]?.map((task) => task.id)).toEqual([TASK_A, TASK_B, created]);
  });

  it('does not insert into a filtered flat list', () => {
    applyTaskCreated(queryClient, {
      projectId: PROJECT,
      task: summary('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    });

    expect(flatList().map((task) => task.id)).toEqual([TASK_A]);
  });
});

describe('task:deleted', () => {
  it('drops the card from every collection', () => {
    applyTaskDeleted(queryClient, { projectId: PROJECT, taskId: TASK_A });

    expect(board().columns[TODO]?.map((task) => task.id)).toEqual([TASK_B]);
    expect(flatList()).toEqual([]);
  });

  /** Refetching a deleted task is a guaranteed 404, so its entries are removed. */
  it('removes the task s own cache entries', () => {
    queryClient.setQueryData(qk.task.comments(TASK_A), []);
    const remove = vi.spyOn(queryClient, 'removeQueries');

    applyTaskDeleted(queryClient, { projectId: PROJECT, taskId: TASK_A });

    expect(remove).toHaveBeenCalledWith({ queryKey: qk.task.all(TASK_A) });
    expect(queryClient.getQueryData(qk.task.comments(TASK_A))).toBeUndefined();
  });
});

describe('comment events', () => {
  it('invalidates the thread and bumps the card s comment badge', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applyCommentCreated(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      comment: {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        taskId: TASK_A,
        author: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Ada', avatarUrl: null },
        body: 'Nice',
        editedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.task.comments(TASK_A) });
    expect(board().columns[TODO]?.[0]?.commentCount).toBe(1);
  });

  it('decrements the badge on a delete and never goes negative', () => {
    applyCommentDeleted(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      commentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    });

    expect(board().columns[TODO]?.[0]?.commentCount).toBe(0);
  });

  it('leaves the count alone on an edit', () => {
    applyCommentUpdated(queryClient, {
      projectId: PROJECT,
      taskId: TASK_A,
      comment: {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        taskId: TASK_A,
        author: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Ada', avatarUrl: null },
        body: 'Edited',
        editedAt: '2026-01-02T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(board().columns[TODO]?.[0]?.commentCount).toBe(0);
  });
});

describe('sprint:changed', () => {
  it('invalidates the sprint list and the backlog buckets', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applySprintChanged(queryClient, {
      projectId: PROJECT,
      sprintId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      action: 'updated',
      sprint: null,
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.sprints.all(PROJECT) });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [...qk.tasks.all(PROJECT), 'backlog'],
    });
  });

  /** Reports are the most expensive reads in the app — only the two actions
   *  that actually move points touch them. */
  it('leaves the reports alone for a rename', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applySprintChanged(queryClient, {
      projectId: PROJECT,
      sprintId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      action: 'updated',
      sprint: null,
    });

    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: qk.reports.all(PROJECT) });
  });

  it('invalidates the reports when a sprint completes', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applySprintChanged(queryClient, {
      projectId: PROJECT,
      sprintId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      action: 'completed',
      sprint: null,
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.reports.all(PROJECT) });
  });
});

describe('workflow:changed', () => {
  const statuses: Status[] = [
    {
      id: TODO,
      projectId: PROJECT,
      name: 'To Do',
      category: 'todo',
      color: '#64748b',
      position: 0,
      wipLimit: null,
    },
    {
      id: DOING,
      projectId: PROJECT,
      name: 'Doing',
      category: 'in_progress',
      color: '#3b82f6',
      position: 1,
      wipLimit: 3,
    },
  ];
  const transitions: Transition[] = [
    {
      id: '44444444-4444-4444-8444-444444444444',
      projectId: PROJECT,
      fromStatusId: TODO,
      toStatusId: DOING,
    },
  ];

  /** The payload carries the whole workflow, so it is written, not refetched. */
  it('writes the new statuses and transitions straight into the cache', () => {
    applyWorkflowChanged(queryClient, { projectId: PROJECT, statuses, transitions });

    expect(queryClient.getQueryData(qk.project.statuses(PROJECT))).toEqual(statuses);
    expect(queryClient.getQueryData(qk.project.transitions(PROJECT))).toEqual(transitions);
  });

  it('still invalidates the project detail, which embeds its own copy', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applyWorkflowChanged(queryClient, { projectId: PROJECT, statuses, transitions });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.project.detail(PROJECT) });
  });
});

describe('notification:new', () => {
  const RECIPIENT = '66666666-6666-4666-8666-666666666666';

  function notification(id: string): Notification {
    return {
      id,
      recipientId: RECIPIENT,
      type: 'mentioned',
      payload: {},
      readAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
  }

  /** The shape `useNotifications` stores: an infinite query of meta'd pages. */
  function seedList(unreadOnly: boolean, items: Notification[]): void {
    queryClient.setQueryData<InfiniteData<NotificationPage, number>>(
      [...qk.notifications.list(unreadOnly), 'paged', 20],
      {
        pageParams: [1],
        pages: [{ items, meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1 } }],
      },
    );
  }

  function listItems(unreadOnly: boolean): Notification[] {
    return (
      queryClient.getQueryData<InfiniteData<NotificationPage, number>>([
        ...qk.notifications.list(unreadOnly),
        'paged',
        20,
      ])?.pages[0]?.items ?? []
    );
  }

  /** The badge is the number the user is watching — it is never refetched. */
  it('writes the unread count straight from the payload', () => {
    applyNotificationNew(queryClient, { notification: notification('a'), unreadCount: 3 });

    expect(queryClient.getQueryData(qk.notifications.unreadCount())).toBe(3);
  });

  it('prepends the row to every list cache that exists', () => {
    seedList(false, [notification('old')]);
    seedList(true, [notification('old')]);

    applyNotificationNew(queryClient, { notification: notification('new'), unreadCount: 2 });

    expect(listItems(false).map((item) => item.id)).toEqual(['new', 'old']);
    expect(listItems(true).map((item) => item.id)).toEqual(['new', 'old']);
  });

  /**
   * A reconnect can replay a push the list already holds. A duplicated row in a
   * notification centre is a support ticket, so the splice is keyed by id — and
   * it must return the SAME reference, or every subscriber re-renders for a
   * change that did not happen.
   */
  it('is idempotent: a replayed push neither duplicates nor re-renders', () => {
    const key = [...qk.notifications.list(false), 'paged', 20];
    seedList(false, [notification('dup')]);
    const before = queryClient.getQueryData(key);

    applyNotificationNew(queryClient, { notification: notification('dup'), unreadCount: 1 });

    expect(listItems(false).map((item) => item.id)).toEqual(['dup']);
    // Reference identity, not deep equality: TanStack decides "did this change?"
    // by reference, so a fresh-but-equal object is a re-render of every bell on
    // screen for a push that changed nothing.
    expect(queryClient.getQueryData(key)).toBe(before);
  });

  /**
   * A list nobody has opened has no cache entry, and SEEDING one here would
   * hand the next `useInfiniteQuery` a one-row page with fabricated `meta` —
   * a "Load more" that computes its next page from a total of one.
   */
  it('does not invent a list cache that was never fetched', () => {
    applyNotificationNew(queryClient, { notification: notification('a'), unreadCount: 1 });

    expect(
      queryClient.getQueryData([...qk.notifications.list(false), 'paged', 20]),
    ).toBeUndefined();
  });

  /** The safety net: everything reconciles on next focus, nothing refetches now. */
  it('marks the whole prefix stale without firing a request', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    applyNotificationNew(queryClient, { notification: notification('a'), unreadCount: 1 });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: qk.notifications.all(),
      refetchType: 'none',
    });
  });
});

describe('the debounced project refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses a burst into a single invalidation', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    for (let index = 0; index < 20; index += 1) scheduleProjectRefresh(queryClient, PROJECT);
    vi.advanceTimersByTime(PROJECT_REFRESH_DEBOUNCE_MS + 10);

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.project.all(PROJECT) });
  });

  it('keeps two projects independent', () => {
    const other = '99999999-9999-4999-8999-999999999999';
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    scheduleProjectRefresh(queryClient, PROJECT);
    scheduleProjectRefresh(queryClient, other);
    vi.advanceTimersByTime(PROJECT_REFRESH_DEBOUNCE_MS + 10);

    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending refresh', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    scheduleProjectRefresh(queryClient, PROJECT);
    cancelProjectRefresh(PROJECT);
    vi.advanceTimersByTime(PROJECT_REFRESH_DEBOUNCE_MS + 10);

    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('the handler table', () => {
  /**
   * Typed as the shared `ServerToClientEvents` map, so an event added to the
   * contract and forgotten here is a compile error. This asserts the runtime
   * half: every server→client event except `presence:state` (which belongs to
   * the presence store, not the query cache) has a handler.
   */
  it('covers every server event except presence:state', () => {
    const handlers = createRealtimeCacheHandlers(queryClient);

    expect(Object.keys(handlers).sort()).toEqual([
      'comment:created',
      'comment:deleted',
      'comment:updated',
      'notification:new',
      'sprint:changed',
      'task:created',
      'task:deleted',
      'task:moved',
      'task:updated',
      'workflow:changed',
    ]);
  });

  it('routes an event through to the cache', () => {
    createRealtimeCacheHandlers(queryClient)['task:moved']({
      projectId: PROJECT,
      taskId: TASK_A,
      statusId: DOING,
      boardRank: 'a9',
      rebalanced: false,
      updatedAt: MOVED_AT,
    });

    expect(board().columns[DOING]?.map((task) => task.id)).toEqual([TASK_A]);
  });

  /**
   * EVERY entry is wired, not just the one above.
   *
   * The keys-match test proves the table is complete; this proves each entry
   * calls the writer it names. A handler bound to the wrong `apply…` would pass
   * the first test and silently corrupt one event type forever — and the
   * mistake is easy to make, because ten near-identical one-line arrows sit in
   * one object literal.
   */
  describe('every entry actually reaches its writer', () => {
    const COMMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const SPRINT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

    function comment() {
      return {
        id: COMMENT_ID,
        taskId: TASK_A,
        author: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Ada', avatarUrl: null },
        body: 'Nice',
        editedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
    }

    it('task:created splices a new card into its column', () => {
      const fresh = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

      createRealtimeCacheHandlers(queryClient)['task:created']({
        projectId: PROJECT,
        task: summary(fresh, { statusId: DOING, boardRank: 'a1' }),
      });

      expect(board().columns[DOING]?.map((task) => task.id)).toEqual([fresh]);
    });

    it('task:updated replaces the card in place', () => {
      createRealtimeCacheHandlers(queryClient)['task:updated']({
        projectId: PROJECT,
        task: summary(TASK_A, { title: 'Renamed remotely', boardRank: 'a1' }),
        changedFields: ['title'],
      });

      expect(board().columns[TODO]?.[0]?.title).toBe('Renamed remotely');
    });

    it('task:deleted drops the card', () => {
      createRealtimeCacheHandlers(queryClient)['task:deleted']({
        projectId: PROJECT,
        taskId: TASK_A,
      });

      expect(board().columns[TODO]?.map((task) => task.id)).toEqual([TASK_B]);
    });

    it('comment:created bumps the badge', () => {
      createRealtimeCacheHandlers(queryClient)['comment:created']({
        projectId: PROJECT,
        taskId: TASK_A,
        comment: comment(),
      });

      expect(board().columns[TODO]?.[0]?.commentCount).toBe(1);
    });

    it('comment:updated invalidates the thread without touching the badge', () => {
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      createRealtimeCacheHandlers(queryClient)['comment:updated']({
        projectId: PROJECT,
        taskId: TASK_A,
        comment: { ...comment(), body: 'Edited', editedAt: '2026-01-02T00:00:00.000Z' },
      });

      expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.task.comments(TASK_A) });
      expect(board().columns[TODO]?.[0]?.commentCount).toBe(0);
    });

    it('comment:deleted decrements the badge, floored at zero', () => {
      const handlers = createRealtimeCacheHandlers(queryClient);
      handlers['comment:created']({ projectId: PROJECT, taskId: TASK_A, comment: comment() });

      handlers['comment:deleted']({ projectId: PROJECT, taskId: TASK_A, commentId: COMMENT_ID });
      handlers['comment:deleted']({ projectId: PROJECT, taskId: TASK_A, commentId: COMMENT_ID });

      expect(board().columns[TODO]?.[0]?.commentCount).toBe(0);
    });

    it('sprint:changed invalidates the sprint list', () => {
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      createRealtimeCacheHandlers(queryClient)['sprint:changed']({
        projectId: PROJECT,
        sprintId: SPRINT_ID,
        action: 'started',
        sprint: null,
      });

      expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.sprints.all(PROJECT) });
    });

    it('workflow:changed writes the statuses straight into the cache', () => {
      const statuses: Status[] = [
        {
          id: TODO,
          projectId: PROJECT,
          name: 'To Do',
          category: 'todo',
          color: '#64748b',
          position: 0,
          wipLimit: null,
        },
      ];

      createRealtimeCacheHandlers(queryClient)['workflow:changed']({
        projectId: PROJECT,
        statuses,
        transitions: [],
      });

      expect(queryClient.getQueryData(qk.project.statuses(PROJECT))).toEqual(statuses);
    });

    it('notification:new writes the unread count', () => {
      createRealtimeCacheHandlers(queryClient)['notification:new']({
        notification: {
          id: 'a1b2c3d4-a1b2-4c3d-8e4f-a1b2c3d4e5f6',
          recipientId: '66666666-6666-4666-8666-666666666666',
          type: 'mentioned',
          payload: {},
          readAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        unreadCount: 7,
      });

      expect(queryClient.getQueryData(qk.notifications.unreadCount())).toBe(7);
    });
  });

  /**
   * A cache that does not hold the task at all.
   *
   * Every writer above is a SPLICE, and a splice into a collection that never
   * held the row would insert it — putting a card the user filtered out back on
   * their screen. Each one must leave an untouched cache untouched.
   */
  describe('caches that do not hold the task', () => {
    const OTHER_PROJECT = '99999999-9999-4999-8999-999999999999';
    const STRANGER = '77777777-7777-4777-8777-777777777777';

    it('leaves another project s board alone for every task event', () => {
      const otherBoard: BoardResponse = { columns: { [TODO]: [] } };
      queryClient.setQueryData(qk.tasks.board(OTHER_PROJECT), otherBoard);
      const handlers = createRealtimeCacheHandlers(queryClient);

      handlers['task:created']({ projectId: PROJECT, task: summary(STRANGER) });
      handlers['task:updated']({ projectId: PROJECT, task: summary(TASK_A) });
      handlers['task:moved']({
        projectId: PROJECT,
        taskId: TASK_A,
        statusId: DOING,
        boardRank: 'a9',
        rebalanced: false,
        updatedAt: MOVED_AT,
      });
      handlers['task:deleted']({ projectId: PROJECT, taskId: TASK_A });

      expect(queryClient.getQueryData<BoardResponse>(qk.tasks.board(OTHER_PROJECT))).toEqual(
        otherBoard,
      );
    });

    it('does not insert an unknown card into a filtered flat list', () => {
      // The list holds TASK_A only; a remote update about TASK_B must not put
      // TASK_B on a page the filter excluded it from.
      createRealtimeCacheHandlers(queryClient)['task:updated']({
        projectId: PROJECT,
        task: summary(TASK_B, { title: 'Not mine' }),
        changedFields: ['title'],
      });

      expect(flatList().map((task) => task.id)).toEqual([TASK_A]);
    });

    it('is a no-op for comment events about a task no cache holds', () => {
      const before = board();

      createRealtimeCacheHandlers(queryClient)['comment:created']({
        projectId: PROJECT,
        taskId: STRANGER,
        comment: {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          taskId: STRANGER,
          author: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Ada', avatarUrl: null },
          body: 'Nice',
          editedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      });

      expect(board()).toEqual(before);
    });
  });
});
