// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Status, TaskSummary } from '@flowboard/shared';

import '@/i18n';
import { TooltipProvider } from '@/components/ui/tooltip';
import { addDays, todayDay } from '@/components/gantt/useGanttGeometry';
import GanttChart from '@/components/gantt/GanttChart';

/**
 * Component smoke tests for the roadmap.
 *
 * The GEOMETRY is covered exhaustively in `useGanttGeometry.test.ts`, the row
 * model in `gantt-rows.test.ts`, the date arithmetic of a drag in
 * `gantt-drag.test.ts` and the arrow routing in `gantt-arrows.test.ts` — all in
 * the DOM-free default environment. What is left for jsdom is only what genuinely
 * needs a document: that the two panes render the same rows, that the RTL island
 * is where it should be, that the disclosure and the zoom control work, and that
 * the "schedule" affordance sends the PATCH the pure code computed.
 *
 * `useGanttDependencies` is mocked out: it is a network hook whose OUTPUT
 * (`DependencyEdge[]`) is already exercised through `gantt-arrows.test.ts`, and
 * its own fetch is covered by `useGanttDependencies.test.ts`.
 */

vi.mock('@/components/gantt/useGanttDependencies', () => ({
  useGanttDependencies: () => ({ edges: [], isFetching: false }),
}));

const patch = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      patch: (path: string, body?: unknown) => {
        patch(path, body);
        return Promise.resolve({});
      },
    },
  };
});

/** The viewport the stubbed layout reports — wide enough for a real window. */
const VIEWPORT = { width: 1200, height: 640 };

/**
 * jsdom implements none of the three browser capabilities the chart leans on.
 *
 * 1. **Layout.** jsdom reports `offsetWidth`/`offsetHeight` as 0 for every
 *    element, and `@tanstack/virtual-core` bails out with an empty range the
 *    moment its scroll element measures zero (`calculateRange`: "outerSize
 *    === 0 → range = null"). Without a size stub the virtualizer renders NO
 *    rows and every assertion below fails for a reason that has nothing to do
 *    with the component.
 * 2. **`ResizeObserver`**, which is how the virtualizer subscribes to that size
 *    and how Radix positions a popper.
 * 3. **Pointer capture**, which `GanttBar` uses to keep a drag attached to the
 *    bar it started on.
 *
 * All three are stubbed rather than emulated: these tests assert on the DOM
 * React produces, never on the APIs themselves.
 */
beforeAll(() => {
  for (const [property, value] of [
    ['offsetWidth', VIEWPORT.width],
    ['offsetHeight', VIEWPORT.height],
    ['clientWidth', VIEWPORT.width],
    ['clientHeight', VIEWPORT.height],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get: () => value,
    });
  }

  const globals = globalThis as typeof globalThis & { ResizeObserver?: unknown };
  globals.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  Element.prototype.setPointerCapture ??= function setPointerCapture() {};
  Element.prototype.releasePointerCapture ??= function releasePointerCapture() {};
  Element.prototype.hasPointerCapture ??= function hasPointerCapture() {
    return false;
  };
  Element.prototype.scrollTo ??= function scrollTo() {};
});

// Testing Library's auto-cleanup only runs when its globals are installed; this
// suite opts in explicitly so a leftover tree cannot leak into the next test.
afterEach(() => {
  cleanup();
  patch.mockClear();
});

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

const TODO_STATUS = '11111111-1111-1111-1111-111111111111';
const DONE_STATUS = '22222222-2222-2222-2222-222222222222';

const STATUSES: Status[] = [
  {
    id: TODO_STATUS,
    projectId: 'p1',
    name: 'To do',
    category: 'todo',
    color: '#334155',
    position: 0,
    wipLimit: null,
  },
  {
    id: DONE_STATUS,
    projectId: 'p1',
    name: 'Done',
    category: 'done',
    color: '#15803d',
    position: 1,
    wipLimit: null,
  },
];

const TODAY = todayDay();

let sequence = 0;

function task(overrides: Partial<TaskSummary> & { id: string; title: string }): TaskSummary {
  sequence += 1;
  return {
    number: sequence,
    type: 'task',
    priority: 'medium',
    statusId: TODO_STATUS,
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

function fixtureTasks(): TaskSummary[] {
  sequence = 0;
  return [
    task({ id: 'epic-1', title: 'Checkout revamp', type: 'epic' }),
    task({
      id: 'child-1',
      title: 'Payment provider spike',
      epicId: 'epic-1',
      startDate: TODAY,
      dueDate: addDays(TODAY, 4),
    }),
    task({
      id: 'child-2',
      title: 'Cart totals',
      epicId: 'epic-1',
      statusId: DONE_STATUS,
      startDate: addDays(TODAY, 6),
      dueDate: addDays(TODAY, 9),
    }),
    task({ id: 'sub-1', title: 'A subtask', type: 'subtask', parentId: 'child-1' }),
    task({
      id: 'loose-1',
      title: 'Rotate API keys',
      startDate: addDays(TODAY, 2),
      dueDate: addDays(TODAY, 3),
    }),
    task({ id: 'loose-2', title: 'Unplanned cleanup' }),
  ];
}

function renderChart(options: { tasks?: TaskSummary[]; canWrite?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/o/acme/p/FLOW/roadmap']}>
        <TooltipProvider>{children}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return render(
    <GanttChart
      projectId="p1"
      projectKeyParam="FLOW"
      projectKey="FLOW"
      orgSlug="acme"
      tasks={options.tasks ?? fixtureTasks()}
      statuses={STATUSES}
      canWrite={options.canWrite ?? true}
      truncated={false}
    />,
    { wrapper },
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe('GanttChart', () => {
  beforeEach(() => {
    sequence = 0;
  });

  it('renders a sidebar row per task, with the epic first and its child under it', () => {
    renderChart();
    const sidebar = screen.getByTestId('gantt-sidebar');

    expect(within(sidebar).getByText('Checkout revamp')).toBeInTheDocument();
    expect(within(sidebar).getByText('Payment provider spike')).toBeInTheDocument();
    expect(within(sidebar).getByText('Rotate API keys')).toBeInTheDocument();
  });

  it('groups the tasks with no epic under a "No epic" header', () => {
    renderChart();
    expect(screen.getByText('No epic')).toBeInTheDocument();
  });

  it('keeps subtasks out of the rows and counts them on their parent instead', () => {
    renderChart();
    const sidebar = screen.getByTestId('gantt-sidebar');
    expect(within(sidebar).queryByText('A subtask')).not.toBeInTheDocument();
    // Two badges, not one: the count lands on the parent task AND rolls up to
    // the epic above it, which is what makes a collapsed epic still honest.
    expect(within(sidebar).getAllByTitle('Subtasks: 1')).toHaveLength(2);
  });

  it('draws a bar for every dated row and none for the undated one', () => {
    renderChart();
    const bars = screen.getAllByTestId('gantt-bar');
    const ids = bars.map((bar) => bar.getAttribute('data-task-id'));

    // The epic rolls up from its two dated children, so it gets a bar too.
    expect(ids).toContain('epic-1');
    expect(ids).toContain('child-1');
    expect(ids).toContain('loose-1');
    expect(ids).not.toContain('loose-2');
  });

  it('offers the "add dates" affordance only on an undated row', () => {
    renderChart();
    const schedulers = screen.getAllByTestId('gantt-schedule');
    expect(schedulers).toHaveLength(1);
  });

  it('hides the "add dates" affordance from a viewer', () => {
    renderChart({ canWrite: false });
    expect(screen.queryByTestId('gantt-schedule')).not.toBeInTheDocument();
  });

  it('seeds today → today + 3 days when the affordance is used', async () => {
    const user = userEvent.setup();
    renderChart();

    await user.click(screen.getByTestId('gantt-schedule'));

    expect(patch).toHaveBeenCalledWith('/tasks/loose-2', {
      startDate: TODAY,
      dueDate: addDays(TODAY, 3),
    });
  });

  it('collapses an epic, hiding its children but keeping the epic row', async () => {
    const user = userEvent.setup();
    renderChart();
    const sidebar = screen.getByTestId('gantt-sidebar');

    expect(within(sidebar).getByText('Payment provider spike')).toBeInTheDocument();

    await user.click(
      within(sidebar).getAllByRole('button', { name: 'Collapse' })[0] as HTMLElement,
    );

    expect(within(sidebar).getByText('Checkout revamp')).toBeInTheDocument();
    expect(within(sidebar).queryByText('Payment provider spike')).not.toBeInTheDocument();
  });

  it('nudges a focused bar by one day with an arrow key', async () => {
    const user = userEvent.setup();
    renderChart();

    const bar = screen
      .getAllByTestId('gantt-bar')
      .find((element) => element.getAttribute('data-task-id') === 'loose-1');
    expect(bar).toBeDefined();

    bar?.focus();
    await user.keyboard('{ArrowRight}');

    expect(patch).toHaveBeenCalledWith('/tasks/loose-1', {
      startDate: addDays(TODAY, 3),
      dueDate: addDays(TODAY, 4),
    });
  });

  it('resizes rather than moves when Shift is held', async () => {
    const user = userEvent.setup();
    renderChart();

    const bar = screen
      .getAllByTestId('gantt-bar')
      .find((element) => element.getAttribute('data-task-id') === 'loose-1');
    bar?.focus();
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');

    // Only the END moved: the bar got one day longer.
    expect(patch).toHaveBeenCalledWith('/tasks/loose-1', {
      startDate: addDays(TODAY, 2),
      dueDate: addDays(TODAY, 4),
    });
  });

  it('does not let a viewer nudge a bar', async () => {
    const user = userEvent.setup();
    renderChart({ canWrite: false });

    const bar = screen
      .getAllByTestId('gantt-bar')
      .find((element) => element.getAttribute('data-task-id') === 'loose-1');
    bar?.focus();
    await user.keyboard('{ArrowRight}');

    expect(patch).not.toHaveBeenCalled();
  });

  it('makes the canvas an explicit dir="ltr" island and leaves the sidebar alone', () => {
    renderChart();
    expect(screen.getByTestId('gantt-canvas')).toHaveAttribute('dir', 'ltr');
    // The sidebar must NOT pin a direction — it inherits the page's.
    expect(screen.getByTestId('gantt-sidebar-scroll')).not.toHaveAttribute('dir');
  });

  it('switches zoom through the segmented control', async () => {
    const user = userEvent.setup();
    renderChart();

    expect(screen.getByTestId('gantt-zoom-month')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByTestId('gantt-zoom-week'));

    expect(screen.getByTestId('gantt-zoom-week')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('gantt-zoom-month')).toHaveAttribute('aria-pressed', 'false');
  });

  it('draws the today line, because today is inside the derived range', () => {
    renderChart();
    expect(screen.getByTestId('gantt-today-line')).toBeInTheDocument();
    expect(screen.getByTestId('gantt-today')).toBeEnabled();
  });

  it('explains itself when nothing carries a date, and offers a way out', () => {
    renderChart({
      tasks: [task({ id: 'a', title: 'One' }), task({ id: 'b', title: 'Two' })],
    });

    expect(screen.getByText('Nothing is scheduled yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schedule the first task' })).toBeInTheDocument();
    expect(screen.queryAllByTestId('gantt-bar')).toHaveLength(0);
  });

  it('toggles the dependency layer off and on', async () => {
    const user = userEvent.setup();
    renderChart();

    const toggle = screen.getByTestId('gantt-dependencies-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});
