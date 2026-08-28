// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { ProjectDetail } from '@flowboard/shared';

import { useAuthStore } from '@/stores/useAuthStore';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';
import {
  ACTIVITY,
  ADA,
  ATTACHMENTS,
  COMMENTS,
  GRACE,
  IDS,
  LABELS,
  SPRINTS,
  STATUSES,
  makeSummary,
  makeTask,
  renderWithProviders,
} from '@/components/tasks/__tests__/test-utils';

/**
 * The whole panel, wired to REAL hooks over a stubbed transport.
 *
 * ── Why `@/lib/api` and not the hooks ───────────────────────────────────────
 *
 * Mocking eleven hook modules would leave this suite asserting that the panel
 * calls the mocks it was handed. Replacing the ONE module that talks to the
 * network instead means the genuine hooks run: the real query keys, the real
 * `enabled` gates, the real invalidation. What is stubbed is the only thing
 * jsdom cannot provide — a server.
 *
 * `importOriginal` keeps `ApiError` and the error codes intact, because
 * `i18n/errors` imports them and a bare factory would strip them.
 */

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  paged: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: transport };
});

const PROJECT: ProjectDetail = {
  id: IDS.project,
  orgId: IDS.org,
  key: 'FLOW',
  name: 'FlowBoard',
  description: null,
  teamId: null,
  leadId: null,
  lead: null,
  role: 'member',
  statuses: STATUSES,
  labels: LABELS,
  memberCount: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SUBTASK = makeSummary();
const EPIC = makeSummary({ id: IDS.epic, number: 5, type: 'epic', title: 'Ranking overhaul' });
const OTHER = makeSummary({
  id: IDS.blocker,
  number: 7,
  type: 'task',
  title: 'Pick a rank alphabet',
  parentId: null,
});

/** Routes a stubbed GET by path and query — the shape `lib/api` really takes. */
function route(path: string, options?: { query?: Record<string, unknown> }): unknown {
  const query = options?.query ?? {};

  if (path === `/projects/${IDS.project}`) return PROJECT;
  if (path === `/projects/${IDS.project}/transitions`) return [];
  if (path === `/projects/${IDS.project}/sprints`) return SPRINTS;
  if (path === `/projects/${IDS.project}/labels`) return LABELS;
  if (path === `/tasks/${IDS.task}/comments`) return COMMENTS;
  if (path === `/tasks/${IDS.task}/attachments`) return ATTACHMENTS;
  if (path === `/orgs/${IDS.org}/users`) {
    return [
      { user: ADA, email: 'ada@flowboard.dev', role: 'member' },
      { user: GRACE, email: 'grace@flowboard.dev', role: 'admin' },
    ];
  }
  if (path === `/projects/${IDS.project}/tasks`) {
    // ONE endpoint, two questions: the panel asks for the project's tasks
    // (pickers, parent link) and for this task's children.
    return query.parentId === IDS.task ? [SUBTASK] : [SUBTASK, EPIC, OTHER];
  }
  return [];
}

beforeEach(() => {
  transport.get.mockImplementation((path: string, options?: { query?: Record<string, unknown> }) =>
    Promise.resolve(route(path, options)),
  );
  transport.paged.mockImplementation((path: string) =>
    path === `/tasks/${IDS.task}/activity`
      ? Promise.resolve({
          data: ACTIVITY,
          meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        })
      : Promise.resolve({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
  );
  transport.patch.mockImplementation(() => Promise.resolve(makeTask()));
  transport.post.mockImplementation(() => Promise.resolve(makeTask()));
  transport.del.mockImplementation(() => Promise.resolve(undefined));

  // The panel reads "who am I" for the own-comment and own-attachment checks.
  useAuthStore.setState({
    user: {
      id: IDS.grace,
      email: 'grace@flowboard.dev',
      name: 'Grace Hopper',
      avatarUrl: null,
      isGlobalAdmin: false,
      locale: 'en',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPanel(overrides: Partial<Parameters<typeof TaskDetailPanel>[0]> = {}) {
  const onOpenTask = vi.fn();
  const onClose = vi.fn();

  const result = renderWithProviders(
    <TaskDetailPanel
      task={makeTask()}
      orgId={IDS.org}
      projectId={IDS.project}
      projectKey="FLOW"
      role="member"
      taskUrl="https://flowboard.test/o/acme/p/FLOW/board/t/FLOW-142"
      onOpenTask={onOpenTask}
      onClose={onClose}
      {...overrides}
    />,
  );

  return { ...result, onOpenTask, onClose };
}

describe('TaskDetailPanel', () => {
  it('renders every section of a fully populated task', async () => {
    renderPanel();

    // Identity + title.
    expect(screen.getByText('FLOW-142')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rebalance fractional ranks' })).toBeInTheDocument();

    // Description, rendered as markdown with the mention as a chip.
    const description = await screen.findByText(/Ranks grow without bound/u);
    expect(description).toBeInTheDocument();
    expect(document.querySelector('[data-slot="mention"]')).toHaveTextContent('@Ada Lovelace');

    // Fields sidebar. Scoped to the aside, because "Grace Hopper" is also the
    // comment author further down the panel.
    expect(await screen.findByRole('spinbutton', { name: 'Story points' })).toHaveValue(3);
    const sidebar = within(screen.getByRole('complementary', { name: 'Details' }));
    expect(sidebar.getByText('Grace Hopper')).toBeInTheDocument();
    // Twice, and correctly so: once as the picker's summary line, once as the
    // chip beneath it.
    expect(sidebar.getAllByText('backend')).toHaveLength(2);

    // Subtasks — with the progress arithmetic on screen.
    expect(await screen.findByText('Write the rebalance migration')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 done')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Subtasks' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );

    // Dependencies, in the direction the fixture declares.
    expect(screen.getByText('Blocked by')).toBeInTheDocument();
    expect(screen.getByText('Pick a rank alphabet')).toBeInTheDocument();

    // Attachments.
    expect(await screen.findByText('rank-growth.pdf')).toBeInTheDocument();
    expect(screen.getByText(/1\.5 KB/u)).toBeInTheDocument();

    // Comments are the DEFAULT tab.
    expect(await screen.findByText(/Agreed — ping/u)).toBeInTheDocument();
  });

  it('shows a skeleton-free empty state for a task with nothing on it', async () => {
    transport.get.mockImplementation((path: string) =>
      Promise.resolve(
        path === `/projects/${IDS.project}` ? PROJECT : path.endsWith('/labels') ? LABELS : [],
      ),
    );

    renderPanel({
      task: makeTask({
        description: null,
        labels: [],
        dependencies: { blockers: [], blocked: [] },
        subtaskIds: [],
        commentCount: 0,
      }),
    });

    expect(await screen.findByText('No subtasks yet.')).toBeInTheDocument();
    expect(await screen.findByText('No files attached.')).toBeInTheDocument();
    expect(await screen.findByText('Add a description')).toBeInTheDocument();
  });

  it('switches to the Activity tab and renders one sentence per row', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('tab', { name: 'Activity' }));

    // The id → name lookup resolved both status uuids out of the workflow.
    expect(
      await screen.findByText('Ada Lovelace moved this from To Do to In Progress'),
    ).toBeInTheDocument();
    // A system row (`actor: null`) still renders, named after the product.
    expect(screen.getByText('FlowBoard created this task')).toBeInTheDocument();
    // Two rows, one page: no "Load more".
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('offers "Load more" only while the stream has another page', async () => {
    transport.paged.mockImplementation(() =>
      Promise.resolve({
        data: ACTIVITY,
        meta: { page: 1, pageSize: 20, total: 40, totalPages: 2 },
      }),
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(await screen.findByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('PATCHes the description through the shared mutation', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Edit description' }));
    const editor = screen.getByRole('combobox', { name: 'Description' });
    await user.clear(editor);
    await user.type(editor, 'Rewritten.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(transport.patch).toHaveBeenCalledWith(
        `/tasks/${IDS.task}`,
        { description: 'Rewritten.' },
        expect.anything(),
      );
    });
  });

  it('quick-adds a subtask with parentId and the parent’s sprint', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(
      await screen.findByRole('textbox', { name: 'Add a subtask' }),
      'Backfill ranks',
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(transport.post).toHaveBeenCalledWith(
        `/projects/${IDS.project}/tasks`,
        expect.objectContaining({
          title: 'Backfill ranks',
          type: 'subtask',
          parentId: IDS.task,
          // Splitting a story across sprints is a decision, not a default.
          sprintId: IDS.sprint,
        }),
        expect.anything(),
      );
    });
  });

  it('navigates the sheet to a subtask by KEY', async () => {
    const user = userEvent.setup();
    const { onOpenTask } = renderPanel();

    await user.click(await screen.findByRole('button', { name: /Write the rebalance migration/u }));
    expect(onOpenTask).toHaveBeenCalledWith('FLOW-143');
  });

  it('replaces the subtask list with a PARENT link on a subtask', async () => {
    renderPanel({ task: makeTask({ type: 'subtask', parentId: IDS.blocker }) });

    expect(await screen.findByText('Parent')).toBeInTheDocument();
    expect(screen.queryByText('Subtasks')).not.toBeInTheDocument();
    // A subtask cannot have subtasks, so the quick-add must not be offered.
    expect(screen.queryByRole('textbox', { name: 'Add a subtask' })).not.toBeInTheDocument();
  });

  it('adds a dependency in the direction the button names', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Add a blocked task' }));
    await user.click(await screen.findByText('Ranking overhaul'));

    await waitFor(() => {
      expect(transport.post).toHaveBeenCalledWith(
        `/tasks/${IDS.task}/dependencies`,
        // "This task blocks that one" — the direction lives in the BODY, never
        // in which task the POST is addressed to.
        { blockedTaskId: IDS.epic },
        expect.anything(),
      );
    });
  });

  it('excludes already-linked tasks from the dependency picker', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Add a blocker' }));

    // FLOW-7 is already a blocker; the pair is unique, so offering it again
    // would be offering a request that can only fail.
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).queryByText('Pick a rank alphabet')).not.toBeInTheDocument();
    expect(within(listbox).getByText('Ranking overhaul')).toBeInTheDocument();
  });

  it('posts a comment and clears the composer', async () => {
    const user = userEvent.setup();
    transport.post.mockImplementation(() => Promise.resolve(COMMENTS[0]));
    renderPanel();

    const composer = await screen.findByRole('combobox', { name: 'Comments' });
    await user.type(composer, 'Looks right to me');
    await user.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => {
      expect(transport.post).toHaveBeenCalledWith(
        `/tasks/${IDS.task}/comments`,
        { body: 'Looks right to me' },
        expect.anything(),
      );
    });
    await waitFor(() => {
      expect(composer).toHaveValue('');
    });
  });

  it('lets the AUTHOR edit their own comment and nobody else', async () => {
    renderPanel();

    // The signed-in fixture user IS the comment's author.
    expect(await screen.findByRole('button', { name: 'Edit comment' })).toBeInTheDocument();

    cleanup();
    useAuthStore.setState({ user: null });
    renderPanel();

    await screen.findByText(/Agreed — ping/u);
    expect(screen.queryByRole('button', { name: 'Edit comment' })).not.toBeInTheDocument();
  });

  it('hides every write affordance from a VIEWER', async () => {
    renderPanel({ role: 'viewer' });

    await screen.findByText(/Ranks grow without bound/u);

    expect(screen.queryByRole('button', { name: 'Edit description' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add a subtask' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a blocker' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Comment' })).not.toBeInTheDocument();
    // The dropzone is a write affordance too.
    expect(screen.queryByText('browse')).not.toBeInTheDocument();
  });

  it('closes the sheet after a successful delete', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete task' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(transport.del).toHaveBeenCalledWith(`/tasks/${IDS.task}`);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
