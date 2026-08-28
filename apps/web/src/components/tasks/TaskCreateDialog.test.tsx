// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { ProjectDetail } from '@flowboard/shared';

import { TaskCreateDialog } from '@/components/tasks/TaskCreateDialog';
import {
  ADA,
  IDS,
  LABELS,
  SPRINTS,
  STATUSES,
  makeTask,
  renderWithProviders,
} from '@/components/tasks/__tests__/test-utils';

/**
 * The exported create dialog.
 *
 * It is used by NOBODY in this work package — the board, the backlog and the
 * command palette each mount it in a later one — which is exactly why it needs
 * a suite of its own: nothing else would notice if the payload it submits
 * drifted from `createTaskInputSchema`.
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

beforeEach(() => {
  transport.get.mockImplementation((path: string) => {
    if (path === `/projects/${IDS.project}`) return Promise.resolve(PROJECT);
    if (path === `/projects/${IDS.project}/sprints`) return Promise.resolve(SPRINTS);
    if (path === `/projects/${IDS.project}/labels`) return Promise.resolve(LABELS);
    if (path === `/orgs/${IDS.org}/users`) {
      return Promise.resolve([{ user: ADA, email: 'ada@flowboard.dev', role: 'member' }]);
    }
    return Promise.resolve([]);
  });
  transport.post.mockImplementation(() => Promise.resolve(makeTask()));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog(overrides: Partial<Parameters<typeof TaskCreateDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  renderWithProviders(
    <TaskCreateDialog
      open
      onOpenChange={onOpenChange}
      projectId={IDS.project}
      orgId={IDS.org}
      onCreated={onCreated}
      {...overrides}
    />,
  );
  return { onOpenChange, onCreated };
}

describe('TaskCreateDialog', () => {
  it('offers every field the create contract carries', async () => {
    renderDialog();

    expect(await screen.findByRole('textbox', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Type/u })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Status/u })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Priority/u })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /Story points/u })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Sprint/u })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Labels' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeInTheDocument();
  });

  it('submits the contract defaults for a title-only create', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onCreated } = renderDialog();

    await user.type(await screen.findByRole('textbox', { name: 'Title' }), 'Ship the rebalancer');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(transport.post).toHaveBeenCalledWith(
        `/projects/${IDS.project}/tasks`,
        {
          title: 'Ship the rebalancer',
          description: null,
          type: 'task',
          priority: 'medium',
          assigneeId: null,
          storyPoints: null,
          startDate: null,
          dueDate: null,
          sprintId: null,
          epicId: null,
          parentId: null,
          labelIds: [],
          watcherIds: [],
        },
        expect.anything(),
      );
    });

    // `statusId` is ABSENT, not null: omitted, the server drops the task in the
    // project's first `todo` column, which is what a quick create wants.
    const body = transport.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('statusId' in body).toBe(false);

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty title through the shared schema', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(transport.post).not.toHaveBeenCalled();
  });

  it('keeps a FRACTIONAL estimate', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(await screen.findByRole('textbox', { name: 'Title' }), 'Halves');
    await user.type(screen.getByRole('spinbutton', { name: /Story points/u }), '0.5');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(transport.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ storyPoints: 0.5 }),
        expect.anything(),
      );
    });
  });

  it('carries a pre-selected column and sprint through to the payload', async () => {
    const user = userEvent.setup();
    renderDialog({ defaultStatusId: IDS.doing, defaultSprintId: IDS.sprint });

    await user.type(await screen.findByRole('textbox', { name: 'Title' }), 'From a column');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(transport.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ statusId: IDS.doing, sprintId: IDS.sprint }),
        expect.anything(),
      );
    });
  });

  it('sends a chosen type and label set', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(await screen.findByRole('textbox', { name: 'Title' }), 'A defect');

    await user.click(screen.getByRole('combobox', { name: /Type/u }));
    await user.click(await screen.findByRole('option', { name: 'Bug' }));

    await user.click(screen.getByRole('combobox', { name: 'Labels' }));
    await user.click(await screen.findByText('backend'));
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(transport.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: 'bug', labelIds: [IDS.label] }),
        expect.anything(),
      );
    });
  });

  it('sends null rather than an empty string for a blank description', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(await screen.findByRole('textbox', { name: 'Title' }), 'Typed then cleared');
    const description = screen.getByRole('textbox', { name: 'Description' });
    await user.type(description, 'x');
    await user.clear(description);
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(transport.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ description: null }),
        expect.anything(),
      );
    });
  });
});
