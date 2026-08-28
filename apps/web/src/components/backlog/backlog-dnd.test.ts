import { describe, expect, it } from 'vitest';

import {
  bucketDroppableId,
  parseBucketDroppableId,
  resolveBacklogDragEnd,
  type BucketOrder,
} from '@/components/backlog/backlog-dnd';

/**
 * The drag→rank mapping — the one piece of the backlog that can be silently
 * wrong, so it is asserted directly rather than through a rendered drag.
 *
 * The fixture is three buckets: the backlog and two sprints, one of them empty.
 */

const BUCKETS: BucketOrder[] = [
  { sprintId: null, taskIds: ['b1', 'b2', 'b3', 'b4'] },
  { sprintId: 'sp-1', taskIds: ['s1', 's2'] },
  { sprintId: 'sp-2', taskIds: [] },
];

describe('bucket droppable ids', () => {
  it('round-trips a sprint id', () => {
    expect(parseBucketDroppableId(bucketDroppableId('sp-1'))).toBe('sp-1');
  });

  it('round-trips the backlog as `null`, not as a missing value', () => {
    expect(parseBucketDroppableId(bucketDroppableId(null))).toBeNull();
  });

  it('reports a task id as `undefined` so it is distinguishable from the backlog', () => {
    expect(parseBucketDroppableId('b1')).toBeUndefined();
  });
});

describe('resolveBacklogDragEnd', () => {
  it('maps a downward reorder to the hovered row’s index', () => {
    // [b1 b2 b3 b4], b1 onto b3 → lifted [b2 b3 b4], insert at 2 → b2 b3 b1 b4
    expect(resolveBacklogDragEnd({ activeId: 'b1', overId: 'b3', buckets: BUCKETS })).toEqual({
      taskId: 'b1',
      fromSprintId: null,
      toSprintId: null,
      toIndex: 2,
    });
  });

  it('maps an upward reorder to the same index convention', () => {
    // b4 onto b2 → lifted [b1 b2 b3], insert at 1 → b1 b4 b2 b3
    expect(resolveBacklogDragEnd({ activeId: 'b4', overId: 'b2', buckets: BUCKETS })).toEqual({
      taskId: 'b4',
      fromSprintId: null,
      toSprintId: null,
      toIndex: 1,
    });
  });

  it('maps a cross-bucket drop onto a row to that row’s index in the TARGET', () => {
    expect(resolveBacklogDragEnd({ activeId: 'b1', overId: 's2', buckets: BUCKETS })).toEqual({
      taskId: 'b1',
      fromSprintId: null,
      toSprintId: 'sp-1',
      toIndex: 1,
    });
  });

  it('appends when dropped on a collapsed section’s own droppable', () => {
    expect(
      resolveBacklogDragEnd({
        activeId: 'b1',
        overId: bucketDroppableId('sp-1'),
        buckets: BUCKETS,
      }),
    ).toEqual({ taskId: 'b1', fromSprintId: null, toSprintId: 'sp-1', toIndex: 2 });
  });

  it('appends at 0 when the target bucket is empty', () => {
    expect(
      resolveBacklogDragEnd({
        activeId: 's1',
        overId: bucketDroppableId('sp-2'),
        buckets: BUCKETS,
      }),
    ).toEqual({ taskId: 's1', fromSprintId: 'sp-1', toSprintId: 'sp-2', toIndex: 0 });
  });

  it('counts the dragged row OUT when appending to its own bucket', () => {
    // Four rows, but b1 is the one moving, so the end of the lifted list is 3.
    expect(
      resolveBacklogDragEnd({ activeId: 'b1', overId: bucketDroppableId(null), buckets: BUCKETS }),
    ).toEqual({ taskId: 'b1', fromSprintId: null, toSprintId: null, toIndex: 3 });
  });

  it('maps a drop back onto the backlog droppable from a sprint', () => {
    expect(
      resolveBacklogDragEnd({ activeId: 's1', overId: bucketDroppableId(null), buckets: BUCKETS }),
    ).toEqual({ taskId: 's1', fromSprintId: 'sp-1', toSprintId: null, toIndex: 4 });
  });

  it('is a no-op when dropped outside every target', () => {
    expect(resolveBacklogDragEnd({ activeId: 'b1', overId: null, buckets: BUCKETS })).toBeNull();
  });

  it('is a no-op when dropped on itself', () => {
    expect(resolveBacklogDragEnd({ activeId: 'b1', overId: 'b1', buckets: BUCKETS })).toBeNull();
  });

  it('is a no-op for a row no cached bucket holds — a stale drag', () => {
    expect(resolveBacklogDragEnd({ activeId: 'gone', overId: 'b2', buckets: BUCKETS })).toBeNull();
  });
});
