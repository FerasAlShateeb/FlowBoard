// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DndContext } from '@dnd-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { Sprint, Status, TaskSummary } from '@flowboard/shared';

import '@/i18n';
import BacklogSection from '@/components/backlog/BacklogSection';
import SprintSection from '@/components/backlog/SprintSection';
import type { BacklogRowContext } from '@/components/backlog/TaskRowList';

/**
 * The two section shells, rendered against a FIXTURE BUCKET.
 *
 * The data hooks are mocked rather than driven through a `QueryClient`: what is
 * under test here is the section — its header, its chips, its fold, its filter —
 * and a real query client would only add a transport to stub. The hooks
 * themselves are covered by their own suites, and the cache arithmetic by
 * `lib/board-cache.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  useBacklogBucket: vi.fn(),
  updateSprint: vi.fn(),
  createTask: vi.fn(),
  createPending: false,
}));

vi.mock('@/hooks/useTasks', () => ({
  useBacklogBucket: (...args: unknown[]) => mocks.useBacklogBucket(...args) as unknown,
  backlogBucketKey: (projectId: string, sprintId: string | null) => [projectId, sprintId],
}));

vi.mock('@/hooks/useSprints', () => ({
  useUpdateSprint: () => ({ mutate: mocks.updateSprint, isPending: false }),
}));

vi.mock('@/hooks/useTaskMutations', () => ({
  useCreateTask: () => ({ mutate: mocks.createTask, isPending: mocks.createPending }),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const STATUSES: Status[] = [
  {
    id: 'todo',
    projectId: 'p1',
    name: 'To do',
    category: 'todo',
    color: '#3b82f6',
    position: 0,
    wipLimit: null,
  },
  {
    id: 'shipped',
    projectId: 'p1',
    name: 'Shipped',
    category: 'done',
    color: '#22c55e',
    position: 1,
    wipLimit: null,
  },
];

function task(
  id: string,
  number: number,
  title: string,
  points: number | null,
  statusId = 'todo',
): TaskSummary {
  return {
    id,
    number,
    title,
    type: 'story',
    priority: 'medium',
    statusId,
    assignee: null,
    storyPoints: points,
    startDate: null,
    dueDate: null,
    labelIds: [],
    epicId: null,
    parentId: null,
    boardRank: `a${String(number)}`,
    backlogRank: `a${String(number)}`,
    sprintId: null,
    hasDescription: false,
    commentCount: 0,
    attachmentCount: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const ROWS = [task('t1', 1, 'Ship the login screen', 5), task('t2', 2, 'Fix the avatar tint', 3)];

const SPRINT: Sprint = {
  id: 'sp-1',
  projectId: 'p1',
  name: 'Sprint 4',
  goal: 'Get auth out',
  state: 'active',
  startDate: '2026-01-05',
  endDate: '2026-01-19',
  startedAt: '2026-01-05T09:00:00.000Z',
  completedAt: null,
  committedPoints: 8,
  completedPoints: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-05T09:00:00.000Z',
};

const CONTEXT: BacklogRowContext = {
  projectKey: 'FLOW',
  labels: [],
  statuses: STATUSES,
  moveTargets: [],
  canWrite: true,
  onMove: vi.fn(),
};

function bucket(data: TaskSummary[] | undefined, overrides: Record<string, unknown> = {}) {
  return {
    data,
    isPending: data === undefined,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderIn(ui: ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/o/acme/p/FLOW/backlog']}>
      <DndContext>{ui}</DndContext>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createPending = false;
  mocks.useBacklogBucket.mockReturnValue(bucket(ROWS));
});

// Testing Library's automatic cleanup only registers itself when Vitest runs
// with `globals: true`, and this workspace deliberately does not — so the
// unmount is explicit, or every `getBy*` after the first test finds two matches.
afterEach(cleanup);

// ── SprintSection ───────────────────────────────────────────────────────────

describe('SprintSection', () => {
  const props = {
    projectId: 'p1',
    sprint: SPRINT,
    context: CONTEXT,
    isCollapsed: false,
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onStart: vi.fn(),
    onComplete: vi.fn(),
    onDelete: vi.fn(),
  };

  it('renders the sprint, its state and the rows of its bucket', () => {
    renderIn(<SprintSection {...props} />);

    expect(screen.getByText('Sprint 4')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Ship the login screen')).toBeInTheDocument();
    expect(screen.getByText('FLOW-2')).toBeInTheDocument();
  });

  it('sums the bucket into the header chips', () => {
    renderIn(<SprintSection {...props} />);

    expect(screen.getByLabelText('Tasks in this section')).toHaveTextContent('2');
    expect(screen.getByLabelText('Story points in this section')).toHaveTextContent('8 pts');
  });

  it('shows completed points only once something is finished', () => {
    mocks.useBacklogBucket.mockReturnValue(
      bucket([task('t1', 1, 'Done thing', 2, 'shipped'), task('t2', 2, 'Open thing', 1)]),
    );
    renderIn(<SprintSection {...props} />);

    expect(screen.getByLabelText('Completed story points')).toHaveTextContent('2 done');
  });

  it('hides the rows when the section is folded, keeping the header', () => {
    renderIn(<SprintSection {...props} isCollapsed />);

    expect(screen.getByText('Sprint 4')).toBeInTheDocument();
    expect(screen.queryByText('Ship the login screen')).not.toBeInTheDocument();
  });

  it('draws no rows while the bucket is loading', () => {
    mocks.useBacklogBucket.mockReturnValue(bucket(undefined));
    renderIn(<SprintSection {...props} />);

    expect(screen.queryByText('Ship the login screen')).not.toBeInTheDocument();
  });

  it('offers start on a planned sprint and complete on the running one', async () => {
    const user = userEvent.setup();
    renderIn(<SprintSection {...props} />);

    await user.click(screen.getByRole('button', { name: 'Sprint actions' }));
    expect(await screen.findByText('Complete sprint')).toBeInTheDocument();
    expect(screen.queryByText('Start sprint')).not.toBeInTheDocument();
  });
});

// ── BacklogSection ──────────────────────────────────────────────────────────

describe('BacklogSection', () => {
  const props = {
    projectId: 'p1',
    context: CONTEXT,
    isCollapsed: false,
    onToggle: vi.fn(),
  };

  it('narrows the rendered rows with the filter box, by title or key', async () => {
    const user = userEvent.setup();
    renderIn(<BacklogSection {...props} />);

    expect(screen.getByText('Fix the avatar tint')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Filter the backlog'), 'login');

    await waitFor(() => {
      expect(screen.queryByText('Fix the avatar tint')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Ship the login screen')).toBeInTheDocument();
  });

  it('leaves the header chips describing the WHOLE bucket while filtering', async () => {
    const user = userEvent.setup();
    renderIn(<BacklogSection {...props} />);

    await user.type(screen.getByLabelText('Filter the backlog'), 'login');

    expect(screen.getByLabelText('Story points in this section')).toHaveTextContent('8 pts');
  });

  it('creates a backlog task from the quick-add, with every contract default', async () => {
    const user = userEvent.setup();
    renderIn(<BacklogSection {...props} />);

    await user.type(screen.getByLabelText('Add a task to the backlog'), 'Write the changelog');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(mocks.createTask).toHaveBeenCalledTimes(1);
    });
    const [input] = mocks.createTask.mock.calls[0] as [Record<string, unknown>];
    expect(input).toMatchObject({
      title: 'Write the changelog',
      sprintId: null,
      type: 'task',
      priority: 'medium',
      labelIds: [],
    });
  });

  it('does not submit an empty draft', async () => {
    renderIn(<BacklogSection {...props} />);
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('hides the quick-add from a viewer', () => {
    renderIn(<BacklogSection {...props} context={{ ...CONTEXT, canWrite: false }} />);
    expect(screen.queryByLabelText('Add a task to the backlog')).not.toBeInTheDocument();
  });
});

// ── Windowing ───────────────────────────────────────────────────────────────

/**
 * A real backlog is the biggest list in the product and has no page size worth
 * the name (`useBacklogBucket` asks for 100 rows). Every row is a `useSortable`
 * subscription, a dropdown menu, an avatar and several icons, so rendering all
 * of them made first paint — and every drag frame — proportional to the whole
 * backlog instead of to the viewport.
 *
 * These assert the two halves of the fix that can actually regress: the DOM
 * holds a window rather than the bucket, and a small bucket is still rendered
 * whole (windowing a sprint of twelve costs more than it saves, and every other
 * test in this file depends on it).
 */
describe('BacklogSection windowing', () => {
  const props = {
    projectId: 'p1',
    context: CONTEXT,
    isCollapsed: false,
    onToggle: vi.fn(),
  };

  /**
   * jsdom lays nothing out: every element measures 0×0 and there is no
   * `ResizeObserver`, so a virtualizer asked how tall its viewport is would
   * answer "zero" and render an empty window — which would make these tests
   * pass for the wrong reason. Both are supplied here, and only here, so the
   * rest of the file keeps the untouched environment.
   */
  const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          /* the initial measurement below is enough for a fixed-size viewport */
        }
        unobserve() {
          /* no-op */
        }
        disconnect() {
          /* no-op */
        }
      },
    );
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 600,
    });
  });

  afterEach(() => {
    if (realOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight);
    }
    vi.unstubAllGlobals();
  });

  const bigBucket = (size: number) =>
    Array.from({ length: size }, (_, index) =>
      task(`t${String(index)}`, index + 1, `Row number ${String(index)}`, null),
    );

  it('renders a WINDOW of a 500-row bucket, not 500 rows', () => {
    mocks.useBacklogBucket.mockReturnValue(bucket(bigBucket(500)));
    renderIn(<BacklogSection {...props} />);

    const rows = document.querySelectorAll('[data-slot="backlog-row"]');
    expect(rows.length).toBeGreaterThan(0);
    // Generous on purpose: the exact count depends on the measured viewport and
    // the overscan, and pinning it would make this a change-detector. What must
    // hold is that it is a window, by a wide margin.
    expect(rows.length).toBeLessThan(60);
  });

  it('tells a screen reader the size of the WHOLE bucket, not the window', () => {
    mocks.useBacklogBucket.mockReturnValue(bucket(bigBucket(500)));
    renderIn(<BacklogSection {...props} />);

    const first = document.querySelector('[data-slot="backlog-row"]');
    expect(first).toHaveAttribute('aria-setsize', '500');
    expect(first).toHaveAttribute('aria-posinset', '1');
  });

  it('renders a small bucket whole, with no ARIA position bookkeeping', () => {
    // Two rows: the browser lays that out in one pass, and a scroll container
    // plus a spacer would be pure overhead.
    renderIn(<BacklogSection {...props} />);

    const rows = document.querySelectorAll('[data-slot="backlog-row"]');
    expect(rows.length).toBe(ROWS.length);
    expect(rows[0]).not.toHaveAttribute('aria-setsize');
  });

  it('keeps the trailing drop strip outside the scroll viewport', () => {
    mocks.useBacklogBucket.mockReturnValue(bucket(bigBucket(500)));
    const { container } = renderIn(<BacklogSection {...props} />);

    // "Append to the end of this bucket" must be reachable without scrolling
    // to the end of 500 rows, so it is a sibling of the viewport, not a child.
    const viewport = container.querySelector('.overflow-y-auto');
    const strip = container.querySelector('[aria-hidden="true"].h-2');
    expect(viewport).not.toBeNull();
    expect(strip).not.toBeNull();
    expect(viewport?.contains(strip ?? null)).toBe(false);
  });
});
