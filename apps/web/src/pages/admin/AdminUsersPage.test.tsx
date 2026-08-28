// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@flowboard/shared';

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
const ADA: User = {
  id: '44444444-4444-4444-8444-444444444444',
  email: 'ada@flowboard.dev',
  name: 'Ada Lovelace',
  avatarUrl: null,
  isGlobalAdmin: true,
  locale: 'en',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const GRACE: User = {
  ...ADA,
  id: '55555555-5555-4555-8555-555555555555',
  email: 'grace@flowboard.dev',
  name: 'Grace Hopper',
  isGlobalAdmin: false,
  isActive: true,
};

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

let fetchMock: ReturnType<typeof vi.fn>;

/** Answers the first list request, then `responses` in order, then the list. */
function respondWith(...responses: Responder[]): void {
  fetchMock.mockImplementationOnce(LIST);
  for (const response of responses) fetchMock.mockImplementationOnce(response);
  fetchMock.mockImplementation(LIST);
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
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AdminUsersPage />
      </TooltipProvider>
    </QueryClientProvider>,
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
  // Signed in AS ADA — which is what makes the self-guard tests meaningful.
  useAuthStore.setState({
    accessToken: 'token',
    refreshToken: null,
    user: ADA,
  });
  fetchMock = vi.fn().mockImplementation(LIST);
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
