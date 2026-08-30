// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import type { AdminUserRow, OrgWithRole } from '@flowboard/shared';

// Registers the English catalog on the default i18next instance. Must be
// imported before anything calls `useTranslation`.
import '@/i18n';
import { useAuthStore } from '@/stores/useAuthStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import AdminUsersPage from '@/pages/admin/AdminUsersPage';

/**
 * The global-admin user directory.
 *
 * `fetch` IS MOCKED, NOT THE HOOKS. The interesting behaviour of this page is
 * the REQUEST it decides to send — which body a "Deactivate" ends up as, that a
 * password reset PATCHes nothing and POSTs to its own route, that provisioning
 * generates a credential the server never sees twice. Mocking `useAdminUsers`
 * would make every one of those assertions about the mock.
 *
 * The self-guards get their own tests because they are the only thing here that
 * is pure chrome: the server 400s both, and the menu's job is to not offer an
 * action that is going to be refused.
 */

/** Typed as the real row shape, so a fixture cannot drift from the contract. */
const ACME_ID = '11111111-1111-4111-8111-111111111111';
const GLOBEX_ID = '22222222-2222-4222-8222-222222222222';
const INITECH_ID = '33333333-3333-4333-8333-333333333333';

const ADA: AdminUserRow = {
  id: '44444444-4444-4444-8444-444444444444',
  email: 'ada@flowboard.dev',
  name: 'Ada Lovelace',
  avatarUrl: null,
  isGlobalAdmin: true,
  locale: 'en',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  memberships: [],
};

const GRACE: AdminUserRow = {
  ...ADA,
  id: '55555555-5555-4555-8555-555555555555',
  email: 'grace@flowboard.dev',
  name: 'Grace Hopper',
  isGlobalAdmin: false,
  isActive: true,
  // Three organizations: two chips plus a `+1`, which is what makes the
  // overflow assertion below meaningful.
  memberships: [
    { orgId: ACME_ID, orgName: 'Acme', orgSlug: 'acme', role: 'admin' },
    { orgId: GLOBEX_ID, orgName: 'Globex', orgSlug: 'globex', role: 'member' },
    { orgId: INITECH_ID, orgName: 'Initech', orgSlug: 'initech', role: 'member' },
  ],
};

/** `GET /orgs` — what the membership pickers enumerate. */
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
    memberCount: 2,
    projectCount: 1,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: INITECH_ID,
    name: 'Initech',
    slug: 'initech',
    role: 'admin',
    memberCount: 1,
    projectCount: 0,
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
  },
];

const META = { page: 1, pageSize: 25, total: 2, totalPages: 1 };

/**
 * A response FACTORY, never a shared instance.
 *
 * A `Response` body can be read exactly once, so `mockResolvedValue(ok(...))`
 * hands the same already-consumed object to every call after the first — which
 * fails as a parse error three layers down from the cause. Every helper here
 * therefore returns a thunk, and the mock builds a fresh `Response` per call.
 */
type Responder = () => Response;

function ok(data: unknown, meta?: unknown): Responder {
  return () =>
    new Response(JSON.stringify({ success: true, data, meta }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
}

/** A 204, which is what the reset-password route answers. */
function noContent(): Responder {
  return () => new Response(null, { status: 204 });
}

const LIST = ok([ADA, GRACE], META);
const ORG_LIST = ok(ORGS);

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * The DEFAULT responder: routed by URL rather than by call order.
 *
 * The page now fires two independent GETs — the directory and `GET /orgs` for
 * the membership pickers — and they race. A positional mock would hand the org
 * list to whichever landed first, so the fallback dispatches on the path and
 * only the explicitly queued mutations use `mockImplementationOnce`.
 */
function byUrl(input: unknown): Response {
  return String(input).includes('/api/orgs') ? ORG_LIST() : LIST();
}

/**
 * Queues answers for the MUTATIONS this test expects; every GET still routes
 * by URL.
 *
 * Not positional any more. The page fires two independent GETs on mount — the
 * directory and `GET /orgs` for the membership pickers — and they race, so a
 * `mockImplementationOnce` chain would hand a queued POST body to whichever
 * read happened to land first. Dispatching on the METHOD is what makes the
 * queue mean "the writes, in order".
 */
function respondWith(...responses: Responder[]): void {
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
    // A BrowserRouter, NOT a MemoryRouter. `useGridUrlState` diffs against
    // `window.location.search` on purpose (React Router runs navigations inside
    // a transition, so the RENDERED params can be one navigation stale). A
    // MemoryRouter never touches `window.location`, so the hook would read an
    // empty query string, decide the URL had been changed by someone else, and
    // hydrate the grid straight back to its defaults on every keystroke.
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AdminUsersPage />
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
  // ASSIGNED, not `vi.stubGlobal`ed: the `afterEach` below calls
  // `unstubAllGlobals` to put `fetch` back, and that would take a stubbed
  // ResizeObserver with it — leaving every test after the first without one.
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });

  // Radix's menus and selects throw on pointerdown without these.
  Element.prototype.scrollIntoView ??= function scrollIntoView(): void {};
  Element.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
    return false;
  };
  Element.prototype.setPointerCapture ??= function setPointerCapture(): void {};
  Element.prototype.releasePointerCapture ??= function releasePointerCapture(): void {};
});

beforeEach(() => {
  // A clean URL per test: the grid writes its filters into the real history
  // under `BrowserRouter`, and a leftover `?q=` would hydrate the next test.
  window.history.replaceState({}, '', '/admin/users');

  // Signed in AS ADA — which is what makes the self-guard tests meaningful.
  useAuthStore.setState({
    accessToken: 'token',
    refreshToken: null,
    user: ADA,
  });
  fetchMock = vi.fn().mockImplementation(byUrl);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the directory table', () => {
  it('renders a row per account, with its access and status', async () => {
    renderPage();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();

    const ada = screen.getByTestId(`admin-user-${ADA.email}`);
    expect(within(ada).getByText('Global admin')).toBeInTheDocument();
    expect(within(ada).getByText('Active')).toBeInTheDocument();
    expect(within(ada).getByText('You')).toBeInTheDocument();
  });

  it('sends the search box straight to the server as `q`', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ada Lovelace');

    await user.type(screen.getByLabelText('Search users'), 'grace');

    await waitFor(() => {
      expect(requests().some((request) => request.url.includes('q=grace'))).toBe(true);
    });
  });

  it('shows the no-results state rather than the empty state when filtering', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ada Lovelace');

    fetchMock.mockImplementation(ok([], { ...META, total: 0 }));
    await user.type(screen.getByLabelText('Search users'), 'nobody');

    expect(await screen.findByText('No matches')).toBeInTheDocument();
    // Not the "no accounts yet" state — the deployment has users; this filter
    // does not. Conflating the two tells an admin their directory is empty.
    expect(screen.queryByText('No accounts yet')).not.toBeInTheDocument();
  });
});

describe('the row actions', () => {
  it('confirms a deactivation, and says that sessions are revoked', async () => {
    const user = userEvent.setup();
    respondWith(ok({ ...GRACE, isActive: false }));
    renderPage();
    await screen.findByText('Grace Hopper');

    const menu = await openRowMenu(user, 'Grace Hopper');
    await user.click(menu.getByRole('menuitem', { name: 'Deactivate account' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/every one of their sessions is revoked/i)).toBeInTheDocument();

    await user.click(dialog.getByRole('button', { name: 'Deactivate account' }));

    await waitFor(() => {
      const patch = requests().find((request) => request.method === 'PATCH');
      expect(patch?.url).toContain(`/admin/users/${GRACE.id}`);
      expect(patch?.body).toEqual({ isActive: false });
    });
  });

  it('sends only `isGlobalAdmin` when promoting', async () => {
    const user = userEvent.setup();
    respondWith(ok({ ...GRACE, isGlobalAdmin: true }));
    renderPage();
    await screen.findByText('Grace Hopper');

    const menu = await openRowMenu(user, 'Grace Hopper');
    await user.click(menu.getByRole('menuitem', { name: 'Make global admin' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Make global admin' }));

    await waitFor(() => {
      expect(requests().find((r) => r.method === 'PATCH')?.body).toEqual({ isGlobalAdmin: true });
    });
  });

  it('sends `forceLogout` without touching any other field', async () => {
    const user = userEvent.setup();
    respondWith(ok(GRACE));
    renderPage();
    await screen.findByText('Grace Hopper');

    const menu = await openRowMenu(user, 'Grace Hopper');
    await user.click(menu.getByRole('menuitem', { name: 'Sign out everywhere' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() => {
      expect(requests().find((r) => r.method === 'PATCH')?.body).toEqual({ forceLogout: true });
    });
  });

  /**
   * The server 400s both of these for your own account. The menu not offering
   * them is chrome, but it is the chrome that keeps an admin from locking
   * themselves out of the only page that could let them back in.
   */
  it('offers neither self-deactivation nor self-demotion, and explains why', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ada Lovelace');

    const menu = await openRowMenu(user, 'Ada Lovelace');

    expect(menu.queryByRole('menuitem', { name: 'Deactivate account' })).not.toBeInTheDocument();
    expect(menu.queryByRole('menuitem', { name: 'Revoke global admin' })).not.toBeInTheDocument();
    expect(menu.getByText('You cannot change your own access from here.')).toBeInTheDocument();
    // The two that ARE safe on your own account stay available.
    expect(menu.getByRole('menuitem', { name: 'Reset password' })).toBeInTheDocument();
  });
});

describe('the one-shot credential', () => {
  it('provisions a user and reveals a generated password exactly once', async () => {
    const user = userEvent.setup();
    respondWith(ok({ ...GRACE, name: 'Alan Turing', email: 'alan@flowboard.dev' }));
    renderPage();
    await screen.findByText('Ada Lovelace');

    await user.click(screen.getByRole('button', { name: 'Provision user' }));

    const form = within(await screen.findByRole('dialog'));
    await user.type(form.getByLabelText('Full name'), 'Alan Turing');
    await user.type(form.getByLabelText('Email'), 'alan@flowboard.dev');
    await user.click(form.getByRole('button', { name: 'Create account' }));

    // The POST carries a password the admin never typed.
    await waitFor(() => {
      const post = requests().find((r) => r.method === 'POST');
      expect(post?.url).toContain('/admin/users');
      const body = post?.body as { password?: string; email?: string } | undefined;
      expect(body?.email).toBe('alan@flowboard.dev');
      expect(body?.password?.length).toBeGreaterThanOrEqual(8);
    });

    // …and it is shown, once, with the warning that it cannot be read back.
    const reveal = await screen.findByTestId('temp-password');
    expect(reveal.textContent?.length).toBeGreaterThanOrEqual(8);
    expect(screen.getByText(/it is not stored anywhere you can read it back/i)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'I have copied it' }));
    await waitFor(() => {
      expect(screen.queryByTestId('temp-password')).not.toBeInTheDocument();
    });
  });

  it('resets a password through its own route, not the PATCH', async () => {
    const user = userEvent.setup();
    respondWith(noContent());
    renderPage();
    await screen.findByText('Grace Hopper');

    const menu = await openRowMenu(user, 'Grace Hopper');
    await user.click(menu.getByRole('menuitem', { name: 'Reset password' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => {
      const post = requests().find((r) => r.url.includes('/reset-password'));
      expect(post?.method).toBe('POST');
      expect((post?.body as { password?: string } | undefined)?.password?.length).toBeGreaterThan(
        8,
      );
    });
    expect(requests().some((r) => r.method === 'PATCH')).toBe(false);

    expect(await screen.findByTestId('temp-password')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Round 2 (W2.1): memberships, provisioning with org grants, anonymize-delete,
// CSV export.
// ═══════════════════════════════════════════════════════════════════════════

describe('the memberships column', () => {
  it('chips the first two organizations and collapses the rest', async () => {
    renderPage();
    await screen.findByText('Grace Hopper');

    const row = screen.getByTestId(`admin-user-${GRACE.email}`);
    const cell = within(row).getByTestId('user-memberships');

    expect(within(cell).getByText('Acme')).toBeInTheDocument();
    expect(within(cell).getByText('Globex')).toBeInTheDocument();
    // The third is behind the overflow pill, whose title carries its name.
    expect(within(cell).queryByText('Initech')).not.toBeInTheDocument();
    expect(within(cell).getByText('+1')).toHaveAttribute('title', 'Initech');
  });

  /**
   * A freshly provisioned global admin belongs to no organization. That is an
   * ANSWER, not a loading state — a blank cell would read as data that failed
   * to arrive.
   */
  it('writes "None" for an account in no organization', async () => {
    renderPage();
    await screen.findByText('Ada Lovelace');

    const row = screen.getByTestId(`admin-user-${ADA.email}`);
    expect(within(row).getByText('None')).toBeInTheDocument();
  });
});

describe('the memberships dialog', () => {
  it('adds an account to an organization through that organization’s own endpoint', async () => {
    const user = userEvent.setup();
    respondWith(ok({ orgId: INITECH_ID, user: { id: ADA.id }, role: 'member' }));
    renderPage();
    await screen.findByText('Ada Lovelace');

    const menu = await openRowMenu(user, 'Ada Lovelace');
    await user.click(menu.getByRole('menuitem', { name: 'Manage memberships…' }));

    const dialog = within(await screen.findByTestId('memberships-dialog'));
    await user.click(dialog.getByTestId('memberships-add-org'));
    await user.click(await screen.findByRole('option', { name: 'Initech' }));
    await user.click(dialog.getByTestId('memberships-add'));

    await waitFor(() => {
      const post = requests().find((request) => request.method === 'POST');
      // FlowBoard has no admin-scoped membership route, and does not need one:
      // a global admin passes the org-admin floor everywhere.
      expect(post?.url).toContain(`/api/orgs/${INITECH_ID}/members`);
      expect(post?.body).toEqual({ userId: ADA.id, role: 'member' });
    });
  });

  it('changes a role through PATCH, naming the organization it is in', async () => {
    const user = userEvent.setup();
    respondWith(ok({ orgId: GLOBEX_ID, user: { id: GRACE.id }, role: 'admin' }));
    renderPage();
    await screen.findByText('Grace Hopper');

    const menu = await openRowMenu(user, 'Grace Hopper');
    await user.click(menu.getByRole('menuitem', { name: 'Manage memberships…' }));

    const dialog = await screen.findByTestId('memberships-dialog');
    await user.click(within(dialog).getByTestId('membership-role-globex'));
    await user.click(await screen.findByRole('option', { name: 'Organization admin' }));

    await waitFor(() => {
      const patch = requests().find((request) => request.method === 'PATCH');
      expect(patch?.url).toContain(`/api/orgs/${GLOBEX_ID}/members/${GRACE.id}`);
      expect(patch?.body).toEqual({ role: 'admin' });
    });
  });

  it('removes a membership through DELETE', async () => {
    const user = userEvent.setup();
    respondWith(noContent());
    renderPage();
    await screen.findByText('Grace Hopper');

    const menu = await openRowMenu(user, 'Grace Hopper');
    await user.click(menu.getByRole('menuitem', { name: 'Manage memberships…' }));

    const dialog = await screen.findByTestId('memberships-dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove from Acme' }));

    await waitFor(() => {
      const del = requests().find((request) => request.method === 'DELETE');
      expect(del?.url).toContain(`/api/orgs/${ACME_ID}/members/${GRACE.id}`);
    });
  });

  it('offers only the organizations the account is not already in', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Grace Hopper');

    const menu = await openRowMenu(user, 'Grace Hopper');
    await user.click(menu.getByRole('menuitem', { name: 'Manage memberships…' }));

    // Grace is in all three, so there is nothing left to add.
    const dialog = within(await screen.findByTestId('memberships-dialog'));
    expect(dialog.getByText('This account is already in every organization.')).toBeInTheDocument();
    expect(dialog.queryByTestId('memberships-add')).not.toBeInTheDocument();
  });
});

describe('provisioning with organization grants', () => {
  /**
   * The API applies these in the SAME TRANSACTION as the account. The page used
   * to hardcode `[]`, which made the one atomic path unreachable from the
   * product.
   */
  it('sends the org grants in the create request', async () => {
    const user = userEvent.setup();
    respondWith(ok({ ...GRACE, name: 'Alan Turing', email: 'alan@flowboard.dev' }));
    renderPage();
    await screen.findByText('Ada Lovelace');

    await user.click(screen.getByRole('button', { name: 'Provision user' }));

    const form = within(await screen.findByRole('dialog'));
    await user.type(form.getByLabelText('Full name'), 'Alan Turing');
    await user.type(form.getByLabelText('Email'), 'alan@flowboard.dev');

    await user.click(form.getByTestId('membership-org-select'));
    await user.click(await screen.findByRole('option', { name: 'Globex' }));
    await user.click(form.getByTestId('membership-role-select'));
    await user.click(await screen.findByRole('option', { name: 'Organization admin' }));
    await user.click(form.getByTestId('membership-add'));

    // The draft row is committed and shown before submit.
    expect(await screen.findByTestId(`membership-draft-${GLOBEX_ID}`)).toBeInTheDocument();

    await user.click(form.getByRole('button', { name: 'Create account' }));

    await waitFor(() => {
      // By METHOD as well as path: the directory's own GET also lives under
      // `/admin/users`, and it is the first match.
      const post = requests().find(
        (request) => request.method === 'POST' && request.url.includes('/admin/users'),
      );
      const body = post?.body as { orgMemberships?: unknown } | undefined;
      expect(body?.orgMemberships).toEqual([{ orgId: GLOBEX_ID, role: 'admin' }]);
    });
  });
});

describe('deleting an account', () => {
  it('is never offered for your own account', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ada Lovelace');

    // Signed in AS ADA. An admin who anonymizes themselves has revoked their
    // own sessions and cannot sign back in to undo it.
    const menu = await openRowMenu(user, 'Ada Lovelace');
    expect(menu.queryByRole('menuitem', { name: 'Delete user…' })).not.toBeInTheDocument();
  });

  it('explains the anonymization, and unlocks only on the exact email', async () => {
    const user = userEvent.setup();
    respondWith(ok({ user: { ...GRACE, name: 'Deleted user' }, membershipsRemoved: 3 }));
    renderPage();
    await screen.findByText('Grace Hopper');

    const menu = await openRowMenu(user, 'Grace Hopper');
    await user.click(menu.getByRole('menuitem', { name: 'Delete user…' }));

    const dialog = await screen.findByTestId('delete-user-dialog');
    expect(within(dialog).getByText(/anonymized rather than erased/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/comments, activity and task history stay intact/i),
    ).toBeInTheDocument();

    const confirm = within(dialog).getByTestId('delete-user-confirm');
    expect(confirm).toBeDisabled();

    // The NAME is not the gate: two people can share one, and the address is
    // the identifier the operation destroys.
    await user.type(within(dialog).getByTestId('delete-user-gate'), 'Grace Hopper');
    expect(confirm).toBeDisabled();

    await user.clear(within(dialog).getByTestId('delete-user-gate'));
    await user.type(within(dialog).getByTestId('delete-user-gate'), GRACE.email);
    await waitFor(() => {
      expect(confirm).toBeEnabled();
    });

    await user.click(confirm);
    await waitFor(() => {
      const del = requests().find((request) => request.method === 'DELETE');
      expect(del?.url).toContain(`/admin/users/${GRACE.id}`);
    });
  });

  it('accepts the address in any case', async () => {
    const user = userEvent.setup();
    respondWith(ok({ user: GRACE, membershipsRemoved: 0 }));
    renderPage();
    await screen.findByText('Grace Hopper');

    const menu = await openRowMenu(user, 'Grace Hopper');
    await user.click(menu.getByRole('menuitem', { name: 'Delete user…' }));

    const dialog = await screen.findByTestId('delete-user-dialog');
    await user.type(within(dialog).getByTestId('delete-user-gate'), 'GRACE@FlowBoard.dev');

    await waitFor(() => {
      expect(within(dialog).getByTestId('delete-user-confirm')).toBeEnabled();
    });
  });
});

describe('the CSV export', () => {
  it('writes one record per row on screen, memberships flattened', async () => {
    const user = userEvent.setup();

    // `saveBlob` hands the browser an object URL and clicks a synthetic anchor;
    // jsdom has neither, so the two APIs it needs are stubbed and the BLOB is
    // read back instead of the download being observed.
    let saved = '';
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob.text().then((text) => {
        saved = text;
      });
      return 'blob:csv';
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function noop(
      this: HTMLAnchorElement,
    ) {
      return undefined;
    });

    renderPage();
    await screen.findByText('Grace Hopper');

    await user.click(screen.getByTestId('export-users-csv'));

    expect(click).toHaveBeenCalled();
    await waitFor(() => {
      expect(saved).toContain('Name,Email,Access,Status,Organizations,Added');
    });
    expect(saved).toContain('Ada Lovelace');
    // Flattened to `name (role)` pairs — the only shape that fits one cell —
    // and quoted, because the separator is a comma.
    expect(saved).toContain('Acme (Organization admin); Globex (Member); Initech (Member)');

    click.mockRestore();
  });

  it('is disabled when there is nothing to export', async () => {
    fetchMock.mockImplementation((input: unknown) =>
      String(input).includes('/api/orgs') ? ORG_LIST() : ok([], { ...META, total: 0 })(),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('export-users-csv')).toBeDisabled();
    });
  });
});
