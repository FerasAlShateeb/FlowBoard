// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SortingState } from '@tanstack/react-table';
import type { Status, TaskSummary } from '@flowboard/shared';

import '@/i18n';
import { TaskDataTable } from '@/components/datatable/TaskDataTable';
import { DEFAULT_COLUMN_ORDER } from '@/components/datatable/table-model';

/**
 * The grid shell: ARIA structure, the sort affordances, roving focus, and the
 * virtualisation switch.
 *
 * WHAT jsdom CAN AND CANNOT TELL US. There is no layout engine, so the
 * virtualiser sees a zero-height scroll container and renders a minimal window.
 * That is enough for the assertion that matters — "a 120-row page does NOT put
 * 120 rows in the DOM" — and it is why the virtualised assertions are about
 * counts and totals rather than about which rows are on screen.
 */

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/**
 * Gives every element a measurable box.
 *
 * jsdom reports zero for `offsetWidth`/`offsetHeight` — which is what
 * `@tanstack/virtual-core` measures the scroll container with — and a
 * virtualiser asked to fill zero pixels correctly renders nothing. Without this
 * the virtualised assertion would pass for the wrong reason ("0 rows is fewer
 * than 120"). Scoped to the test that needs it, and undone by the `afterEach`
 * below.
 */
function withMeasuredViewport(height = 600): () => void {
  const original = {
    height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
    width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  };

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => height,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 1200,
  });

  return () => {
    if (original.height)
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original.height);
    if (original.width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', original.width);
  };
}

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
];

function makeTask(index: number, overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: `t${String(index)}`,
    number: index,
    title: `Task ${String(index)}`,
    type: 'task',
    priority: 'medium',
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

function renderGrid({
  tasks,
  sorting = [],
  onSortingChange = vi.fn(),
  columnVisibility = {},
  totalRowCount,
}: {
  tasks: TaskSummary[];
  sorting?: SortingState;
  onSortingChange?: (updater: unknown) => void;
  columnVisibility?: Record<string, boolean>;
  totalRowCount?: number;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskDataTable
          projectId="p1"
          orgId="o1"
          projectKey="FLOW"
          tasks={tasks}
          isPending={false}
          statuses={STATUSES}
          transitions={[]}
          labels={[]}
          sprints={[]}
          canWrite
          columnOrder={[...DEFAULT_COLUMN_ORDER]}
          columnVisibility={columnVisibility}
          sorting={sorting}
          onSortingChange={onSortingChange}
          rowOffset={0}
          totalRowCount={totalRowCount ?? tasks.length}
          emptyState={<p>Nothing here</p>}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Data rows only — the header row shares the `row` role. */
function dataRows(): HTMLElement[] {
  return screen.getAllByRole('row').filter((row) => row.getAttribute('aria-rowindex') !== '1');
}

describe('grid structure', () => {
  it('exposes a labelled grid whose row count is the SERVER total, not the page', () => {
    renderGrid({ tasks: [makeTask(1), makeTask(2)], totalRowCount: 312 });

    const grid = screen.getByRole('grid', { name: 'Tasks' });
    // +1 for the header row, which is part of the grid's row count.
    expect(grid.getAttribute('aria-rowcount')).toBe('313');
  });

  it('numbers rows by their absolute position, so page 2 does not restart at 1', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TaskDataTable
            projectId="p1"
            orgId="o1"
            projectKey="FLOW"
            tasks={[makeTask(26)]}
            isPending={false}
            statuses={STATUSES}
            transitions={[]}
            labels={[]}
            sprints={[]}
            canWrite
            columnOrder={[...DEFAULT_COLUMN_ORDER]}
            columnVisibility={{}}
            sorting={[]}
            onSortingChange={vi.fn()}
            rowOffset={25}
            totalRowCount={312}
            emptyState={<p>Nothing here</p>}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(dataRows()[0]?.getAttribute('aria-rowindex')).toBe('27');
  });

  it('renders the empty state when the page has no rows', () => {
    renderGrid({ tasks: [] });
    expect(screen.getByText('Nothing here')).not.toBeNull();
  });

  it('omits a hidden column from the DOM entirely', () => {
    renderGrid({ tasks: [makeTask(1)], columnVisibility: { points: false } });

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent ?? '');
    expect(headers.some((text) => text.includes('Points'))).toBe(false);
    expect(headers.some((text) => text.includes('Title'))).toBe(true);
  });

  it('renders a fractional estimate without rounding it', () => {
    renderGrid({ tasks: [makeTask(1, { storyPoints: 0.5 })] });
    expect(screen.getByText('0.5')).not.toBeNull();
  });
});

describe('sorting affordances', () => {
  it('gives a sortable column a button and an explicit aria-sort', () => {
    renderGrid({ tasks: [makeTask(1)] });

    const header = screen
      .getAllByRole('columnheader')
      .find((cell) => cell.textContent?.includes('Due date'));

    expect(header?.getAttribute('aria-sort')).toBe('none');
    expect(header?.querySelector('button')).not.toBeNull();
  });

  it('announces the sorted column and names the ACTION a press performs', () => {
    renderGrid({ tasks: [makeTask(1)], sorting: [{ id: 'dueDate', desc: false }] });

    const header = screen
      .getAllByRole('columnheader')
      .find((cell) => cell.textContent?.includes('Due date'));

    expect(header?.getAttribute('aria-sort')).toBe('ascending');
    // Ascending is set, so the next press is descending.
    expect(header?.textContent).toContain('Sort descending');
  });

  it('gives a column the server cannot sort no control and no aria-sort', () => {
    renderGrid({ tasks: [makeTask(1)] });

    const header = screen
      .getAllByRole('columnheader')
      .find((cell) => cell.textContent?.trim() === 'Type');

    expect(header?.getAttribute('aria-sort')).toBeNull();
    expect(header?.querySelector('button')).toBeNull();
  });

  it('hands a header press straight to the caller, which re-queries the server', async () => {
    const user = userEvent.setup();
    const onSortingChange = vi.fn();
    renderGrid({ tasks: [makeTask(1)], onSortingChange });

    const header = screen
      .getAllByRole('columnheader')
      .find((cell) => cell.textContent?.includes('Due date'));
    await user.click(header?.querySelector('button') as HTMLElement);

    expect(onSortingChange).toHaveBeenCalled();
  });
});

describe('roving focus', () => {
  function activeCell(): HTMLElement | undefined {
    return screen.getAllByRole('gridcell').find((cell) => cell.getAttribute('tabindex') === '0');
  }

  it('puts exactly one tab stop in the whole body', () => {
    renderGrid({ tasks: [makeTask(1), makeTask(2), makeTask(3)] });

    const stops = screen
      .getAllByRole('gridcell')
      .filter((cell) => cell.getAttribute('tabindex') === '0');

    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute('aria-colindex')).toBe('1');
  });

  it('moves the tab stop down a row on ArrowDown', async () => {
    const user = userEvent.setup();
    renderGrid({ tasks: [makeTask(1), makeTask(2), makeTask(3)] });

    // The key column is not editable, so clicking it activates without opening
    // an editor.
    await user.click(activeCell() as HTMLElement);
    await user.keyboard('{ArrowDown}');

    expect(activeCell()?.closest('[role="row"]')?.getAttribute('aria-rowindex')).toBe('3');
  });

  it('moves the tab stop across on ArrowRight', async () => {
    const user = userEvent.setup();
    renderGrid({ tasks: [makeTask(1), makeTask(2)] });

    await user.click(activeCell() as HTMLElement);
    await user.keyboard('{ArrowRight}');

    expect(activeCell()?.getAttribute('aria-colindex')).toBe('2');
  });

  it('clamps at the edges instead of wrapping or losing focus', async () => {
    const user = userEvent.setup();
    renderGrid({ tasks: [makeTask(1), makeTask(2)] });

    await user.click(activeCell() as HTMLElement);
    await user.keyboard('{ArrowUp}{ArrowLeft}');

    expect(activeCell()?.getAttribute('aria-colindex')).toBe('1');
    expect(activeCell()?.closest('[role="row"]')?.getAttribute('aria-rowindex')).toBe('2');
  });

  it('jumps to the end of the row on End', async () => {
    const user = userEvent.setup();
    renderGrid({ tasks: [makeTask(1)] });

    await user.click(activeCell() as HTMLElement);
    await user.keyboard('{End}');

    const columnCount = screen.getAllByRole('columnheader').length;
    expect(activeCell()?.getAttribute('aria-colindex')).toBe(String(columnCount));
  });

  it('opens an editor on Enter over an editable column', async () => {
    const user = userEvent.setup();
    renderGrid({ tasks: [makeTask(1)] });

    await user.click(activeCell() as HTMLElement);
    await user.keyboard('{ArrowRight}{Enter}');

    expect(screen.getByRole('textbox', { name: 'Edit title' })).not.toBeNull();
  });
});

describe('virtualisation', () => {
  it('renders every row when the page is small enough not to need a window', () => {
    renderGrid({ tasks: Array.from({ length: 12 }, (_, index) => makeTask(index + 1)) });
    expect(dataRows()).toHaveLength(12);
  });

  it('renders only a window of a large page', () => {
    const restore = withMeasuredViewport();
    try {
      const tasks = Array.from({ length: 120 }, (_, index) => makeTask(index + 1));
      renderGrid({ tasks });

      const rendered = dataRows();
      // A 600px viewport of 34px rows plus overscan — real rows, but nowhere
      // near all 120 of them.
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.length).toBeLessThan(tasks.length);
    } finally {
      restore();
    }
  });

  it('still announces the full row count while windowing', () => {
    const tasks = Array.from({ length: 120 }, (_, index) => makeTask(index + 1));
    renderGrid({ tasks });

    expect(screen.getByRole('grid').getAttribute('aria-rowcount')).toBe('121');
  });
});
