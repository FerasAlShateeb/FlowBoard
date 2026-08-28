// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { Sprint, Status, TaskSummary } from '@flowboard/shared';

import '@/i18n';
import CompleteSprintDialog from '@/components/backlog/CompleteSprintDialog';
import StartSprintDialog from '@/components/backlog/StartSprintDialog';

/**
 * The two dialogs that STAMP A NUMBER.
 *
 * Both are covered for the same reason: `committedPoints` and `completedPoints`
 * are written once and never recomputed, so the figure the dialog shows is the
 * only chance anyone has to notice it is wrong — and `moveIncompleteTo` decides
 * where a sprint's leftovers land, which is unrecoverable in the other
 * direction.
 */

/**
 * jsdom ships no `ResizeObserver`, and Radix's radio indicator measures itself
 * with one on mount. A no-op is enough — nothing here asserts on a size — and it
 * lives in this file rather than in the shared setup, which serves the
 * DOM-free suites and should not grow a DOM shim for them.
 */
class ResizeObserverStub {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const mocks = vi.hoisted(() => ({
  useBacklogBucket: vi.fn(),
  startSprint: vi.fn(),
  completeSprint: vi.fn(),
}));

vi.mock('@/hooks/useTasks', () => ({
  useBacklogBucket: (...args: unknown[]) => mocks.useBacklogBucket(...args) as unknown,
  backlogBucketKey: (projectId: string, sprintId: string | null) => [projectId, sprintId],
}));

vi.mock('@/hooks/useSprints', () => ({
  useStartSprint: () => ({ mutate: mocks.startSprint, isPending: false }),
  useCompleteSprint: () => ({ mutate: mocks.completeSprint, isPending: false }),
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

function task(id: string, number: number, points: number | null, statusId: string): TaskSummary {
  return {
    id,
    number,
    title: `Task ${String(number)}`,
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
    boardRank: 'a0',
    backlogRank: 'a0',
    sprintId: 'sp-1',
    hasDescription: false,
    commentCount: 0,
    attachmentCount: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** A real uuid: `completeSprintInputSchema` refuses anything else. */
const PLANNED_ID = '11111111-1111-4111-8111-111111111111';

function sprint(overrides: Partial<Sprint> = {}): Sprint {
  return {
    id: 'sp-1',
    projectId: 'p1',
    name: 'Sprint 4',
    goal: null,
    state: 'planned',
    startDate: '2026-02-02',
    endDate: '2026-02-15',
    startedAt: null,
    completedAt: null,
    committedPoints: null,
    completedPoints: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

// ── Start ───────────────────────────────────────────────────────────────────

describe('StartSprintDialog', () => {
  beforeEach(() => {
    mocks.useBacklogBucket.mockReturnValue({
      data: [task('t1', 1, 5, 'todo'), task('t2', 2, 3, 'todo'), task('t3', 3, null, 'todo')],
      isPending: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('summarizes the scope that is about to be committed', () => {
    render(
      <StartSprintDialog
        projectId="p1"
        sprint={sprint()}
        statuses={STATUSES}
        open
        onOpenChange={vi.fn()}
      />,
    );

    const scope = screen.getByText('Committed scope').closest('[data-slot="start-scope"]');
    expect(scope).not.toBeNull();
    // Three rows, one of them unestimated — present in the count, absent from
    // the points.
    expect(within(scope as HTMLElement).getByText('3')).toBeInTheDocument();
    expect(within(scope as HTMLElement).getByText('8')).toBeInTheDocument();
  });

  it('says so plainly when there is nothing to commit', () => {
    mocks.useBacklogBucket.mockReturnValue({
      data: [],
      isPending: false,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <StartSprintDialog
        projectId="p1"
        sprint={sprint()}
        statuses={STATUSES}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/no work in it yet/i)).toBeInTheDocument();
  });

  it('prefills the sprint’s planned dates and sends them as `YYYY-MM-DD`', async () => {
    const user = userEvent.setup();
    render(
      <StartSprintDialog
        projectId="p1"
        sprint={sprint()}
        statuses={STATUSES}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Start date')).toHaveValue('2026-02-02');
    expect(screen.getByLabelText('End date')).toHaveValue('2026-02-15');

    await user.click(screen.getByRole('button', { name: 'Start sprint' }));

    await waitFor(() => {
      expect(mocks.startSprint).toHaveBeenCalledTimes(1);
    });
    const [payload] = mocks.startSprint.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      sprintId: 'sp-1',
      startDate: '2026-02-02',
      endDate: '2026-02-15',
    });
  });
});

// ── Complete ────────────────────────────────────────────────────────────────

describe('CompleteSprintDialog', () => {
  const planned = [sprint({ id: PLANNED_ID, name: 'Sprint 5' })];

  beforeEach(() => {
    mocks.useBacklogBucket.mockReturnValue({
      data: [task('t1', 1, 2, 'shipped'), task('t2', 2, 3, 'todo'), task('t3', 3, 1, 'todo')],
      isPending: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  function renderDialog() {
    return render(
      <CompleteSprintDialog
        projectId="p1"
        sprint={sprint({ state: 'active' })}
        statuses={STATUSES}
        plannedSprints={planned}
        open
        onOpenChange={vi.fn()}
      />,
    );
  }

  it('splits the sprint into done and not-done, in counts and points', () => {
    renderDialog();

    expect(screen.getByText('Done').nextSibling).toHaveTextContent('1 · 2');
    expect(screen.getByText('Not done').nextSibling).toHaveTextContent('2 · 4');
  });

  it('defaults to the backlog and sends that literal', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Complete sprint' }));

    await waitFor(() => {
      expect(mocks.completeSprint).toHaveBeenCalledTimes(1);
    });
    expect(mocks.completeSprint.mock.calls[0]?.[0]).toMatchObject({
      sprintId: 'sp-1',
      moveIncompleteTo: 'backlog',
    });
  });

  it('sends the chosen planned sprint’s id instead', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('radio', { name: 'Sprint 5' }));
    await user.click(screen.getByRole('button', { name: 'Complete sprint' }));

    await waitFor(() => {
      expect(mocks.completeSprint).toHaveBeenCalledTimes(1);
    });
    expect(mocks.completeSprint.mock.calls[0]?.[0]).toMatchObject({
      moveIncompleteTo: PLANNED_ID,
    });
  });

  it('offers only the backlog when there is no planned sprint to move work into', () => {
    render(
      <CompleteSprintDialog
        projectId="p1"
        sprint={sprint({ state: 'active' })}
        statuses={STATUSES}
        plannedSprints={[]}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });
});
