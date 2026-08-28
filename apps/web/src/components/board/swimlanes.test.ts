import { describe, expect, it } from 'vitest';
import type { BoardResponse, TaskSummary } from '@flowboard/shared';

import {
  ALL_LANE,
  NO_LANE,
  groupIntoSwimlanes,
  laneCellCount,
  laneIndexToColumnIndex,
  laneKeyOf,
} from '@/components/board/swimlanes';

/**
 * Swimlane grouping and — the part that can genuinely be WRONG — the
 * lane-index → column-index translation the drop contract depends on.
 */

const STATUS_IDS = ['todo', 'doing', 'done'];

function task(overrides: Partial<TaskSummary> & { id: string }): TaskSummary {
  return {
    number: 1,
    title: 'A task',
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
    boardRank: 'a0',
    backlogRank: 'a0',
    sprintId: null,
    hasDescription: false,
    commentCount: 0,
    attachmentCount: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ada = { id: 'user-ada', name: 'Ada Lovelace', avatarUrl: null };
const bob = { id: 'user-bob', name: 'Bob Fossil', avatarUrl: null };

describe('laneKeyOf', () => {
  it('falls back to the `none` bucket for an unset grouping field', () => {
    expect(laneKeyOf(task({ id: '1' }), 'assignee')).toBe(NO_LANE);
    expect(laneKeyOf(task({ id: '1' }), 'epic')).toBe(NO_LANE);
  });

  it('never produces a `none` bucket for priority, which is always set', () => {
    expect(laneKeyOf(task({ id: '1', priority: 'high' }), 'priority')).toBe('high');
  });

  it('collapses every card into one lane when grouping is off', () => {
    expect(laneKeyOf(task({ id: '1', assignee: ada }), 'none')).toBe(ALL_LANE);
  });
});

describe('groupIntoSwimlanes', () => {
  const board: BoardResponse = {
    columns: {
      todo: [
        task({ id: 'a', assignee: bob, priority: 'low' }),
        task({ id: 'b', assignee: ada, priority: 'highest' }),
      ],
      doing: [task({ id: 'c', statusId: 'doing', assignee: null, priority: 'high' })],
      done: [],
    },
  };

  it('keeps every workflow column present in every lane, even the empty ones', () => {
    const [lane] = groupIntoSwimlanes(board, STATUS_IDS, 'none');
    expect(Object.keys(lane?.columns ?? {})).toEqual(STATUS_IDS);
    expect(lane?.count).toBe(3);
  });

  it('orders assignee lanes by first appearance, with `unassigned` last', () => {
    const lanes = groupIntoSwimlanes(board, STATUS_IDS, 'assignee');
    expect(lanes.map((lane) => lane.id)).toEqual([bob.id, ada.id, NO_LANE]);
  });

  it('orders priority lanes by the scale, not by appearance', () => {
    const lanes = groupIntoSwimlanes(board, STATUS_IDS, 'priority');
    // `low` appears first on the board; the scale still puts it last.
    expect(lanes.map((lane) => lane.id)).toEqual(['highest', 'high', 'low']);
  });

  it('emits no lane for a grouping value nothing on the board carries', () => {
    const lanes = groupIntoSwimlanes(board, STATUS_IDS, 'priority');
    expect(lanes.map((lane) => lane.id)).not.toContain('medium');
  });

  it('keeps each column’s own order inside a lane', () => {
    const board2: BoardResponse = {
      columns: {
        todo: [
          task({ id: 'first', assignee: ada }),
          task({ id: 'other', assignee: bob }),
          task({ id: 'second', assignee: ada }),
        ],
        doing: [],
        done: [],
      },
    };
    const [adaLane] = groupIntoSwimlanes(board2, STATUS_IDS, 'assignee');
    expect(adaLane?.columns.todo?.map((entry) => entry.id)).toEqual(['first', 'second']);
  });
});

describe('laneIndexToColumnIndex', () => {
  // A column of five, alternating between two lanes:
  //   0 ada · 1 bob · 2 ada · 3 bob · 4 ada
  const column: TaskSummary[] = [
    task({ id: '0', assignee: ada }),
    task({ id: '1', assignee: bob }),
    task({ id: '2', assignee: ada }),
    task({ id: '3', assignee: bob }),
    task({ id: '4', assignee: ada }),
  ];

  it('passes the index straight through when grouping is off', () => {
    expect(laneIndexToColumnIndex(column, 'none', ALL_LANE, 3)).toBe(3);
  });

  it('clamps an out-of-range index when grouping is off', () => {
    expect(laneIndexToColumnIndex(column, 'none', ALL_LANE, 99)).toBe(5);
    expect(laneIndexToColumnIndex(column, 'none', ALL_LANE, -2)).toBe(0);
  });

  it('maps "first in the lane" to that member’s position in the column', () => {
    expect(laneIndexToColumnIndex(column, 'assignee', bob.id, 0)).toBe(1);
  });

  it('maps a middle lane index to the position of the member it lands before', () => {
    // Ada's members sit at 0, 2, 4 — her lane index 1 is column index 2.
    expect(laneIndexToColumnIndex(column, 'assignee', ada.id, 1)).toBe(2);
  });

  it('appends after the lane’s LAST member, not at the column’s end', () => {
    // Bob's last member is at 3, so appending to his lane is column index 4 —
    // which puts the card before Ada's card at 4 in rank terms and still
    // renders at the bottom of Bob's cell.
    expect(laneIndexToColumnIndex(column, 'assignee', bob.id, 2)).toBe(4);
  });

  it('falls back to the end of the column for a lane with no members here', () => {
    expect(laneIndexToColumnIndex(column, 'assignee', 'user-nobody', 0)).toBe(5);
  });

  it('handles an empty column', () => {
    expect(laneIndexToColumnIndex([], 'assignee', ada.id, 0)).toBe(0);
  });
});

describe('laneCellCount', () => {
  const column = [
    task({ id: '0', assignee: ada }),
    task({ id: '1', assignee: bob }),
    task({ id: '2', assignee: ada }),
  ];

  it('counts only the lane’s own members', () => {
    expect(laneCellCount(column, 'assignee', ada.id)).toBe(2);
  });

  it('lifts the dragged card out before counting', () => {
    expect(laneCellCount(column, 'assignee', ada.id, '0')).toBe(1);
  });

  it('counts the whole column when grouping is off', () => {
    expect(laneCellCount(column, 'none', ALL_LANE)).toBe(3);
  });
});
