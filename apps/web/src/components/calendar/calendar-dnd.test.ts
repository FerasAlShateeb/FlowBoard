import { describe, expect, it } from 'vitest';

import { makeTask } from '@/components/calendar/calendar-test-fixtures';
import {
  dayDroppableId,
  dragId,
  isArrowKey,
  nextChipIndex,
  readDragData,
  readDropData,
  reschedulePatch,
  resizePatch,
  scheduleTodayPatch,
} from '@/components/calendar/calendar-dnd';

describe('drag ids and payloads', () => {
  it('gives every gesture on one task a distinct id', () => {
    const ids = new Set([
      dragId('chip', 'task-1'),
      dragId('tray', 'task-1'),
      dragId('resize', 'task-1', 'start'),
      dragId('resize', 'task-1', 'end'),
    ]);
    expect(ids.size).toBe(4);
    expect(dayDroppableId('2026-03-08')).toBe('calendar-day:2026-03-08');
  });

  it('reads a well-formed drag payload and rejects everything else', () => {
    expect(readDragData({ kind: 'chip', taskId: 'a' })).toEqual({ kind: 'chip', taskId: 'a' });
    expect(readDragData({ kind: 'resize', taskId: 'a', edge: 'end' })).toEqual({
      kind: 'resize',
      taskId: 'a',
      edge: 'end',
    });
    expect(readDragData({ kind: 'resize', taskId: 'a' })).toBeNull();
    expect(readDragData({ kind: 'nonsense', taskId: 'a' })).toBeNull();
    expect(readDragData({ kind: 'chip' })).toBeNull();
    expect(readDragData(undefined)).toBeNull();
  });

  it('reads a drop target’s day', () => {
    expect(readDropData({ dayKey: '2026-03-08' })).toEqual({ dayKey: '2026-03-08' });
    expect(readDropData({})).toBeNull();
    expect(readDropData(null)).toBeNull();
  });
});

describe('reschedulePatch', () => {
  it('moves the due date of a single-date task', () => {
    const task = makeTask({ id: 'a', dueDate: '2026-03-10' });
    expect(reschedulePatch(task, '2026-03-12')).toEqual({ dueDate: '2026-03-12' });
  });

  it('shifts BOTH dates of a span, preserving its duration', () => {
    const task = makeTask({ id: 'a', startDate: '2026-03-09', dueDate: '2026-03-12' });
    expect(reschedulePatch(task, '2026-03-16')).toEqual({
      startDate: '2026-03-16',
      dueDate: '2026-03-19',
    });
  });

  it('preserves duration across a month boundary', () => {
    const task = makeTask({ id: 'a', startDate: '2026-03-30', dueDate: '2026-04-02' });
    expect(reschedulePatch(task, '2026-02-27')).toEqual({
      startDate: '2026-02-27',
      dueDate: '2026-03-02',
    });
  });

  it('moves a one-day span as a whole', () => {
    const task = makeTask({ id: 'a', startDate: '2026-03-10', dueDate: '2026-03-10' });
    expect(reschedulePatch(task, '2026-03-11')).toEqual({
      startDate: '2026-03-11',
      dueDate: '2026-03-11',
    });
  });

  it('schedules an undated task by giving it a due date only', () => {
    expect(reschedulePatch(makeTask({ id: 'a' }), '2026-03-11')).toEqual({
      dueDate: '2026-03-11',
    });
  });

  it('moves a start-only task without inventing a due date', () => {
    const task = makeTask({ id: 'a', startDate: '2026-03-09' });
    expect(reschedulePatch(task, '2026-03-11')).toEqual({ startDate: '2026-03-11' });
  });

  it('is null when the drop changes nothing', () => {
    expect(reschedulePatch(makeTask({ id: 'a', dueDate: '2026-03-10' }), '2026-03-10')).toBeNull();
    expect(
      reschedulePatch(
        makeTask({ id: 'a', startDate: '2026-03-09', dueDate: '2026-03-12' }),
        '2026-03-09',
      ),
    ).toBeNull();
  });

  it('backs the tray’s "schedule today" button with the same rules', () => {
    expect(scheduleTodayPatch(makeTask({ id: 'a' }), '2026-03-10')).toEqual({
      dueDate: '2026-03-10',
    });
  });
});

describe('resizePatch', () => {
  const span = makeTask({ id: 'a', startDate: '2026-03-09', dueDate: '2026-03-12' });

  it('moves one end and leaves the other alone', () => {
    expect(resizePatch(span, 'start', '2026-03-07')).toEqual({ startDate: '2026-03-07' });
    expect(resizePatch(span, 'end', '2026-03-15')).toEqual({ dueDate: '2026-03-15' });
  });

  it('clamps to a minimum length of one day instead of refusing', () => {
    expect(resizePatch(span, 'start', '2026-03-20')).toEqual({ startDate: '2026-03-12' });
    expect(resizePatch(span, 'end', '2026-03-01')).toEqual({ dueDate: '2026-03-09' });
  });

  it('creates the missing date when a single-date task is stretched', () => {
    const dueOnly = makeTask({ id: 'a', dueDate: '2026-03-12' });
    expect(resizePatch(dueOnly, 'start', '2026-03-09')).toEqual({ startDate: '2026-03-09' });

    const startOnly = makeTask({ id: 'a', startDate: '2026-03-09' });
    expect(resizePatch(startOnly, 'end', '2026-03-12')).toEqual({ dueDate: '2026-03-12' });
  });

  it('is null for a no-op and for an undated task', () => {
    expect(resizePatch(span, 'start', '2026-03-09')).toBeNull();
    expect(resizePatch(span, 'end', '2026-03-12')).toBeNull();
    expect(resizePatch(makeTask({ id: 'a' }), 'end', '2026-03-12')).toBeNull();
  });
});

describe('nextChipIndex', () => {
  // Three chips on Monday, one the following Monday, one the Tuesday after.
  const chips = [
    { dayKey: '2026-03-09' },
    { dayKey: '2026-03-09' },
    { dayKey: '2026-03-10' },
    { dayKey: '2026-03-16' },
    { dayKey: '2026-03-17' },
  ];

  it('recognises only the four arrow keys', () => {
    expect(isArrowKey('ArrowUp')).toBe(true);
    expect(isArrowKey('Enter')).toBe(false);
  });

  it('steps forward with ArrowRight in LTR and with ArrowLeft in RTL', () => {
    expect(nextChipIndex(chips, 1, 'ArrowRight', false)).toBe(2);
    expect(nextChipIndex(chips, 1, 'ArrowLeft', false)).toBe(0);
    expect(nextChipIndex(chips, 1, 'ArrowLeft', true)).toBe(2);
    expect(nextChipIndex(chips, 1, 'ArrowRight', true)).toBe(0);
  });

  it('stops at the ends of the list', () => {
    expect(nextChipIndex(chips, 0, 'ArrowLeft', false)).toBeNull();
    expect(nextChipIndex(chips, chips.length - 1, 'ArrowRight', false)).toBeNull();
    expect(nextChipIndex(chips, 99, 'ArrowRight', false)).toBeNull();
  });

  it('moves down by a WEEK, not by an element', () => {
    // From Monday the 9th, one week down is the 16th — index 3, past the two
    // chips that merely come next in the DOM.
    expect(nextChipIndex(chips, 0, 'ArrowDown', false)).toBe(3);
    expect(nextChipIndex(chips, 3, 'ArrowUp', false)).toBe(0);
  });

  it('falls to the nearest chip in the direction of travel when the day is empty', () => {
    // A week below the 10th is the 17th; nothing is on it in this fixture …
    expect(nextChipIndex(chips, 2, 'ArrowDown', false)).toBe(4);
    // … and there is nothing at all below the last row.
    expect(nextChipIndex(chips, 4, 'ArrowDown', false)).toBeNull();
  });
});
