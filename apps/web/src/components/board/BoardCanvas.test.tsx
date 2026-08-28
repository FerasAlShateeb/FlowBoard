// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { BoardResponse, Label, Status, TaskSummary, Transition } from '@flowboard/shared';

import '@/i18n';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useBoardFilterStore } from '@/stores/useBoardFilterStore';
import { BoardCanvas } from '@/components/board/BoardCanvas';

/**
 * The board as a user meets it: columns from the project's workflow, cards from
 * the board response, a composer that creates, and a card that opens.
 *
 * WHAT IS MOCKED, AND WHY ONLY THAT. The DATA hooks — the two mutations and the
 * epic lookup — are replaced, because this suite is about what the board
 * RENDERS and which intent it emits, not about the transport. `checkDrop` and
 * `wipStateOf` are kept REAL (`importOriginal`): they are pure rules, and a
 * board that styles a forbidden column correctly against a stubbed rule has
 * proved nothing.
 */

const { createMutate, moveSpy, navigateSpy } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  moveSpy: vi.fn(),
  navigateSpy: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigateSpy }));

vi.mock('@/hooks/useTasks', () => ({
  // The epic-lane title lookup. Disabled unless the mode is `epic`, and the
  // board never renders without it resolving.
  useTaskList: () => ({ data: [] }),
}));

vi.mock('@/hooks/useTaskMutations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useTaskMutations')>();
  return {
    ...actual,
    useCreateTask: () => ({ mutate: createMutate, isPending: false }),
    useMoveTask: () => ({ move: moveSpy }),
  };
});

// dnd-kit measures its droppables through a ResizeObserver, which jsdom does
// not implement. A no-op is enough: nothing here asserts geometry.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(cleanup);

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

const ada = { id: 'user-ada', name: 'Ada Lovelace', avatarUrl: null };

function status(overrides: Partial<Status> & { id: string; name: string }): Status {
  return {
    projectId: 'p1',
    category: 'todo',
    color: '#8b5cf6',
    position: 0,
    wipLimit: null,
    ...overrides,
  };
}

const STATUSES: Status[] = [
  status({ id: 'todo', name: 'To Do', position: 0 }),
  status({ id: 'doing', name: 'In Progress', position: 1, category: 'in_progress', wipLimit: 1 }),
  status({ id: 'done', name: 'Done', position: 2, category: 'done' }),
];

const LABELS: Label[] = [{ id: 'label-a', projectId: 'p1', name: 'backend', color: '#3b82f6' }];

function task(overrides: Partial<TaskSummary> & { id: string; number: number }): TaskSummary {
  return {
    title: `Task ${overrides.number}`,
    type: 'task',
    priority: 'medium',
    statusId: 'todo',
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
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const BOARD: BoardResponse = {
  columns: {
    todo: [
      task({ id: 't1', number: 1, assignee: ada, storyPoints: 0.5 }),
      task({ id: 't2', number: 2, statusId: 'todo' }),
    ],
    // Exactly at its limit of 1, and over it once a card is dragged in.
    doing: [task({ id: 't3', number: 3, statusId: 'doing', assignee: ada })],
    done: [],
  },
};

const TRANSITIONS: Transition[] = [];
const FILTERS = {};

function renderCanvas(overrides: Partial<Parameters<typeof BoardCanvas>[0]> = {}) {
  return render(
    <TooltipProvider>
      <BoardCanvas
        projectId="p1"
        projectKey="FLOW"
        statuses={STATUSES}
        labels={LABELS}
        transitions={TRANSITIONS}
        board={BOARD}
        filters={FILTERS}
        mode="none"
        collapsedLanes={[]}
        canWrite
        {...overrides}
      />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useBoardFilterStore.setState({ byProject: {} });
});

// ───────────────────────────────────────────────────────────────────────────

describe('BoardCanvas — columns and cards', () => {
  it('draws one column per workflow status, in board order', () => {
    renderCanvas();
    const columns = screen.getAllByRole('region');
    expect(columns.map((column) => column.getAttribute('data-status-id'))).toEqual([
      'todo',
      'doing',
      'done',
    ]);
  });

  it('draws every card of a column, keyed by the project key', () => {
    renderCanvas();
    expect(screen.getByText('FLOW-1')).toBeInTheDocument();
    expect(screen.getByText('FLOW-2')).toBeInTheDocument();
    expect(screen.getByText('FLOW-3')).toBeInTheDocument();
  });

  it('puts each card in ITS OWN column', () => {
    renderCanvas();
    const doing = screen.getByRole('region', { name: 'In Progress column' });
    expect(within(doing).getByText('FLOW-3')).toBeInTheDocument();
    expect(within(doing).queryByText('FLOW-1')).not.toBeInTheDocument();
  });

  it('counts the cards in each column header', () => {
    renderCanvas();
    expect(screen.getByLabelText('Cards: 2')).toHaveTextContent('2');
    // An empty column still draws, with a zero.
    expect(screen.getAllByLabelText('Cards: 0')).toHaveLength(1);
  });

  it('renders a fractional estimate straight from the fixture', () => {
    renderCanvas();
    expect(screen.getByLabelText('Story points: 0.5')).toHaveTextContent('0.5');
  });

  it('says so when a column is empty', () => {
    renderCanvas();
    const done = screen.getByRole('region', { name: 'Done column' });
    expect(within(done).getByText('No cards')).toBeInTheDocument();
  });

  it('shows the WIP badge only on the column that has a limit', () => {
    renderCanvas();
    const badges = screen.getAllByLabelText(/Work in progress/);
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent('1/1');
  });
});

describe('BoardCanvas — opening a card', () => {
  it('navigates to the task sheet RELATIVE to the board route', async () => {
    const user = userEvent.setup();
    renderCanvas();

    await user.click(screen.getByRole('button', { name: 'Open FLOW-1' }));

    // Relative, so react-router resolves it against `…/p/FLOW/board` and the
    // board behind the sheet never unmounts.
    expect(navigateSpy).toHaveBeenCalledWith('t/FLOW-1');
  });
});

describe('BoardCanvas — quick add', () => {
  it('creates a card in the column whose composer was opened', async () => {
    const user = userEvent.setup();
    renderCanvas();

    await user.click(screen.getAllByLabelText('Add a card to In Progress')[0]!);

    const field = screen.getByLabelText('New card in In Progress');
    await user.type(field, 'Wire up the refresh{Enter}');

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]?.[0]).toMatchObject({
      title: 'Wire up the refresh',
      statusId: 'doing',
      type: 'task',
      priority: 'medium',
    });
  });

  it('refuses to submit a title that is only whitespace', async () => {
    const user = userEvent.setup();
    renderCanvas();

    await user.click(screen.getAllByLabelText('Add a card to To Do')[0]!);
    await user.type(screen.getByLabelText('New card in To Do'), '   {Enter}');

    expect(createMutate).not.toHaveBeenCalled();
  });

  it('closes the composer on Escape', async () => {
    const user = userEvent.setup();
    renderCanvas();

    await user.click(screen.getAllByLabelText('Add a card to To Do')[0]!);
    expect(screen.getByLabelText('New card in To Do')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('New card in To Do')).not.toBeInTheDocument();
  });

  it('opens ONE composer at a time', async () => {
    const user = userEvent.setup();
    renderCanvas();

    await user.click(screen.getAllByLabelText('Add a card to To Do')[0]!);
    await user.click(screen.getAllByLabelText('Add a card to In Progress')[0]!);

    expect(screen.queryByLabelText('New card in To Do')).not.toBeInTheDocument();
    expect(screen.getByLabelText('New card in In Progress')).toBeInTheDocument();
  });

  it('offers no composer at all to a viewer', () => {
    renderCanvas({ canWrite: false });
    expect(screen.queryByText('Add a card')).not.toBeInTheDocument();
  });
});

describe('BoardCanvas — swimlanes', () => {
  it('stacks a labelled lane per assignee, with the unassigned bucket last', () => {
    renderCanvas({ mode: 'assignee' });

    const lanes = screen
      .getAllByRole('button', { name: /lane$/ })
      .map((button) => button.textContent);

    expect(lanes[0]).toContain('Ada Lovelace');
    expect(lanes[lanes.length - 1]).toContain('Unassigned');
  });

  it('draws the column headers once, above every lane', () => {
    renderCanvas({ mode: 'assignee' });
    // Three statuses, one header each — not one per lane.
    expect(screen.getAllByLabelText(/^Cards: /)).toHaveLength(3);
  });

  it('hides a collapsed lane’s cards but keeps its count', () => {
    renderCanvas({ mode: 'assignee', collapsedLanes: ['assignee:user-ada'] });

    // Ada's two cards are folded away; the unassigned lane still shows its one.
    expect(screen.queryByText('FLOW-1')).not.toBeInTheDocument();
    expect(screen.getByText('FLOW-2')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Expand the Ada Lovelace lane' }),
    ).toBeInTheDocument();
  });
});
