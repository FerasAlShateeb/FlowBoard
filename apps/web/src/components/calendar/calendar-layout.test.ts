import { describe, expect, it } from 'vitest';

import { makeTask } from '@/components/calendar/calendar-test-fixtures';
import type { DayKey } from '@/components/calendar/calendar-dates';
import {
  hiddenCountsByColumn,
  hiddenTaskIdsForColumn,
  isOverdue,
  isUnscheduled,
  laneCount,
  layoutWeek,
  selectRangeTasks,
  selectUnscheduled,
  spanIntersects,
  spanLength,
  spanOfTask,
  visibleSegments,
  type CalendarSpan,
} from '@/components/calendar/calendar-layout';

/** The week every layout case is laid out on: Sun 2026-03-08 → Sat 2026-03-14. */
const WEEK: DayKey[] = [
  '2026-03-08',
  '2026-03-09',
  '2026-03-10',
  '2026-03-11',
  '2026-03-12',
  '2026-03-13',
  '2026-03-14',
];

function span(taskId: string, startKey: DayKey, endKey: DayKey): CalendarSpan {
  return { taskId, startKey, endKey, isMultiDay: startKey !== endKey };
}

describe('spanOfTask', () => {
  it('maps a due-date-only task to a single day', () => {
    const result = spanOfTask(makeTask({ id: 'a', dueDate: '2026-03-10' }));
    expect(result).toEqual({
      taskId: 'a',
      startKey: '2026-03-10',
      endKey: '2026-03-10',
      isMultiDay: false,
    });
  });

  it('maps a start+due task to the closed interval between them', () => {
    const result = spanOfTask(
      makeTask({ id: 'a', startDate: '2026-03-09', dueDate: '2026-03-12' }),
    );
    expect(result).toEqual({
      taskId: 'a',
      startKey: '2026-03-09',
      endKey: '2026-03-12',
      isMultiDay: true,
    });
    expect(spanLength(result as CalendarSpan)).toBe(4);
  });

  it('shows a start-only task on its start day', () => {
    expect(spanOfTask(makeTask({ id: 'a', startDate: '2026-03-09' }))?.endKey).toBe('2026-03-09');
  });

  it('collapses inverted dates onto the due day rather than drawing backwards', () => {
    const result = spanOfTask(
      makeTask({ id: 'a', startDate: '2026-03-12', dueDate: '2026-03-09' }),
    );
    expect(result).toEqual({
      taskId: 'a',
      startKey: '2026-03-09',
      endKey: '2026-03-09',
      isMultiDay: false,
    });
  });

  it('has no span for an undated task', () => {
    const task = makeTask({ id: 'a' });
    expect(spanOfTask(task)).toBeNull();
    expect(isUnscheduled(task)).toBe(true);
  });
});

describe('range intersection', () => {
  const range = { from: '2026-03-08', to: '2026-03-14' };

  it('includes a span that merely overlaps either end', () => {
    expect(spanIntersects(span('a', '2026-03-01', '2026-03-09'), range)).toBe(true);
    expect(spanIntersects(span('b', '2026-03-13', '2026-03-30'), range)).toBe(true);
  });

  it('includes a span that swallows the whole range', () => {
    expect(spanIntersects(span('a', '2026-01-01', '2026-12-31'), range)).toBe(true);
  });

  it('excludes spans entirely before or after', () => {
    expect(spanIntersects(span('a', '2026-03-01', '2026-03-07'), range)).toBe(false);
    expect(spanIntersects(span('b', '2026-03-15', '2026-03-20'), range)).toBe(false);
  });

  it('selects, dedupes and orders the tasks a grid should draw', () => {
    const inRange = makeTask({ id: 'due', number: 2, dueDate: '2026-03-10' });
    const spanning = makeTask({
      id: 'span',
      number: 1,
      startDate: '2026-03-01',
      dueDate: '2026-03-20',
    });
    const outside = makeTask({ id: 'far', dueDate: '2026-05-01' });
    const undated = makeTask({ id: 'none' });

    const result = selectRangeTasks(
      // `spanning` appears twice: the page merges two queries and both can hold
      // the same row.
      [inRange, spanning, outside, undated, spanning],
      { from: '2026-03-08', to: '2026-03-14' },
    );

    expect(result.tasks.map((task) => task.id)).toEqual(['span', 'due']);
    expect(result.spans.get('span')?.endKey).toBe('2026-03-20');
    expect(result.spans.has('far')).toBe(false);
  });

  it('collects the undated tasks in task-number order', () => {
    const tasks = [
      makeTask({ id: 'b', number: 9 }),
      makeTask({ id: 'a', number: 4 }),
      makeTask({ id: 'dated', number: 1, dueDate: '2026-03-10' }),
    ];
    expect(selectUnscheduled(tasks).map((task) => task.id)).toEqual(['a', 'b']);
  });
});

describe('layoutWeek', () => {
  it('keeps non-overlapping spans in the same lane', () => {
    const segments = layoutWeek(
      [span('a', '2026-03-08', '2026-03-09'), span('b', '2026-03-11', '2026-03-12')],
      WEEK,
    );
    expect(segments.map((segment) => segment.lane)).toEqual([0, 0]);
    expect(laneCount(segments)).toBe(1);
  });

  it('stacks overlapping spans into separate lanes', () => {
    const segments = layoutWeek(
      [
        span('long', '2026-03-08', '2026-03-13'),
        span('mid', '2026-03-09', '2026-03-10'),
        span('other', '2026-03-09', '2026-03-11'),
      ],
      WEEK,
    );
    const lanes = new Map(segments.map((segment) => [segment.taskId, segment.lane]));
    expect(lanes.get('long')).toBe(0);
    // Both overlap `long` and each other, so they take two further lanes.
    expect(new Set([lanes.get('mid'), lanes.get('other')])).toEqual(new Set([1, 2]));
    expect(laneCount(segments)).toBe(3);
  });

  it('reuses a lane once the span in it has ended', () => {
    const segments = layoutWeek(
      [
        span('a', '2026-03-08', '2026-03-09'),
        span('b', '2026-03-08', '2026-03-10'),
        span('c', '2026-03-11', '2026-03-14'),
      ],
      WEEK,
    );
    const lanes = new Map(segments.map((segment) => [segment.taskId, segment.lane]));
    expect(lanes.get('c')).toBe(0);
  });

  it('clips a span to the week and flags which ends are real', () => {
    const [segment] = layoutWeek([span('a', '2026-03-05', '2026-03-18')], WEEK);
    expect(segment).toEqual({
      taskId: 'a',
      lane: 0,
      columnStart: 0,
      columnSpan: 7,
      isStart: false,
      isEnd: false,
    });
  });

  it('rounds the leading edge only in the week the span starts in', () => {
    const [first] = layoutWeek([span('a', '2026-03-11', '2026-03-20')], WEEK);
    expect(first).toMatchObject({ columnStart: 3, columnSpan: 4, isStart: true, isEnd: false });

    const nextWeek: DayKey[] = [
      '2026-03-15',
      '2026-03-16',
      '2026-03-17',
      '2026-03-18',
      '2026-03-19',
      '2026-03-20',
      '2026-03-21',
    ];
    const [second] = layoutWeek([span('a', '2026-03-11', '2026-03-20')], nextWeek);
    expect(second).toMatchObject({ columnStart: 0, columnSpan: 6, isStart: false, isEnd: true });
  });

  it('drops spans that do not touch the week at all', () => {
    expect(layoutWeek([span('a', '2026-04-01', '2026-04-02')], WEEK)).toEqual([]);
    expect(layoutWeek([span('a', '2026-03-08', '2026-03-08')], [])).toEqual([]);
  });

  it('produces the same lanes whatever order the spans arrive in', () => {
    const spans = [
      span('a', '2026-03-08', '2026-03-12'),
      span('b', '2026-03-09', '2026-03-14'),
      span('c', '2026-03-10', '2026-03-10'),
    ];
    const forward = layoutWeek(spans, WEEK);
    const reversed = layoutWeek([...spans].reverse(), WEEK);
    expect(reversed).toEqual(forward);
  });
});

describe('the lane cap', () => {
  const segments = layoutWeek(
    [
      span('a', '2026-03-08', '2026-03-14'),
      span('b', '2026-03-08', '2026-03-14'),
      span('c', '2026-03-08', '2026-03-14'),
      span('d', '2026-03-09', '2026-03-10'),
      span('e', '2026-03-09', '2026-03-09'),
    ],
    WEEK,
  );

  it('shows only the lanes that fit', () => {
    expect(visibleSegments(segments, 3).map((segment) => segment.taskId)).toEqual(['a', 'b', 'c']);
  });

  it('counts what is hidden per day, not per task', () => {
    // `d` covers Mon+Tue, `e` covers Mon — so Monday hides two, Tuesday one.
    expect(hiddenCountsByColumn(segments, 7, 3)).toEqual([0, 2, 1, 0, 0, 0, 0]);
  });

  it('lists the hidden tasks of one day in lane order', () => {
    expect(hiddenTaskIdsForColumn(segments, 1, 3)).toEqual(['d', 'e']);
    expect(hiddenTaskIdsForColumn(segments, 0, 3)).toEqual([]);
  });
});

describe('isOverdue', () => {
  const today = '2026-03-10';

  it('is true for a past due date that is not done', () => {
    expect(isOverdue(makeTask({ id: 'a', dueDate: '2026-03-09' }), 'in_progress', today)).toBe(
      true,
    );
    expect(isOverdue(makeTask({ id: 'a', dueDate: '2026-03-09' }), 'todo', today)).toBe(true);
    expect(isOverdue(makeTask({ id: 'a', dueDate: '2026-03-09' }), undefined, today)).toBe(true);
  });

  it('is false once the task is done, however late', () => {
    expect(isOverdue(makeTask({ id: 'a', dueDate: '2026-01-01' }), 'done', today)).toBe(false);
  });

  it('is false today, in the future, and with no due date', () => {
    expect(isOverdue(makeTask({ id: 'a', dueDate: today }), 'todo', today)).toBe(false);
    expect(isOverdue(makeTask({ id: 'a', dueDate: '2026-03-11' }), 'todo', today)).toBe(false);
    expect(isOverdue(makeTask({ id: 'a', startDate: '2026-01-01' }), 'todo', today)).toBe(false);
  });
});
