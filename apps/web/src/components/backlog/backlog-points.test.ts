import { describe, expect, it } from 'vitest';
import type { Status, TaskSummary } from '@flowboard/shared';

import { doneStatusIds, summarizePoints } from '@/components/backlog/backlog-points';

/**
 * The header chips' arithmetic.
 *
 * The case worth the file is FRACTIONAL POINTS: the contract allows halves, and
 * `0.5 + 0.5 + 0.5` in binary floating point is `1.5000000000000002`. A chip
 * reading that instead of `1.5` is the kind of defect nobody files and everybody
 * notices.
 */

function status(id: string, category: Status['category']): Status {
  return { id, projectId: 'p1', name: id, category, color: '#3b82f6', position: 0, wipLimit: null };
}

function task(id: string, statusId: string, storyPoints: number | null): TaskSummary {
  return {
    id,
    number: Number(id.replace(/\D/g, '')) || 1,
    title: id,
    type: 'task',
    priority: 'medium',
    statusId,
    assignee: null,
    storyPoints,
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
  };
}

const STATUSES: Status[] = [
  status('todo', 'todo'),
  status('doing', 'in_progress'),
  status('shipped', 'done'),
];

describe('doneStatusIds', () => {
  it('collects exactly the `done`-category statuses', () => {
    expect([...doneStatusIds(STATUSES)]).toEqual(['shipped']);
  });

  it('is empty for a workflow with no done column', () => {
    expect(doneStatusIds([status('todo', 'todo')]).size).toBe(0);
  });
});

describe('summarizePoints', () => {
  const done = doneStatusIds(STATUSES);

  it('counts rows and sums points across a bucket', () => {
    const summary = summarizePoints(
      [task('t1', 'todo', 3), task('t2', 'doing', 5), task('t3', 'shipped', 2)],
      done,
    );
    expect(summary).toEqual({ count: 3, doneCount: 1, totalPoints: 10, donePoints: 2 });
  });

  it('treats an unestimated row as present but worth nothing', () => {
    const summary = summarizePoints([task('t1', 'todo', null), task('t2', 'todo', 8)], done);
    expect(summary.count).toBe(2);
    expect(summary.totalPoints).toBe(8);
  });

  it('sums half points without floating-point drift', () => {
    const summary = summarizePoints(
      [task('t1', 'todo', 0.5), task('t2', 'todo', 0.5), task('t3', 'todo', 0.5)],
      done,
    );
    // The naive sum is 1.5000000000000002.
    expect(summary.totalPoints).toBe(1.5);
  });

  it('counts the done half separately, halves included', () => {
    const summary = summarizePoints(
      [task('t1', 'shipped', 0.5), task('t2', 'shipped', 0.5), task('t3', 'todo', 1)],
      done,
    );
    expect(summary.doneCount).toBe(2);
    expect(summary.donePoints).toBe(1);
    expect(summary.totalPoints).toBe(2);
  });

  it('is all zeroes for an empty bucket', () => {
    expect(summarizePoints([], done)).toEqual({
      count: 0,
      doneCount: 0,
      totalPoints: 0,
      donePoints: 0,
    });
  });
});

// `formatPoints` is re-exported from `lib/format` — see `lib/format.test.ts`.
