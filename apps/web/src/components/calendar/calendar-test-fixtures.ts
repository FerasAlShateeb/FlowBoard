import type { TaskSummary } from '@flowboard/shared';

/**
 * TEST-ONLY task builder for the calendar suites.
 *
 * It lives in its own module rather than in one of the `*.test.ts` files
 * because importing a test file from another test file would register its
 * `describe`s twice. Nothing in `src/` imports this, so it never reaches a
 * bundle.
 *
 * Every field of `TaskSummary` gets a boring default; a test names only the
 * two or three that its case is actually about, which is what keeps the
 * fixtures readable next to the assertion.
 */
export function makeTask(overrides: Partial<TaskSummary> & { id: string }): TaskSummary {
  return {
    number: 1,
    title: 'A task',
    type: 'task',
    priority: 'medium',
    statusId: 'status-todo',
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
