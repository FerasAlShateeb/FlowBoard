import { describe, expect, it } from 'vitest';
import type { Status, TaskSummary } from '@flowboard/shared';

import { subtaskProgress } from '@/components/tasks/subtask-progress';

/** The three-column workflow every project is seeded with. */
const STATUSES: Status[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    projectId: 'p',
    name: 'To Do',
    category: 'todo',
    color: '#64748b',
    position: 0,
    wipLimit: null,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    projectId: 'p',
    name: 'Shipped',
    category: 'done',
    color: '#22c55e',
    position: 1,
    wipLimit: null,
  },
];

const [TODO, DONE] = STATUSES;

function subtask(statusId: string, id: string): TaskSummary {
  return {
    id,
    number: 1,
    title: id,
    type: 'subtask',
    priority: 'medium',
    statusId,
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
  };
}

describe('subtaskProgress', () => {
  it('is 0% and NOT complete for an empty list', () => {
    // The division-by-zero case, and the reason `complete` is not simply
    // `done === total`: nothing done out of nothing is not an achievement.
    expect(subtaskProgress([], STATUSES)).toEqual({
      done: 0,
      total: 0,
      percent: 0,
      complete: false,
    });
  });

  it('counts a DONE-category status, whatever the team named it', () => {
    // "Shipped", not "Done" — statuses are per-project data and only the
    // category is closed.
    const progress = subtaskProgress(
      [subtask(DONE?.id ?? '', 'a'), subtask(TODO?.id ?? '', 'b')],
      STATUSES,
    );
    expect(progress).toEqual({ done: 1, total: 2, percent: 50, complete: false });
  });

  it('reports complete only when every subtask is done', () => {
    const progress = subtaskProgress(
      [subtask(DONE?.id ?? '', 'a'), subtask(DONE?.id ?? '', 'b')],
      STATUSES,
    );
    expect(progress).toEqual({ done: 2, total: 2, percent: 100, complete: true });
  });

  it('rounds the percentage', () => {
    const rows = ['a', 'b', 'c'].map((id, index) =>
      subtask(index === 0 ? (DONE?.id ?? '') : (TODO?.id ?? ''), id),
    );
    expect(subtaskProgress(rows, STATUSES).percent).toBe(33);
  });

  it('counts a subtask in an UNKNOWN status as not done', () => {
    // A column deleted since the subtask was filed. Over-reporting progress is
    // the failure people act on, so "cannot tell" resolves to "not done".
    const progress = subtaskProgress([subtask('deleted-status-id', 'a')], STATUSES);
    expect(progress).toEqual({ done: 0, total: 1, percent: 0, complete: false });
  });
});
