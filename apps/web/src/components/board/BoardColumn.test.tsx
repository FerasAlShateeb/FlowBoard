// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DndContext } from '@dnd-kit/core';
import type { Label, Status, TaskSummary, Transition } from '@flowboard/shared';

import '@/i18n';
import { checkDrop, type DropCheck } from '@/hooks/useTaskMutations';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BoardCardList, BoardColumnHeader } from '@/components/board/BoardColumn';
import { BoardDragContext, type BoardDragState } from '@/components/board/BoardDndProvider';
import { ALL_LANE } from '@/components/board/swimlanes';

/**
 * The FORBIDDEN-DROP treatment, and the WIP badge that warns before it.
 *
 * Driving this through a real pointer would mean simulating a dnd-kit drag in
 * jsdom, which measures nothing and reports no geometry. The honest unit is the
 * one the column actually consumes: `BoardDragContext`. So the suite computes
 * the verdicts with the REAL `checkDrop` — the rule under test is the workflow
 * rule, and stubbing it would leave nothing worth asserting — and puts the
 * column into the state a drag would have produced.
 */

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(cleanup);

const labelsById = new Map<string, Label>();

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

const TODO = status({ id: 'todo', name: 'To Do' });
const REVIEW = status({ id: 'review', name: 'In Review', category: 'in_progress', wipLimit: 2 });

function task(id: string, statusId: string): TaskSummary {
  return {
    id,
    number: Number(id.replace(/\D/g, '')) || 1,
    title: `Task ${id}`,
    type: 'task',
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
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** A mid-drag state: `dragged` is in the air, `checks` is what each column said. */
function dragging(dragged: TaskSummary, checks: Record<string, DropCheck>): BoardDragState {
  return {
    activeTask: dragged,
    activeDrag: {
      type: 'card',
      taskId: dragged.id,
      statusId: dragged.statusId,
      laneId: ALL_LANE,
    },
    overStatusId: null,
    dropChecks: checks,
  };
}

function renderList(drag: BoardDragState, overStatusId: string | null = null) {
  return render(
    <TooltipProvider>
      <BoardDragContext.Provider value={{ ...drag, overStatusId }}>
        <DndContext>
          <BoardCardList
            statusId={REVIEW.id}
            statusName={REVIEW.name}
            tasks={[task('t9', REVIEW.id), task('t10', REVIEW.id)]}
            projectKey="FLOW"
            labelsById={labelsById}
            onOpen={vi.fn()}
          />
        </DndContext>
      </BoardDragContext.Provider>
    </TooltipProvider>,
  );
}

// ───────────────────────────────────────────────────────────────────────────

describe('BoardCardList — forbidden drops', () => {
  it('is unmarked while nothing is being dragged', () => {
    const { container } = renderList({
      activeTask: null,
      activeDrag: null,
      overStatusId: null,
      dropChecks: {},
    });

    expect(container.querySelector('[data-slot="board-card-list"]')).not.toHaveAttribute(
      'data-drop-blocked',
    );
  });

  it('marks the column when the WORKFLOW refuses the transition', () => {
    // A whitelist that lets `todo` reach only `done` — so `review` is closed.
    const transitions: Transition[] = [
      { id: 'tr1', projectId: 'p1', fromStatusId: 'todo', toStatusId: 'done' },
    ];
    const dragged = task('t1', TODO.id);
    const verdict = checkDrop({
      fromStatusId: TODO.id,
      targetStatus: REVIEW,
      targetCount: 2,
      transitions,
    });

    expect(verdict).toMatchObject({ allowed: false, reason: 'transition' });

    const { container } = renderList(dragging(dragged, { [REVIEW.id]: verdict }));
    const list = container.querySelector('[data-slot="board-card-list"]');

    expect(list).toHaveAttribute('data-drop-blocked', 'true');
    expect(list?.className).toContain('cursor-not-allowed');
    // The tint is `--danger` at low alpha, never a hex literal (checklist §B).
    expect(list?.className).toContain('bg-danger/8');
  });

  it('marks the column when the drop would BREACH the WIP limit', () => {
    // `review` holds 2 of a limit of 2; one more takes it to 3.
    const dragged = task('t1', TODO.id);
    const verdict = checkDrop({
      fromStatusId: TODO.id,
      targetStatus: REVIEW,
      targetCount: 2,
      transitions: [],
    });

    expect(verdict).toMatchObject({ allowed: false, reason: 'wip' });

    const { container } = renderList(dragging(dragged, { [REVIEW.id]: verdict }));
    expect(container.querySelector('[data-slot="board-card-list"]')).toHaveAttribute(
      'data-drop-blocked',
      'true',
    );
  });

  it('spells out WHY, once the blocked column is the one being hovered', () => {
    const verdict = checkDrop({
      fromStatusId: TODO.id,
      targetStatus: REVIEW,
      targetCount: 2,
      transitions: [],
    });

    renderList(dragging(task('t1', TODO.id), { [REVIEW.id]: verdict }), REVIEW.id);

    // A tint says "no"; only the sentence says "why".
    expect(screen.getByText('In Review is already at its limit of 2 cards')).toBeInTheDocument();
  });

  it('stays silent while the blocked column is not the one under the pointer', () => {
    const verdict = checkDrop({
      fromStatusId: TODO.id,
      targetStatus: REVIEW,
      targetCount: 2,
      transitions: [],
    });

    renderList(dragging(task('t1', TODO.id), { [REVIEW.id]: verdict }), 'todo');
    expect(screen.queryByText(/already at its limit/)).not.toBeInTheDocument();
  });

  it('never blocks a SAME-COLUMN reorder, limit or no limit', () => {
    const verdict = checkDrop({
      fromStatusId: REVIEW.id,
      targetStatus: REVIEW,
      targetCount: 2,
      transitions: [{ id: 'tr1', projectId: 'p1', fromStatusId: 'review', toStatusId: 'done' }],
    });

    expect(verdict.allowed).toBe(true);

    const { container } = renderList(dragging(task('t9', REVIEW.id), { [REVIEW.id]: verdict }));
    expect(container.querySelector('[data-slot="board-card-list"]')).not.toHaveAttribute(
      'data-drop-blocked',
    );
  });
});

describe('BoardColumnHeader — the WIP badge', () => {
  function renderHeader(count: number, canWrite = true) {
    return render(
      <TooltipProvider>
        <BoardColumnHeader status={REVIEW} count={count} canWrite={canWrite} />
      </TooltipProvider>,
    );
  }

  it('draws no badge for a column with no limit', () => {
    render(
      <TooltipProvider>
        <BoardColumnHeader status={TODO} count={9} canWrite />
      </TooltipProvider>,
    );
    expect(screen.queryByLabelText(/Work in progress/)).not.toBeInTheDocument();
  });

  it('stays muted while the column is under its limit', () => {
    renderHeader(1);
    expect(screen.getByLabelText(/Work in progress/)).toHaveAttribute('data-wip', 'under');
  });

  it('warns at the limit — one more card would breach it', () => {
    renderHeader(2);
    expect(screen.getByLabelText(/Work in progress/)).toHaveAttribute('data-wip', 'at-limit');
  });

  it('renders an over-limit column rather than refusing to draw it', () => {
    // Reachable without a drop: a limit lowered in the workflow editor, or an
    // import. The number is the truth; the limit is the goal.
    renderHeader(5);
    const badge = screen.getByLabelText(/Work in progress/);
    expect(badge).toHaveAttribute('data-wip', 'over');
    expect(badge).toHaveTextContent('5/2');
  });

  it('hides the quick-add trigger from a viewer', () => {
    renderHeader(1, false);
    expect(screen.queryByLabelText('Add a card to In Review')).not.toBeInTheDocument();
  });
});
