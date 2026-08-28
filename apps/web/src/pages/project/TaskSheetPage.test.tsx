// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { ProjectDetail, ProjectWithRole } from '@flowboard/shared';

import { ApiError } from '@/lib/api';
import TaskSheetPage from '@/pages/project/TaskSheetPage';
import {
  ADA,
  IDS,
  LABELS,
  STATUSES,
  makeTask,
  renderWithProviders,
} from '@/components/tasks/__tests__/test-utils';

/**
 * The route-layered sheet.
 *
 * WHAT IS BEING ASSERTED IS THE ROUTING CONTRACT, not the panel — the panel has
 * its own suite. Specifically: the sheet opens on mount over a parent that stays
 * rendered, it resolves the task from the human KEY in the URL, it shows its
 * three states INSIDE the sheet rather than over the page, and closing it
 * returns to the parent view rather than walking out of the app.
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

const ORG = {
  id: IDS.org,
  slug: 'acme',
  name: 'Acme',
  role: 'member' as const,
  memberCount: 4,
  projectCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const PROJECT_ROW: ProjectWithRole = {
  id: IDS.project,
  orgId: IDS.org,
  key: 'FLOW',
  name: 'FlowBoard',
  description: null,
  teamId: null,
  leadId: null,
  lead: null,
  role: 'member',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const PROJECT: ProjectDetail = {
  ...PROJECT_ROW,
  statuses: STATUSES,
  labels: LABELS,
  memberCount: 4,
};

/** Resolves the scope chain (`/orgs` → projects → detail) plus the by-key hit. */
function baseRoutes(path: string): unknown {
  if (path === '/orgs') return [ORG];
  if (path === `/orgs/${IDS.org}/projects`) return [PROJECT_ROW];
  if (path === `/projects/${IDS.project}`) return PROJECT;
  if (path === `/projects/${IDS.project}/labels`) return LABELS;
  if (path === `/orgs/${IDS.org}/users`) {
    return [{ user: ADA, email: 'ada@flowboard.dev', role: 'member' }];
  }
  return [];
}

beforeEach(() => {
  transport.get.mockImplementation((path: string) => {
    if (path === `/projects/${IDS.project}/tasks/by-key/FLOW-142`) {
      return Promise.resolve(makeTask());
    }
    return Promise.resolve(baseRoutes(path));
  });
  transport.paged.mockImplementation(() =>
    Promise.resolve({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Mounts the sheet as a CHILD of a stand-in board, exactly as the router does. */
function renderSheet(taskKey = 'FLOW-142') {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/o/acme/p/FLOW/board/t/${taskKey}`]}>
      <Routes>
        <Route
          path="/o/:orgSlug/p/:projectKey/board"
          element={
            <div>
              <h1>Board view</h1>
              <Outlet />
            </div>
          }
        >
          <Route path="t/:taskKey" element={<TaskSheetPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('TaskSheetPage', () => {
  it('renders the parent view UNDERNEATH and the sheet over it', async () => {
    renderSheet();

    // The parent stays MOUNTED — that is the whole point of layering the route
    // rather than replacing it: no refetch, no lost scroll position. It is
    // queried by TEXT rather than by role because a modal dialog correctly
    // `aria-hidden`s everything outside itself while it is open.
    expect(screen.getByText('Board view')).toBeInTheDocument();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows a loading skeleton INSIDE the sheet, keyed by the URL', async () => {
    // A pending by-key lookup: the sheet is already open, so the wait belongs
    // in the panel rather than behind a full-page spinner.
    transport.get.mockImplementation((path: string) =>
      path.includes('/tasks/by-key/')
        ? new Promise(() => undefined)
        : Promise.resolve(baseRoutes(path)),
    );

    renderSheet();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('FLOW-142');
    expect(dialog).toHaveTextContent('Loading task…');
  });

  it('resolves the task from the FULL human key and renders the panel', async () => {
    renderSheet();

    expect(
      await screen.findByRole('heading', { name: 'Rebalance fractional ranks' }),
    ).toBeInTheDocument();

    // The lookup is project-scoped and takes `FLOW-142`, not `142` — a bare
    // number is only unique once the project is known.
    expect(transport.get).toHaveBeenCalledWith(
      `/projects/${IDS.project}/tasks/by-key/FLOW-142`,
      expect.anything(),
    );
  });

  it('uppercases a lowercased key from a pasted link', async () => {
    renderSheet('flow-142');

    await waitFor(() => {
      expect(transport.get).toHaveBeenCalledWith(
        `/projects/${IDS.project}/tasks/by-key/FLOW-142`,
        expect.anything(),
      );
    });
  });

  it('shows an error state with a way back when the task does not exist', async () => {
    transport.get.mockImplementation((path: string) =>
      path.includes('/tasks/by-key/')
        ? Promise.reject(new ApiError('Not found', 404, 'not_found'))
        : Promise.resolve(baseRoutes(path)),
    );

    renderSheet('FLOW-999');

    // An error state, not a silent redirect: bouncing to the board would leave
    // the reader wondering whether they mistyped.
    expect(await screen.findByText('That task does not exist')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // And the board is still underneath it.
    expect(screen.getByText('Board view')).toBeInTheDocument();
  });

  it('closes back to the parent view on Escape', async () => {
    const user = userEvent.setup();
    renderSheet();

    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // `navigate('..')` resolves against the ROUTE, so it lands on the board
    // whether or not there was a history entry to go back to — and the heading
    // is reachable by role again now that the modal has released the a11y tree.
    expect(screen.getByRole('heading', { name: 'Board view' })).toBeInTheDocument();
  });
});
