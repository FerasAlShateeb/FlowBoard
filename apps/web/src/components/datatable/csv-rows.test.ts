import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '@flowboard/shared';

import { toCsv } from '@/lib/csv';
import { csvHeadersFor, taskToCsvRow, type CsvRowContext } from '@/components/datatable/csv-rows';

/**
 * The flattening rules — ISO dates, `;`-joined labels, localized enum names,
 * numeric points — asserted individually, because each one is invisible from
 * the UI and only shows up when someone opens the file in Excel.
 */

const context: CsvRowContext = {
  projectKey: 'FLOW',
  statusNames: new Map([['s1', 'In progress']]),
  sprintNames: new Map([['sp1', 'Sprint 4']]),
  labelNames: new Map([
    ['l1', 'ui'],
    ['l2', 'bug'],
  ]),
  typeLabel: (type) => `T:${type}`,
  priorityLabel: (priority) => `P:${priority}`,
  unassignedLabel: 'Unassigned',
  backlogLabel: 'Backlog',
};

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 't1',
    number: 142,
    title: 'Fix the login form',
    type: 'bug',
    priority: 'high',
    statusId: 's1',
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
    updatedAt: '2026-03-04T09:30:00.000Z',
    ...overrides,
  };
}

describe('taskToCsvRow', () => {
  it('composes the human task key from the project key and the number', () => {
    expect(taskToCsvRow(task(), context).key).toBe('FLOW-142');
  });

  it('writes the status NAME, never its uuid', () => {
    expect(taskToCsvRow(task(), context).status).toBe('In progress');
  });

  it('localizes the closed enums', () => {
    const row = taskToCsvRow(task(), context);
    expect(row.type).toBe('T:bug');
    expect(row.priority).toBe('P:high');
  });

  it('names the empty assignee and the empty sprint', () => {
    const row = taskToCsvRow(task(), context);
    expect(row.assignee).toBe('Unassigned');
    expect(row.sprint).toBe('Backlog');
  });

  it('keeps points a NUMBER so the column can be summed', () => {
    expect(taskToCsvRow(task({ storyPoints: 0.5 }), context).points).toBe(0.5);
  });

  it('leaves an unestimated task empty rather than claiming zero', () => {
    expect(taskToCsvRow(task(), context).points).toBeNull();
  });

  it('joins labels with a semicolon, not a comma', () => {
    expect(taskToCsvRow(task({ labelIds: ['l1', 'l2'] }), context).labels).toBe('ui;bug');
  });

  it('drops a label id the project no longer has', () => {
    expect(taskToCsvRow(task({ labelIds: ['l1', 'gone'] }), context).labels).toBe('ui');
  });

  it('writes dates as ISO, not as the localized form the grid shows', () => {
    const row = taskToCsvRow(task({ startDate: '2026-03-01', dueDate: '2026-03-04' }), context);
    expect(row.startDate).toBe('2026-03-01');
    expect(row.dueDate).toBe('2026-03-04');
    expect(row.updatedAt).toBe('2026-03-04T09:30:00.000Z');
  });

  it('leaves an unset date empty', () => {
    const row = taskToCsvRow(task(), context);
    expect(row.startDate).toBeNull();
    expect(row.dueDate).toBeNull();
  });
});

describe('csvHeadersFor', () => {
  it('mirrors the visible columns, in the chosen order, under their UI names', () => {
    expect(csvHeadersFor(['title', 'key'], { key: 'Key', title: 'Title', type: 'Type' })).toEqual([
      { key: 'title', label: 'Title' },
      { key: 'key', label: 'Key' },
    ]);
  });

  it('falls back to the column id when a label is missing', () => {
    expect(csvHeadersFor(['dueDate'], {})).toEqual([{ key: 'dueDate', label: 'dueDate' }]);
  });
});

describe('the export end to end', () => {
  it('produces a document whose columns follow the visible set', () => {
    const rows = [
      taskToCsvRow(task({ title: 'Fix, urgently', storyPoints: 0.5 }), context),
      taskToCsvRow(task({ number: 7, title: 'say "hi"' }), context),
    ];

    const csv = toCsv(
      rows,
      csvHeadersFor(['key', 'title', 'points'], {
        key: 'Key',
        title: 'Title',
        points: 'Points',
      }),
    );

    expect(csv.slice(1).split('\r\n')).toEqual([
      'Key,Title,Points',
      'FLOW-142,"Fix, urgently",0.5',
      'FLOW-7,"say ""hi""",',
    ]);
  });
});
