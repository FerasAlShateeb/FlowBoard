// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Label, TaskSummary } from '@flowboard/shared';

import '@/i18n';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BoardCardFace, taskKeyOf } from '@/components/board/BoardCard';

/**
 * The card's RENDERING contract — the three things a dense card gets wrong
 * most often: a fractional estimate rounded away, an overdue date that is not
 * flagged, and an overdue date that is flagged on work that is already done.
 *
 * `BoardCardFace` rather than `BoardCard`: the face is the pixels, and testing
 * it needs no `DndContext`, no sortable id and no drag state.
 */

const LABELS: Label[] = [
  { id: 'label-a', projectId: 'p1', name: 'backend', color: '#3b82f6' },
  { id: 'label-b', projectId: 'p1', name: 'urgent', color: '#ef4444' },
  { id: 'label-c', projectId: 'p1', name: 'ui', color: '#10b981' },
  { id: 'label-d', projectId: 'p1', name: 'infra', color: '#f59e0b' },
];

const labelsById = new Map(LABELS.map((label) => [label.id, label]));

// Testing Library only auto-registers its cleanup when Vitest runs with
// `globals: true`, and this workspace deliberately does not (see
// `vitest.config.ts`). Without this, every render stacks in one document and
// `getBy*` starts finding the previous test's card.
afterEach(cleanup);

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 'task-1',
    number: 142,
    title: 'Refresh the session before the socket handshake',
    type: 'bug',
    priority: 'high',
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

function renderFace(overrides: Partial<TaskSummary> = {}, resolved = false) {
  return render(
    <TooltipProvider>
      <BoardCardFace
        task={task(overrides)}
        projectKey="FLOW"
        labelsById={labelsById}
        resolved={resolved}
      />
    </TooltipProvider>,
  );
}

describe('taskKeyOf', () => {
  it('composes the key a human reads from the project key and the number', () => {
    expect(taskKeyOf('FLOW', { number: 142 })).toBe('FLOW-142');
  });
});

describe('BoardCardFace', () => {
  it('renders the key and the title', () => {
    renderFace();
    expect(screen.getByText('FLOW-142')).toBeInTheDocument();
    expect(screen.getByText('Refresh the session before the socket handshake')).toBeInTheDocument();
  });

  it('renders a fractional estimate as itself', () => {
    renderFace({ storyPoints: 0.5 });
    expect(screen.getByLabelText('Story points: 0.5')).toHaveTextContent('0.5');
  });

  it('renders a zero estimate rather than hiding the chip', () => {
    renderFace({ storyPoints: 0 });
    expect(screen.getByLabelText('Story points: 0')).toBeInTheDocument();
  });

  it('draws no points chip at all when the task is unestimated', () => {
    renderFace({ storyPoints: null });
    expect(screen.queryByLabelText(/Story points/)).not.toBeInTheDocument();
  });

  it('flags a past due date as overdue, on the chip and on the card', () => {
    const { container } = renderFace({ dueDate: '2020-01-02' });
    expect(screen.getByLabelText(/^Overdue/)).toBeInTheDocument();
    // The card carries the state as data, so the column can style around it.
    expect(container.querySelector('[data-slot="board-card"]')).toHaveAttribute(
      'data-overdue',
      'true',
    );
  });

  it('does NOT flag a past due date on a resolved card', () => {
    // The work happened; a column of red on a finished board is noise.
    renderFace({ dueDate: '2020-01-02' }, true);
    expect(screen.queryByLabelText(/^Overdue/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Due /)).toBeInTheDocument();
  });

  it('shows at most three label dots and folds the rest into a counter', () => {
    renderFace({ labelIds: ['label-a', 'label-b', 'label-c', 'label-d'] });
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByLabelText('Labels: backend, urgent, ui, infra')).toBeInTheDocument();
  });

  it('names the assignee, and says so when there is none', () => {
    renderFace({ assignee: { id: 'user-a', name: 'Ada Lovelace', avatarUrl: null } });
    expect(screen.getByLabelText('Assigned to Ada Lovelace')).toBeInTheDocument();
  });

  it('renders the unassigned placeholder rather than an empty circle', () => {
    renderFace();
    expect(screen.getByLabelText('Nobody is assigned')).toBeInTheDocument();
  });

  it('labels the type and priority glyphs for a screen reader', () => {
    renderFace({ type: 'bug', priority: 'highest' });
    expect(screen.getByLabelText('Type: Bug')).toBeInTheDocument();
    expect(screen.getByLabelText('Priority: Highest')).toBeInTheDocument();
  });

  it('shows the comment and attachment counters only when there are any', () => {
    renderFace({ commentCount: 3, attachmentCount: 0, hasDescription: true });
    expect(screen.getByLabelText('Comments: 3')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Attachments/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Has a description')).toBeInTheDocument();
  });
});
