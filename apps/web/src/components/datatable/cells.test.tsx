// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Label, Sprint, Status, TaskSummary, Transition } from '@flowboard/shared';

// Brings the English catalog up synchronously — see `src/i18n/index.ts`.
import '@/i18n';
import {
  TableGridProvider,
  type EditingCell,
  type TableGridEnv,
} from '@/components/datatable/grid-context';
import {
  KeyCell,
  LabelsCell,
  PointsCell,
  StatusCell,
  TitleCell,
} from '@/components/datatable/cells';
import type { CellPatcher, EditableField } from '@/components/datatable/useCellPatch';

/**
 * The inline editors, rendered one at a time under a hand-built grid context.
 *
 * WHY ONE CELL AT A TIME rather than through the whole table. What is being
 * asserted here is the COMMIT PAYLOAD — which field name a given editor writes,
 * and what it turns the user's input into. Reaching those through a rendered
 * grid would mean driving roving focus and a virtualiser to get at a decision
 * that has nothing to do with either. `TaskDataTable.test.tsx` covers the grid.
 *
 * The patcher is a plain stub rather than a mocked `usePatchTask`: `useCellPatch`
 * already has its own (pure) tests for the request body, so what is left to
 * verify is that each editor calls `commit` with the right field and value.
 */

// ── Radix in jsdom ─────────────────────────────────────────────────────────
// Radix's popper layer measures with ResizeObserver and drives selection with
// the Pointer Capture API; jsdom implements neither. These are the standard
// stubs, not a workaround for anything in this code.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* no layout in jsdom */
      }
      unobserve() {
        /* no layout in jsdom */
      }
      disconnect() {
        /* no layout in jsdom */
      }
    },
  );
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
});

// Testing Library's auto-cleanup only runs when a global `afterEach` exists,
// which this project's setup file does not install. Explicit, so one test's
// tree cannot leak into the next one's queries.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Fixtures ───────────────────────────────────────────────────────────────

const STATUSES: Status[] = [
  {
    id: 's-todo',
    projectId: 'p1',
    name: 'To do',
    category: 'todo',
    color: '#888888',
    position: 0,
    wipLimit: null,
  },
  {
    id: 's-doing',
    projectId: 'p1',
    name: 'In progress',
    category: 'in_progress',
    color: '#3366ff',
    position: 1,
    wipLimit: null,
  },
  {
    id: 's-done',
    projectId: 'p1',
    name: 'Done',
    category: 'done',
    color: '#22aa66',
    position: 2,
    wipLimit: null,
  },
];

const LABELS: Label[] = [
  { id: 'l-ui', projectId: 'p1', name: 'ui', color: '#aa44cc' },
  { id: 'l-bug', projectId: 'p1', name: 'regression', color: '#cc4444' },
];

const SPRINTS: Sprint[] = [];

function makeTask(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 't1',
    number: 142,
    title: 'Fix the login form',
    type: 'bug',
    priority: 'high',
    statusId: 's-todo',
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

const commit = vi.fn();
const endEdit = vi.fn();
const beginEdit = vi.fn();

function makeEnv({
  editing,
  transitions = [],
  saving,
}: {
  editing?: EditingCell | null;
  transitions?: Transition[];
  saving?: (taskId: string, field: EditableField) => boolean;
} = {}): TableGridEnv {
  const patcher: CellPatcher = { commit, isSaving: saving ?? (() => false) };

  return {
    projectId: 'p1',
    orgId: 'o1',
    projectKey: 'FLOW',
    statuses: STATUSES,
    transitions,
    labels: LABELS,
    sprints: SPRINTS,
    canWrite: true,
    patcher,
    editing: editing ?? null,
    beginEdit,
    endEdit,
  };
}

function renderCell(node: ReactNode, env: TableGridEnv = makeEnv()) {
  return render(
    <MemoryRouter>
      <TableGridProvider value={env}>{node}</TableGridProvider>
    </MemoryRouter>,
  );
}

// ── Key ────────────────────────────────────────────────────────────────────

describe('KeyCell', () => {
  it('composes the human key and deep-links to the sheet as a child route', () => {
    renderCell(<KeyCell task={makeTask()} />);

    const link = screen.getByRole('link', { name: 'Open FLOW-142' });
    expect(link.textContent).toBe('FLOW-142');
    // Relative, so the table stays mounted under the sheet.
    expect(link.getAttribute('href')).toBe('/t/FLOW-142');
  });

  it('keeps the link out of the tab order — the CELL owns the tab stop', () => {
    renderCell(<KeyCell task={makeTask()} />);
    expect(screen.getByRole('link', { name: 'Open FLOW-142' }).getAttribute('tabindex')).toBe('-1');
  });
});

// ── Title ──────────────────────────────────────────────────────────────────

describe('TitleCell', () => {
  it('renders the title as text when it is not being edited', () => {
    renderCell(<TitleCell task={makeTask()} />);
    expect(screen.getByText('Fix the login form')).not.toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('commits the trimmed title on Enter', async () => {
    const user = userEvent.setup();
    renderCell(
      <TitleCell task={makeTask()} />,
      makeEnv({ editing: { taskId: 't1', columnId: 'title' } }),
    );

    const input = screen.getByRole('textbox', { name: 'Edit title' });
    await user.clear(input);
    await user.type(input, '  Rework the login form  {Enter}');

    expect(commit).toHaveBeenCalledWith('t1', 'title', 'Rework the login form');
    expect(endEdit).toHaveBeenCalled();
  });

  it('cancels on Escape without writing anything', async () => {
    const user = userEvent.setup();
    renderCell(
      <TitleCell task={makeTask()} />,
      makeEnv({ editing: { taskId: 't1', columnId: 'title' } }),
    );

    await user.type(screen.getByRole('textbox', { name: 'Edit title' }), ' edited{Escape}');

    expect(commit).not.toHaveBeenCalled();
    expect(endEdit).toHaveBeenCalled();
  });

  it('does not fire a request when the value did not change', async () => {
    const user = userEvent.setup();
    renderCell(
      <TitleCell task={makeTask()} />,
      makeEnv({ editing: { taskId: 't1', columnId: 'title' } }),
    );

    await user.type(screen.getByRole('textbox', { name: 'Edit title' }), '{Enter}');

    expect(commit).not.toHaveBeenCalled();
    expect(endEdit).toHaveBeenCalled();
  });

  it('reverts an emptied title rather than writing one the contract forbids', async () => {
    const user = userEvent.setup();
    renderCell(
      <TitleCell task={makeTask()} />,
      makeEnv({ editing: { taskId: 't1', columnId: 'title' } }),
    );

    const input = screen.getByRole('textbox', { name: 'Edit title' });
    await user.clear(input);
    await user.type(input, '{Enter}');

    expect(commit).not.toHaveBeenCalled();
  });

  it('shows a saving indicator for its own cell only', () => {
    renderCell(
      <TitleCell task={makeTask()} />,
      makeEnv({ saving: (taskId, field) => taskId === 't1' && field === 'title' }),
    );

    expect(screen.getByRole('status', { name: 'Saving' })).not.toBeNull();
  });
});

// ── Points ─────────────────────────────────────────────────────────────────

describe('PointsCell', () => {
  it('renders a fractional estimate with Latin digits', () => {
    renderCell(<PointsCell task={makeTask({ storyPoints: 0.5 })} />);
    expect(screen.getByText('0.5')).not.toBeNull();
  });

  it('commits a half point', async () => {
    const user = userEvent.setup();
    renderCell(
      <PointsCell task={makeTask()} />,
      makeEnv({ editing: { taskId: 't1', columnId: 'points' } }),
    );

    await user.type(screen.getByRole('textbox', { name: 'Edit story points' }), '0.5{Enter}');

    expect(commit).toHaveBeenCalledWith('t1', 'storyPoints', 0.5);
  });

  it('writes null when the field is emptied', async () => {
    const user = userEvent.setup();
    renderCell(
      <PointsCell task={makeTask({ storyPoints: 3 })} />,
      makeEnv({ editing: { taskId: 't1', columnId: 'points' } }),
    );

    const input = screen.getByRole('textbox', { name: 'Edit story points' });
    await user.clear(input);
    await user.type(input, '{Enter}');

    expect(commit).toHaveBeenCalledWith('t1', 'storyPoints', null);
  });

  it('keeps the editor open on an unparseable value instead of discarding it', async () => {
    const user = userEvent.setup();
    renderCell(
      <PointsCell task={makeTask()} />,
      makeEnv({ editing: { taskId: 't1', columnId: 'points' } }),
    );

    const input = screen.getByRole('textbox', { name: 'Edit story points' });
    await user.type(input, 'lots{Enter}');

    expect(commit).not.toHaveBeenCalled();
    expect(endEdit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});

// ── Status ─────────────────────────────────────────────────────────────────

describe('StatusCell', () => {
  it('shows the status name when it is not being edited', () => {
    renderCell(<StatusCell task={makeTask()} />);
    expect(screen.getByText('To do')).not.toBeNull();
  });

  it('offers every status when the project has no transition rules', async () => {
    renderCell(
      <StatusCell task={makeTask()} />,
      makeEnv({ editing: { taskId: 't1', columnId: 'status' } }),
    );

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['To do', 'In progress', 'Done']);
  });

  it('omits a target the workflow does not allow from here', async () => {
    // Any row FROM `s-todo` turns that status into a whitelist: only the
    // listed targets (plus staying put) are reachable.
    const transitions: Transition[] = [
      { id: 'tr1', projectId: 'p1', fromStatusId: 's-todo', toStatusId: 's-doing' },
    ];

    renderCell(
      <StatusCell task={makeTask()} />,
      makeEnv({ editing: { taskId: 't1', columnId: 'status' }, transitions }),
    );

    const options = await screen.findAllByRole('option');
    const names = options.map((option) => option.textContent);
    expect(names).toContain('In progress');
    // The current status stays selectable (it is where the task already is).
    expect(names).toContain('To do');
    // …and the unreachable one is GONE, not merely disabled.
    expect(names).not.toContain('Done');
  });

  it('leaves another status untouched by the first one’s whitelist', async () => {
    const transitions: Transition[] = [
      { id: 'tr1', projectId: 'p1', fromStatusId: 's-todo', toStatusId: 's-doing' },
    ];

    renderCell(
      <StatusCell task={makeTask({ statusId: 's-doing' })} />,
      makeEnv({ editing: { taskId: 't1', columnId: 'status' }, transitions }),
    );

    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(3);
  });

  it('commits the chosen status id', async () => {
    const user = userEvent.setup();
    renderCell(
      <StatusCell task={makeTask()} />,
      makeEnv({ editing: { taskId: 't1', columnId: 'status' } }),
    );

    const options = await screen.findAllByRole('option');
    const target = options.find((option) => option.textContent === 'In progress');
    await user.click(target as HTMLElement);

    expect(commit).toHaveBeenCalledWith('t1', 'statusId', 's-doing');
  });
});

// ── Labels ─────────────────────────────────────────────────────────────────

describe('LabelsCell', () => {
  it('renders one chip per applied label', () => {
    renderCell(<LabelsCell task={makeTask({ labelIds: ['l-ui', 'l-bug'] })} />);
    expect(screen.getByText('ui')).not.toBeNull();
    expect(screen.getByText('regression')).not.toBeNull();
  });

  it('commits the whole set once, when the popover closes', async () => {
    const user = userEvent.setup();
    renderCell(
      <LabelsCell task={makeTask({ labelIds: ['l-ui'] })} />,
      makeEnv({ editing: { taskId: 't1', columnId: 'labels' } }),
    );

    const list = await screen.findByRole('list');
    await user.click(within(list).getByRole('checkbox', { name: 'regression' }));

    // Still nothing sent: the burst is batched until the editor closes.
    expect(commit).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');

    expect(commit).toHaveBeenCalledWith('t1', 'labelIds', ['l-ui', 'l-bug']);
  });
});
