import { describe, expect, it } from 'vitest';

import { buildCellPatch, cellKey, parsePoints } from '@/components/datatable/useCellPatch';

/**
 * The two pure halves of the commit path.
 *
 * `buildCellPatch` decides which KEY a cell writes, which is exactly the kind of
 * mistake nothing surfaces: a status editor that sends `status` instead of
 * `statusId` reads to the user as "the server rejected my change", and a points
 * editor that sends `points` silently changes nothing at all.
 *
 * `parsePoints` is the fractional-safety guarantee — story points are halves,
 * so anything integer-shaped here is a data-loss bug.
 */

describe('buildCellPatch', () => {
  it('addresses the task and writes exactly one field', () => {
    expect(buildCellPatch('t1', 'title', 'New title')).toEqual({
      taskId: 't1',
      title: 'New title',
    });
  });

  it('writes the contract key, not the column id, for status', () => {
    expect(buildCellPatch('t1', 'statusId', 's2')).toEqual({ taskId: 't1', statusId: 's2' });
  });

  it('writes `storyPoints`, and preserves a half point', () => {
    expect(buildCellPatch('t1', 'storyPoints', 0.5)).toEqual({ taskId: 't1', storyPoints: 0.5 });
  });

  it('carries an explicit null through — clearing is a value, not an omission', () => {
    expect(buildCellPatch('t1', 'assigneeId', null)).toEqual({ taskId: 't1', assigneeId: null });
    expect(buildCellPatch('t1', 'dueDate', null)).toEqual({ taskId: 't1', dueDate: null });
    expect(buildCellPatch('t1', 'sprintId', null)).toEqual({ taskId: 't1', sprintId: null });
  });

  it('sends the whole label set, because the API replaces it', () => {
    expect(buildCellPatch('t1', 'labelIds', ['a', 'b'])).toEqual({
      taskId: 't1',
      labelIds: ['a', 'b'],
    });
  });

  it('keys the pending set by task AND field, so one edit spins one cell', () => {
    expect(cellKey('t1', 'title')).toBe('t1:title');
    expect(cellKey('t1', 'title')).not.toBe(cellKey('t1', 'storyPoints'));
    expect(cellKey('t1', 'title')).not.toBe(cellKey('t2', 'title'));
  });
});

describe('parsePoints', () => {
  it('accepts a whole number', () => {
    expect(parsePoints('8')).toEqual({ ok: true, value: 8 });
  });

  it('accepts a half point', () => {
    expect(parsePoints('0.5')).toEqual({ ok: true, value: 0.5 });
    expect(parsePoints('1.5')).toEqual({ ok: true, value: 1.5 });
  });

  it('accepts a half written without its leading zero', () => {
    expect(parsePoints('.5')).toEqual({ ok: true, value: 0.5 });
  });

  it('accepts a comma as the decimal separator', () => {
    // An Arabic or European keyboard produces one where an English one
    // produces a dot; the value that leaves is still a JS number.
    expect(parsePoints('0,5')).toEqual({ ok: true, value: 0.5 });
  });

  it('reads an emptied field as "unestimated", not as zero', () => {
    expect(parsePoints('')).toEqual({ ok: true, value: null });
    expect(parsePoints('   ')).toEqual({ ok: true, value: null });
  });

  it('keeps an explicit zero', () => {
    expect(parsePoints('0')).toEqual({ ok: true, value: 0 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parsePoints(' 3 ')).toEqual({ ok: true, value: 3 });
  });

  it('rejects text, exponents and hex — all of which `Number` would accept', () => {
    expect(parsePoints('abc')).toEqual({ ok: false });
    expect(parsePoints('1e3')).toEqual({ ok: false });
    expect(parsePoints('0x10')).toEqual({ ok: false });
    expect(parsePoints('1 2')).toEqual({ ok: false });
  });

  it('rejects a negative estimate', () => {
    expect(parsePoints('-1')).toEqual({ ok: false });
  });

  it('rejects a value past the contract ceiling', () => {
    expect(parsePoints('1000')).toEqual({ ok: true, value: 1000 });
    expect(parsePoints('1001')).toEqual({ ok: false });
  });
});
