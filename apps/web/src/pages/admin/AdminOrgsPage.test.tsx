// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { InstanceConfig, OrgAdminRow, OrgWithRole } from '@flowboard/shared';

import '@/i18n';
import { useAuthStore } from '@/stores/useAuthStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import AdminOrgsPage from '@/pages/admin/AdminOrgsPage';

/**
 * `/admin/orgs` — the organizations console.
 *
 * `fetch` IS MOCKED, NOT THE HOOKS, so the endpoint's TWO ROW SHAPES stay real:
 * `GET /orgs` answers `orgWithRoleSchema` rows without `includeDeleted` and
 * `orgAdminRowSchema` rows with it, and the widening that lets one table render
 * both is the thing most likely to break.
 *
 * A `BrowserRouter`, not a `MemoryRouter`: `useGridUrlState` diffs against
 * `window.location.search` on purpose (React Router runs navigations inside a
 * transition, so the rendered params can be one navigation stale). Under a
 * MemoryRouter the hook would read an empty query string, conclude somebody
 * else had changed the URL, and hydrate the grid back to its defaults on every
 * keystroke.
 */

const ACME: OrgWithRole = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Acme',
  slug: 'acme',
  role: 'admin',
  memberCount: 4,
  projectCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const GLOBEX: OrgWithRole = {
  ...ACME,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Globex',
  slug: 'globex',
  memberCount: 9,
  projectCount: 5,
};

/** The archived row — only ever returned under `includeDeleted`. */
const INITECH: OrgAdminRow = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Initech',
  slug: 'initech',
  memberCount: 1,
  projectCount: 0,
  createdAt: '2026-01-03T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  deletedAt: '2026-02-01T00:00:00.000Z',
};

/** A live row as the ADMIN list returns it: `deletedAt` present, no `role`. */
function toAdminRow(org: OrgWithRole): OrgAdminRow {
  const { role: _role, ...rest } = org;
  return { ...rest, deletedAt: null };
}

const MULTI_CONFIG: InstanceConfig = {
  orgMode: 'multi',
  defaultOrgSlug: null,
  instanceName: 'FlowBoard',
};

function json(data: unknown, status = 200, error?: unknown): Response {
  return new Response(JSON.stringify({ success: status < 400, data, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let config: InstanceConfig = MULTI_CONFIG;

/**
 * Routes every GET by URL — including the `includeDeleted` branch, which is the
 * behaviour under test rather than an implementation detail to stub past.
 */
function byUrl(input: unknown): Response {
  const url = String(input);
  if (url.includes('/instance/config')) return json(config);
  if (url.includes('/api/orgs')) {
    // The FLAG SWITCHES THE ROW SHAPE, exactly as `orgs.service.listOrgs` does:
    // admin rows carry `deletedAt` and drop `role`. Returning the live shape
    // under the flag would let a boundary-parse regression pass unnoticed.
    return url.includes('includeDeleted')
      ? json([toAdminRow(ACME), toAdminRow(GLOBEX), INITECH])
      : json([ACME, GLOBEX]);
  }
  return json([]);
}

/** Queues answers for the MUTATIONS a test expects; GETs still route by URL. */
function respondWith(...responses: (() => Response)[]): void {
  const queue = [...responses];
  fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const next = method === 'GET' ? undefined : queue.shift();
    return next ? next() : byUrl(input);
  });
}

/** Every request this test made, as `{ method, url, body }`. */
function requests(): { method: string; url: string; body: unknown }[] {
  return fetchMock.mock.calls.map((call) => {
    const init = call[1] as RequestInit | undefined;
    const raw = init?.body;
    return {
      method: init?.method ?? 'GET',
      url: String(call[0]),
      body: typeof raw === 'string' ? JSON.parse(raw) : undefined,
    };
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AdminOrgsPage />
        </TooltipProvider>
      </QueryClientProvider>
    </BrowserRouter>,
  );
}

/** Opens a row's action menu and returns its content. */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
  return within(await screen.findByRole('menu'));
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

/**
 * The toasts are SPIED, not rendered. Sonner draws into a `<Toaster />` this
 * tree deliberately does not mount — the page's job is to raise the right
 * message, and rendering the toast layer would test sonner instead.
 */
let toastSuccess: ReturnType<typeof vi.spyOn>;
let toastError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  toastSuccess = vi.spyOn(toast, 'success').mockReturnValue('id');
  toastError = vi.spyOn(toast, 'error').mockReturnValue('id');
  window.history.replaceState({}, '', '/admin/orgs');
  config = MULTI_CONFIG;
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
  fetchMock = vi.fn().mockImplementation(byUrl);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the table', () => {
  it('renders a row per live organization, with its slug and counts', async () => {
    renderPage();

    const acme = await screen.findByTestId('admin-org-acme');
    expect(within(acme).getByText('Acme')).toBeInTheDocument();
    expect(within(acme).getByText('/o/acme')).toBeInTheDocument();
    expect(within(acme).getByText('4')).toBeInTheDocument();
    expect(within(acme).getByText('Live')).toBeInTheDocument();

    expect(screen.getByTestId('admin-org-globex')).toBeInTheDocument();
    // Archived rows are behind the toggle: the request never asked for them.
    expect(screen.queryByTestId('admin-org-initech')).not.toBeInTheDocument();
  });

  it('hides the archived toggle behind the server flag, not a client filter', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('admin-org-acme');

    await user.click(screen.getByTestId('orgs-show-archived'));

    // The ROW SHAPE changes with the flag, so this has to be a new request.
    await waitFor(() => {
      expect(requests().some((request) => request.url.includes('includeDeleted=true'))).toBe(true);
    });
    const archived = await screen.findByTestId('admin-org-initech');
    expect(within(archived).getByText('Archived')).toBeInTheDocument();
  });

  /** Rule 1 of the grid codec: a param at its default is omitted. */
  it('round-trips the archived toggle through the URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('admin-org-acme');

    await user.click(screen.getByTestId('orgs-show-archived'));

    await waitFor(() => {
      expect(window.location.search).toContain('archived=shown');
    });

    await user.click(screen.getByTestId('orgs-show-archived'));
    await waitFor(() => {
      expect(window.location.search).not.toContain('archived');
    });
  });

  it('hydrates its filters from a pasted URL', async () => {
    window.history.replaceState({}, '', '/admin/orgs?archived=shown&q=init');
    renderPage();

    await waitFor(() => {
      const asked = requests().find((request) => request.url.includes('includeDeleted=true'));
      expect(asked?.url).toContain('q=init');
    });
    expect(await screen.findByTestId('admin-org-initech')).toBeInTheDocument();
  });
});

describe('creating an organization', () => {
  it('posts the name and slug, and never auto-derives one from the other', async () => {
    const user = userEvent.setup();
    respondWith(() => json({ ...ACME, id: 'new', name: 'Initech', slug: 'initech', teamCount: 0 }));
    renderPage();
    await screen.findByTestId('admin-org-acme');

    await user.click(screen.getByTestId('create-org'));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByTestId('org-name-input'), 'Initech');
    // The slug is a FIELD, not a derivation: typing the name left it empty.
    expect(dialog.getByTestId('org-slug-input')).toHaveValue('');
    await user.type(dialog.getByTestId('org-slug-input'), 'initech');
    await user.click(dialog.getByRole('button', { name: 'Create organization' }));

    await waitFor(() => {
      const post = requests().find((request) => request.method === 'POST');
      expect(post?.url).toContain('/api/orgs');
      expect(post?.body).toEqual({ name: 'Initech', slug: 'initech' });
    });
  });
});

describe('archiving', () => {
  it('gates the confirm on the organization name being typed', async () => {
    const user = userEvent.setup();
    respondWith(() => new Response(null, { status: 204 }));
    renderPage();
    await screen.findByTestId('admin-org-acme');

    const menu = await openRowMenu(user, 'Acme');
    await user.click(menu.getByRole('menuitem', { name: 'Archive…' }));

    const dialog = await screen.findByTestId('archive-org-dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Archive organization' });
    expect(confirm).toBeDisabled();

    // A near miss stays locked — the gate is friction on purpose.
    await user.type(within(dialog).getByTestId('archive-org-gate'), 'acme');
    expect(confirm).toBeDisabled();

    await user.clear(within(dialog).getByTestId('archive-org-gate'));
    await user.type(within(dialog).getByTestId('archive-org-gate'), 'Acme');
    await waitFor(() => {
      expect(confirm).toBeEnabled();
    });

    await user.click(confirm);
    await waitFor(() => {
      const del = requests().find((request) => request.method === 'DELETE');
      expect(del?.url).toContain(`/api/orgs/${ACME.id}`);
    });
  });

  it('says the operation is reversible rather than calling it a delete', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('admin-org-acme');

    const menu = await openRowMenu(user, 'Acme');
    await user.click(menu.getByRole('menuitem', { name: 'Archive…' }));

    const dialog = within(await screen.findByTestId('archive-org-dialog'));
    expect(dialog.getByText(/you can restore it from this table/i)).toBeInTheDocument();
  });
});

describe('restoring', () => {
  it('offers only Restore on an archived row, and posts to the restore route', async () => {
    const user = userEvent.setup();
    respondWith(() => json({ ...INITECH, deletedAt: null }));
    window.history.replaceState({}, '', '/admin/orgs?archived=shown');
    renderPage();
    await screen.findByTestId('admin-org-initech');

    const menu = await openRowMenu(user, 'Initech');
    // Opening or renaming an archived org is a change nobody can see, and every
    // org read filters `deleted_at IS NULL` — so neither is offered.
    expect(menu.queryByRole('menuitem', { name: 'Rename…' })).not.toBeInTheDocument();
    expect(menu.queryByRole('menuitem', { name: 'Archive…' })).not.toBeInTheDocument();

    await user.click(menu.getByRole('menuitem', { name: 'Restore' }));

    await waitFor(() => {
      const post = requests().find((request) => request.method === 'POST');
      expect(post?.url).toContain(`/api/orgs/${INITECH.id}/restore`);
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Initech restored');
    });
  });

  /**
   * The one failure an operator can act on: another organization took the slug
   * while this one was archived. A generic "someone changed this first" toast
   * names neither the slug nor the remedy.
   */
  it('explains a 409 slug conflict instead of raising the generic toast', async () => {
    const user = userEvent.setup();
    respondWith(() =>
      json(null, 409, { code: 'org_slug_conflict', message: 'Slug already in use.' }),
    );
    window.history.replaceState({}, '', '/admin/orgs?archived=shown');
    renderPage();
    await screen.findByTestId('admin-org-initech');

    const menu = await openRowMenu(user, 'Initech');
    await user.click(menu.getByRole('menuitem', { name: 'Restore' }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        'Another organization now uses the slug “initech”. Re-slug that one, then restore this.',
      );
    });
  });
});

describe('single-organization mode', () => {
  it('names the default organization in a banner, and still offers create', async () => {
    config = { orgMode: 'single', defaultOrgSlug: 'acme', instanceName: 'Acme Board' };
    renderPage();

    const banner = await screen.findByTestId('single-org-banner');
    expect(within(banner).getByText(/Acme is the workspace/)).toBeInTheDocument();
    expect(within(banner).getByRole('link', { name: 'Instance settings' })).toHaveAttribute(
      'href',
      '/admin/settings',
    );
    // Creating an org is how you prepare a switch back, so it stays available.
    expect(screen.getByTestId('create-org')).toBeEnabled();
  });

  it('calls out a single-mode install that has no default organization', async () => {
    config = { orgMode: 'single', defaultOrgSlug: null, instanceName: 'FlowBoard' };
    renderPage();

    const banner = await screen.findByTestId('single-org-banner');
    expect(within(banner).getByText(/No default organization is set/)).toBeInTheDocument();
  });

  it('shows no banner at all in multi-organization mode', async () => {
    renderPage();
    await screen.findByTestId('admin-org-acme');

    expect(screen.queryByTestId('single-org-banner')).not.toBeInTheDocument();
  });
});
