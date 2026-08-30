// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminProjectRow, OrgWithRole } from '@flowboard/shared';

import '@/i18n';
import { useAuthStore } from '@/stores/useAuthStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import AdminProjectsPage from '@/pages/admin/AdminProjectsPage';

/**
 * `/admin/projects` — the cross-organization projects console.
 *
 * Unlike the organizations console, this endpoint paginates AND sorts
 * server-side, so the assertions here are mostly about the REQUEST the grid
 * decides to send: which `?sort=field:dir` a header click produces, which
 * filters reach the wire, and what a hand-edited URL is allowed to ask for.
 */

const ACME_ID = '11111111-1111-4111-8111-111111111111';
const GLOBEX_ID = '22222222-2222-4222-8222-222222222222';

const FLOW: AdminProjectRow = {
  projectId: '66666666-6666-4666-8666-666666666666',
  key: 'FLOW',
  name: 'FlowBoard Web',
  orgId: ACME_ID,
  orgName: 'Acme',
  orgSlug: 'acme',
  leadName: 'Ada Lovelace',
  memberCount: 5,
  taskCount: 90,
  openTaskCount: 34,
  lastActivityAt: '2026-08-29T00:00:00.000Z',
  deletedAt: null,
};

/** A brand-new project: no lead, never active — both nullable on purpose. */
const FRESH: AdminProjectRow = {
  ...FLOW,
  projectId: '77777777-7777-4777-8777-777777777777',
  key: 'NEW',
  name: 'Greenfield',
  orgId: GLOBEX_ID,
  orgName: 'Globex',
  orgSlug: 'globex',
  leadName: null,
  memberCount: 1,
  taskCount: 0,
  openTaskCount: 0,
  lastActivityAt: null,
};

const ORGS: OrgWithRole[] = [
  {
    id: ACME_ID,
    name: 'Acme',
    slug: 'acme',
    role: 'admin',
    memberCount: 4,
    projectCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: GLOBEX_ID,
    name: 'Globex',
    slug: 'globex',
    role: 'admin',
    memberCount: 9,
    projectCount: 5,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

const META = { page: 1, pageSize: 20, total: 2, totalPages: 1 };

function json(data: unknown, meta?: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, meta }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function byUrl(input: unknown): Response {
  const url = String(input);
  if (url.includes('/admin/projects')) return json([FLOW, FRESH], META);
  if (url.includes('/api/orgs')) return json(ORGS);
  return json([]);
}

/** Every URL this test requested. */
function urls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

/** The most recent `/admin/projects` request. */
function lastProjectsUrl(): string {
  return [...urls()].reverse().find((url) => url.includes('/admin/projects')) ?? '';
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AdminProjectsPage />
        </TooltipProvider>
      </QueryClientProvider>
    </BrowserRouter>,
  );
}

beforeAll(() => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
  Element.prototype.scrollIntoView ??= function scrollIntoView(): void {};
  Element.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
    return false;
  };
  Element.prototype.setPointerCapture ??= function setPointerCapture(): void {};
  Element.prototype.releasePointerCapture ??= function releasePointerCapture(): void {};
});

beforeEach(() => {
  window.history.replaceState({}, '', '/admin/projects');
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
  fetchMock = vi.fn().mockImplementation(byUrl);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the table', () => {
  it('renders a row per project, with its key, org and open/total tasks', async () => {
    renderPage();

    const row = await screen.findByTestId('admin-project-FLOW');
    expect(within(row).getByText('FLOW')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'FlowBoard Web' })).toHaveAttribute(
      'href',
      '/o/acme/p/FLOW/board',
    );
    expect(within(row).getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/o/acme');
    // One fact, one column: how much of the backlog is still live.
    expect(within(row).getByText('34 / 90')).toBeInTheDocument();
  });

  it('writes out the two nullable columns rather than leaving them blank', async () => {
    renderPage();

    const row = await screen.findByTestId('admin-project-NEW');
    // "No lead" and "Never" are answers; an empty cell reads as data that
    // failed to load.
    expect(within(row).getByText('No lead')).toBeInTheDocument();
    expect(within(row).getByText('Never')).toBeInTheDocument();
  });

  /**
   * THE STATUS COLUMN BADGES BOTH STATES (R2 W3.5).
   *
   * It rendered `null` for a live row, so a column headed "Status" was blank on
   * most of the table — which reads as missing data, not as an answer — while
   * `/admin/orgs`, one click away in the same console, badged both. The cell was
   * also untested, which is how the two pages drifted in the first place.
   */
  it('badges a LIVE project explicitly, like /admin/orgs does', async () => {
    renderPage();

    const row = await screen.findByTestId('admin-project-FLOW');
    expect(within(row).getByText('Live')).toBeInTheDocument();
    expect(within(row).queryByText('Archived')).not.toBeInTheDocument();
  });

  it('badges an ARCHIVED project, and dates it on the badge', async () => {
    fetchMock.mockImplementation((input: unknown) =>
      String(input).includes('/admin/projects')
        ? json([{ ...FLOW, deletedAt: '2026-08-01T00:00:00.000Z' }], META)
        : byUrl(input),
    );
    renderPage();

    const row = await screen.findByTestId('admin-project-FLOW');
    expect(within(row).getByText('Archived')).toBeInTheDocument();
    expect(within(row).queryByText('Live')).not.toBeInTheDocument();
    // The WHEN is on the badge's title rather than in a column of its own —
    // the same place `/admin/orgs` puts it.
    expect(within(row).getByText('Archived')).toHaveAttribute(
      'title',
      expect.stringContaining('Archived'),
    );
  });
});

describe('sorting', () => {
  /**
   * The header cycle is asc → desc → cleared, and each step is a REQUEST: this
   * endpoint sorts server-side over a whitelisted field list, so a client-side
   * sort would be reordering one page of twenty out of however many there are.
   */
  it('turns a header click into `?sort=field:dir`, and clears on the third', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('admin-project-FLOW');

    // `^Project` anchors it: the header cell also holds a drag GRIP whose
    // accessible name is "Reorder Project" (see `DraggableHeader`), and the
    // sort button's name is the column label plus an `sr-only` hint.
    const header = screen.getByRole('button', { name: /^Project/ });

    await user.click(header);
    await waitFor(() => {
      expect(lastProjectsUrl()).toContain('sort=name%3Aasc');
    });

    await user.click(header);
    await waitFor(() => {
      expect(lastProjectsUrl()).toContain('sort=name%3Adesc');
    });

    // The third click CLEARS. Asserted against the browser URL rather than the
    // network: the unsorted query is the one this page opened with, so
    // TanStack answers it from cache and there is no third request to inspect.
    await user.click(header);
    await waitFor(() => {
      expect(window.location.search).not.toContain('sort=');
    });
  });

  it('round-trips the sort through the URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('admin-project-FLOW');

    await user.click(screen.getByRole('button', { name: /^Last activity/ }));

    await waitFor(() => {
      expect(window.location.search).toContain('sort=lastActivityAt');
    });
  });

  /**
   * `?sort` is whitelisted SERVER-side, so a hand-edited field would 422 the
   * whole page. Dropping it falls back to the server's own ordering, which is
   * what an absent parameter already means.
   */
  it('drops a sort field the shared contract does not know', async () => {
    window.history.replaceState({}, '', '/admin/projects?sort=orgId&order=desc');
    renderPage();
    await screen.findByTestId('admin-project-FLOW');

    expect(lastProjectsUrl()).not.toContain('sort=');
  });
});

describe('the facets', () => {
  it('narrows to one organization, single-select, and puts it in the URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('admin-project-FLOW');

    await user.click(screen.getByTestId('table-facet-org'));
    await user.click(await screen.findByTestId('table-facet-org-' + GLOBEX_ID));

    await waitFor(() => {
      expect(lastProjectsUrl()).toContain(`orgId=${GLOBEX_ID}`);
    });
    expect(window.location.search).toContain(`orgId=${GLOBEX_ID}`);
  });

  it('widens to archived projects only when asked', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('admin-project-FLOW');
    expect(lastProjectsUrl()).not.toContain('includeArchived');

    await user.click(screen.getByTestId('table-facet-archived'));
    await user.click(await screen.findByTestId('table-facet-archived-shown'));

    await waitFor(() => {
      expect(lastProjectsUrl()).toContain('includeArchived=true');
    });
  });

  it('hydrates every filter from a pasted URL', async () => {
    window.history.replaceState(
      {},
      '',
      `/admin/projects?q=flow&orgId=${ACME_ID}&archived=shown&page=2`,
    );
    renderPage();

    await waitFor(() => {
      const url = lastProjectsUrl();
      expect(url).toContain('q=flow');
      expect(url).toContain(`orgId=${ACME_ID}`);
      expect(url).toContain('includeArchived=true');
      expect(url).toContain('page=2');
    });
  });

  /** A uuid, or nothing: a hand-typed `?orgId=nope` must not reach a 422. */
  it('ignores an organization id that is not a uuid', async () => {
    window.history.replaceState({}, '', '/admin/projects?orgId=nope');
    renderPage();
    await screen.findByTestId('admin-project-FLOW');

    expect(lastProjectsUrl()).not.toContain('orgId=');
  });
});
