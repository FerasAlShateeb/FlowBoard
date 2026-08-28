import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '@flowboard/shared';

import {
  asDragData,
  containerId,
  isAfterOverCentre,
  planDrop,
  resolveDropTarget,
  type BoardDragCard,
} from '@/components/board/dnd';
import { ALL_LANE } from '@/components/board/swimlanes';

/**
 * The drag algebra: which container, which index, and what intent that becomes.
 *
 * Everything here runs without a DOM, a pointer or dnd-kit — the events are
 * reduced to the three facts the arithmetic actually needs (what was dragged,
 * what it was over, and which side of that thing the pointer was on), which is
 * the whole reason `dnd.ts` exists as a separate module.
 */

function task(id: string, statusId = 'todo'): TaskSummary {
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
    boardRank: `a${id}`,
    backlogRank: `a${id}`,
    sprintId: null,
    hasDescription: false,
    commentCount: 0,
    attachmentCount: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const card = (taskId: string, statusId: string, laneId = ALL_LANE): BoardDragCard => ({
  type: 'card',
  taskId,
  statusId,
  laneId,
});

describe('containerId / asDragData', () => {
  it('composes a droppable id per (column × lane) cell', () => {
    expect(containerId('todo', ALL_LANE)).toBe('container:todo:*');
    expect(containerId('todo', 'user-a')).not.toBe(containerId('todo', 'user-b'));
  });

  it('rejects anything that is not one of our two payload shapes', () => {
    expect(asDragData(undefined)).toBeNull();
    expect(asDragData({ type: 'card' })).toBeNull();
    expect(asDragData({ type: 'something-else', statusId: 'todo' })).toBeNull();
  });

  it('accepts a well-formed card and container payload', () => {
    expect(asDragData(card('t1', 'todo'))).not.toBeNull();
    expect(asDragData({ type: 'container', statusId: 'todo', laneId: '*' })).not.toBeNull();
  });
});

describe('isAfterOverCentre', () => {
  it('is true only once the dragged card’s centre passes the other card’s', () => {
    expect(isAfterOverCentre({ top: 100, height: 40 }, { top: 100, height: 40 })).toBe(false);
    expect(isAfterOverCentre({ top: 130, height: 40 }, { top: 100, height: 40 })).toBe(true);
  });

  it('is false when either rectangle is unknown', () => {
    expect(isAfterOverCentre(null, { top: 0, height: 10 })).toBe(false);
    expect(isAfterOverCentre({ top: 0, height: 10 }, undefined)).toBe(false);
  });
});

describe('resolveDropTarget', () => {
  const items = ['a', 'b', 'c'];

  it('drops at the end when released on the container itself', () => {
    const target = resolveDropTarget({
      active: card('z', 'doing'),
      over: { type: 'container', statusId: 'todo', laneId: ALL_LANE },
      overItems: items,
      ownLaneCount: 3,
      after: false,
    });
    expect(target).toEqual({ toStatusId: 'todo', laneId: ALL_LANE, laneIndex: 3 });
  });

  it('lifts the dragged card out before measuring the end of its own container', () => {
    const target = resolveDropTarget({
      active: card('b', 'todo'),
      over: { type: 'container', statusId: 'todo', laneId: ALL_LANE },
      overItems: items,
      ownLaneCount: 2,
      after: false,
    });
    // Three items minus the one in the air.
    expect(target.laneIndex).toBe(2);
  });

  it('uses the over card’s index directly for a same-column reorder', () => {
    // `arrayMove(items, from, to)` re-inserts at `to` in the LIFTED list, which
    // is exactly the index the sortable strategy previewed.
    expect(
      resolveDropTarget({
        active: card('a', 'todo'),
        over: card('c', 'todo'),
        overItems: items,
        ownLaneCount: 2,
        after: true,
      }).laneIndex,
    ).toBe(2);
  });

  it('inserts before or after the over card for a cross-column drop', () => {
    const base = {
      active: card('z', 'doing'),
      over: card('b', 'todo'),
      overItems: items,
      ownLaneCount: 3,
    };
    expect(resolveDropTarget({ ...base, after: false }).laneIndex).toBe(1);
    expect(resolveDropTarget({ ...base, after: true }).laneIndex).toBe(2);
  });

  it('lands at the end of the card’s OWN lane when released on a foreign one', () => {
    // A board move writes `statusId` and the rank and nothing else, so a card
    // cannot change lane by being dropped on one.
    const target = resolveDropTarget({
      active: card('z', 'doing', 'user-ada'),
      over: card('b', 'todo', 'user-bob'),
      overItems: items,
      ownLaneCount: 4,
      after: true,
    });
    expect(target).toEqual({ toStatusId: 'todo', laneId: 'user-ada', laneIndex: 4 });
  });

  it('appends when the over card is not in the list it was given', () => {
    expect(
      resolveDropTarget({
        active: card('z', 'doing'),
        over: card('gone', 'todo'),
        overItems: items,
        ownLaneCount: 3,
        after: false,
      }).laneIndex,
    ).toBe(3);
  });
});

describe('planDrop', () => {
  const column = [task('a'), task('b'), task('c')];

  it('produces the column-relative intent `move()` takes', () => {
    const intent = planDrop({
      active: card('z', 'doing'),
      over: card('b', 'todo'),
      overItems: ['a', 'b', 'c'],
      columnTasks: column,
      mode: 'none',
      after: false,
    });

    expect(intent).toEqual({
      taskId: 'z',
      fromStatusId: 'doing',
      toStatusId: 'todo',
      toIndex: 1,
    });
  });

  it('returns null when nothing was under the pointer', () => {
    expect(
      planDrop({
        active: card('a', 'todo'),
        over: null,
        overItems: [],
        columnTasks: column,
        mode: 'none',
        after: false,
      }),
    ).toBeNull();
  });

  it('returns null for a same-column drop that moves nothing', () => {
    // `b` sits at index 1 and is released on itself: no rank changes, so no
    // request is worth firing.
    expect(
      planDrop({
        active: card('b', 'todo'),
        over: card('b', 'todo'),
        overItems: ['a', 'b', 'c'],
        columnTasks: column,
        mode: 'none',
        after: false,
      }),
    ).toBeNull();
  });

  it('still fires for a same-column drop that DOES move the card', () => {
    const intent = planDrop({
      active: card('c', 'todo'),
      over: card('a', 'todo'),
      overItems: ['a', 'b', 'c'],
      columnTasks: column,
      mode: 'none',
      after: false,
    });
    expect(intent?.toIndex).toBe(0);
  });

  it('translates a lane index into a column index when swimlanes are on', () => {
    const ada = { id: 'user-ada', name: 'Ada', avatarUrl: null };
    const bob = { id: 'user-bob', name: 'Bob', avatarUrl: null };
    const laneColumn: TaskSummary[] = [
      { ...task('a'), assignee: ada },
      { ...task('b'), assignee: bob },
      { ...task('c'), assignee: ada },
    ];

    const intent = planDrop({
      active: card('z', 'doing', 'user-ada'),
      // Dropped before Ada's SECOND card, which is lane index 1 …
      over: card('c', 'todo', 'user-ada'),
      overItems: ['a', 'c'],
      columnTasks: laneColumn,
      mode: 'assignee',
      after: false,
    });

    // … and column index 2, because Bob's card sits between them.
    expect(intent?.toIndex).toBe(2);
  });
});
