import { describe, expect, it } from 'vitest';
import type { StatusCategory, TaskSummary, TaskType } from '@flowboard/shared';

import {
  NO_EPIC_GROUP_ID,
  buildGanttRows,
  epicSpan,
  rollUpSpan,
  rowIndexById,
  rowSpan,
  spanOf,
  type GanttRow,
} from '@/components/gantt/gantt-rows';

/** Status ids used by the fixtures, one per category. */
const TODO = '00000000-0000-0000-0000-0000000000t0';
const DOING = '00000000-0000-0000-0000-0000000000d1';
const DONE = '00000000-0000-0000-0000-0000000000d2';

const CATEGORIES = new Map<string, StatusCategory>([
  [TODO, 'todo'],
  [DOING, 'in_progress'],
  [DONE, 'done'],
]);

let sequence = 0;

/** A `TaskSummary` with only the fields the row model reads spelled out. */
function task(overrides: Partial<TaskSummary> & { id: string }): TaskSummary {
  sequence += 1;
  return {
    number: sequence,
    title: overrides.id,
    type: 'task' as TaskType,
    priority: 'medium',
    statusId: TODO,
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
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function build(tasks: TaskSummary[], collapsed: string[] = []): GanttRow[] {
  return buildGanttRows({
    tasks,
    categoryByStatusId: CATEGORIES,
    collapsed: new Set(collapsed),
  });
}

describe('spanOf', () => {
  it('normalises a single-dated task to a one-day span', () => {
    expect(spanOf({ startDate: '2026-03-04', dueDate: null })).toEqual({
      startDate: '2026-03-04',
      dueDate: '2026-03-04',
    });
    expect(spanOf({ startDate: null, dueDate: '2026-03-09' })).toEqual({
      startDate: '2026-03-09',
      dueDate: '2026-03-09',
    });
  });

  it('is null for an undated task', () => {
    expect(spanOf({ startDate: null, dueDate: null })).toBeNull();
  });

  it('collapses inverted dates the same way `barRect` draws them', () => {
    expect(spanOf({ startDate: '2026-03-10', dueDate: '2026-03-02' })).toEqual({
      startDate: '2026-03-10',
      dueDate: '2026-03-10',
    });
  });
});

describe('rollUpSpan', () => {
  it('takes the min start and the max end', () => {
    expect(
      rollUpSpan([
        { startDate: '2026-03-10', dueDate: '2026-03-12' },
        { startDate: '2026-03-04', dueDate: '2026-03-06' },
        { startDate: '2026-03-20', dueDate: '2026-03-21' },
      ]),
    ).toEqual({ startDate: '2026-03-04', dueDate: '2026-03-21' });
  });

  it('ignores undated members but keeps single-dated ones', () => {
    expect(
      rollUpSpan([
        null,
        spanOf({ startDate: null, dueDate: '2026-03-30' }),
        { startDate: '2026-03-10', dueDate: '2026-03-12' },
        null,
      ]),
    ).toEqual({ startDate: '2026-03-10', dueDate: '2026-03-30' });
  });

  it('is null when nothing is dated', () => {
    expect(rollUpSpan([])).toBeNull();
    expect(rollUpSpan([null, null])).toBeNull();
  });

  it('does not let a long child shorten the roll-up', () => {
    // The widest member wins at BOTH ends independently — the max end may come
    // from a different child than the min start.
    expect(
      rollUpSpan([
        { startDate: '2026-01-01', dueDate: '2026-01-02' },
        { startDate: '2026-06-01', dueDate: '2026-12-31' },
      ]),
    ).toEqual({ startDate: '2026-01-01', dueDate: '2026-12-31' });
  });
});

describe('epicSpan', () => {
  it('prefers the epic’s OWN dates over the roll-up', () => {
    const result = epicSpan({ startDate: '2026-01-01', dueDate: '2026-12-31' }, [
      { startDate: '2026-03-01', dueDate: '2026-03-05' },
    ]);
    expect(result.rolledUp).toBe(false);
    expect(result.span).toEqual({ startDate: '2026-01-01', dueDate: '2026-12-31' });
  });

  it('rolls up from the children when the epic has no dates', () => {
    const result = epicSpan({ startDate: null, dueDate: null }, [
      { startDate: '2026-03-01', dueDate: '2026-03-05' },
      { startDate: '2026-02-20', dueDate: null },
    ]);
    expect(result.rolledUp).toBe(true);
    expect(result.span).toEqual({ startDate: '2026-02-20', dueDate: '2026-03-05' });
  });

  it('is null and rolled-up for an undated epic with undated children', () => {
    const result = epicSpan({ startDate: null, dueDate: null }, [
      { startDate: null, dueDate: null },
    ]);
    expect(result.rolledUp).toBe(true);
    expect(result.span).toBeNull();
  });
});

describe('buildGanttRows', () => {
  it('nests an epic’s children under it and files the rest into "No epic"', () => {
    const epic = task({ id: 'epic', type: 'epic', startDate: '2026-03-01', dueDate: '2026-03-31' });
    const child = task({
      id: 'child',
      epicId: 'epic',
      startDate: '2026-03-02',
      dueDate: '2026-03-04',
    });
    const loose = task({ id: 'loose', startDate: '2026-03-05', dueDate: '2026-03-06' });

    const rows = build([epic, child, loose]);

    expect(rows.map((row) => row.id)).toEqual(['epic', 'child', NO_EPIC_GROUP_ID, 'loose']);
    expect(rows[1]?.kind === 'task' && rows[1].depth).toBe(1);
    expect(rows[3]?.kind === 'task' && rows[3].depth).toBe(0);
  });

  it('excludes subtasks from the rows and counts them on the parent', () => {
    const parent = task({ id: 'parent', startDate: '2026-03-01', dueDate: '2026-03-10' });
    const rows = build([
      parent,
      task({ id: 'sub-a', type: 'subtask', parentId: 'parent' }),
      task({ id: 'sub-b', type: 'subtask', parentId: 'parent' }),
    ]);

    expect(rows.map((row) => row.id)).toEqual([NO_EPIC_GROUP_ID, 'parent']);
    expect(rows[1]?.kind === 'task' && rows[1].subtaskCount).toBe(2);
  });

  it('rolls a child’s subtasks up into the epic’s count too', () => {
    const rows = build([
      task({ id: 'epic', type: 'epic' }),
      task({ id: 'child', epicId: 'epic' }),
      task({ id: 'sub', type: 'subtask', parentId: 'child' }),
    ]);
    const epicRow = rows.find((row) => row.id === 'epic');
    expect(epicRow?.kind === 'epic' && epicRow.subtaskCount).toBe(1);
  });

  it('counts done children for the progress overlay', () => {
    const rows = build([
      task({ id: 'epic', type: 'epic' }),
      task({ id: 'a', epicId: 'epic', statusId: DONE }),
      task({ id: 'b', epicId: 'epic', statusId: DONE }),
      task({ id: 'c', epicId: 'epic', statusId: DOING }),
    ]);
    const epicRow = rows.find((row) => row.id === 'epic');
    expect(epicRow?.kind === 'epic' && epicRow.childCount).toBe(3);
    expect(epicRow?.kind === 'epic' && epicRow.doneCount).toBe(2);
  });

  it('derives an undated epic’s bar from its children', () => {
    const rows = build([
      task({ id: 'epic', type: 'epic' }),
      task({ id: 'a', epicId: 'epic', startDate: '2026-03-10', dueDate: '2026-03-12' }),
      task({ id: 'b', epicId: 'epic', startDate: '2026-02-01', dueDate: '2026-02-03' }),
    ]);
    const epicRow = rows[0];
    expect(epicRow?.kind === 'epic' && epicRow.rolledUp).toBe(true);
    expect(rowSpan(epicRow as GanttRow)).toEqual({
      startDate: '2026-02-01',
      dueDate: '2026-03-12',
    });
  });

  it('hides an epic’s children when it is collapsed, keeping the epic', () => {
    const tasks = [
      task({ id: 'epic', type: 'epic', startDate: '2026-03-01', dueDate: '2026-03-31' }),
      task({ id: 'child', epicId: 'epic' }),
    ];
    expect(build(tasks).map((row) => row.id)).toEqual(['epic', 'child']);
    expect(build(tasks, ['epic']).map((row) => row.id)).toEqual(['epic']);
  });

  it('collapses the "No epic" group too', () => {
    const rows = build([task({ id: 'loose' })], [NO_EPIC_GROUP_ID]);
    expect(rows.map((row) => row.id)).toEqual([NO_EPIC_GROUP_ID]);
    expect(rows[0]?.kind === 'group' && rows[0].childCount).toBe(1);
  });

  it('files an ORPHAN — a task whose epic is not in the list — rather than dropping it', () => {
    const rows = build([task({ id: 'orphan', epicId: 'missing-epic' })]);
    expect(rows.map((row) => row.id)).toEqual([NO_EPIC_GROUP_ID, 'orphan']);
  });

  it('omits the "No epic" header when every task belongs to an epic', () => {
    const rows = build([task({ id: 'epic', type: 'epic' }), task({ id: 'child', epicId: 'epic' })]);
    expect(rows.some((row) => row.kind === 'group')).toBe(false);
  });

  it('orders chronologically, with undated rows last', () => {
    const rows = build([
      task({ id: 'late', startDate: '2026-05-01', dueDate: '2026-05-02' }),
      task({ id: 'undated' }),
      task({ id: 'early', startDate: '2026-01-01', dueDate: '2026-01-02' }),
    ]);
    expect(rows.map((row) => row.id)).toEqual([NO_EPIC_GROUP_ID, 'early', 'late', 'undated']);
  });

  it('orders epics by their rolled-up start', () => {
    const rows = build([
      task({ id: 'epic-late', type: 'epic' }),
      task({ id: 'l1', epicId: 'epic-late', startDate: '2026-08-01', dueDate: '2026-08-02' }),
      task({ id: 'epic-early', type: 'epic' }),
      task({ id: 'e1', epicId: 'epic-early', startDate: '2026-02-01', dueDate: '2026-02-02' }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['epic-early', 'e1', 'epic-late', 'l1']);
  });

  it('indexes only real tasks, never the group header', () => {
    const rows = build([task({ id: 'epic', type: 'epic' }), task({ id: 'loose' })]);
    const index = rowIndexById(rows);
    expect(index.get('epic')).toBe(0);
    expect(index.get('loose')).toBe(2);
    expect(index.has(NO_EPIC_GROUP_ID)).toBe(false);
  });

  it('gives a group header no span', () => {
    const rows = build([task({ id: 'loose', startDate: '2026-03-01', dueDate: '2026-03-02' })]);
    expect(rowSpan(rows[0] as GanttRow)).toBeNull();
    expect(rowSpan(rows[1] as GanttRow)).toEqual({
      startDate: '2026-03-01',
      dueDate: '2026-03-02',
    });
  });
});
