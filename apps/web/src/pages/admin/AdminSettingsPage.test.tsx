// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { InstanceSettings, OrgWithRole } from '@flowboard/shared';

import '@/i18n';
import { qk } from '@/lib/query-keys';
import { useAuthStore } from '@/stores/useAuthStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import AdminSettingsPage from '@/pages/admin/AdminSettingsPage';

/**
 * `/admin/settings` — the instance singleton.
 *
 * Three things are worth testing and nothing else really is: that the PATCH
 * body says what the form says, that the two 422 codes land UNDER THE FIELD
 * they are about rather than in a toast, and that a successful save invalidates
 * the SHELL's config as well as its own row — which is the entire point of the
 * feature (flip the mode, the switcher disappears).
 */

const ACME_ID = '11111111-1111-4111-8111-111111111111';
const GLOBEX_ID = '22222222-2222-4222-8222-222222222222';

const SETTINGS: InstanceSettings = {
  orgMode: 'multi',
  defaultOrgSlug: null,
  defaultOrgId: null,
  instanceName: 'FlowBoard',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
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

function json(data: unknown, status = 200, error?: unknown): Response {
  return new Response(JSON.stringify({ success: status < 400, data, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A 422 in the envelope shape the settings service answers. */
function unprocessable(code: string): () => Response {
  return () => json(null, 422, { code, message: 'Validation failed.' });
}

let fetchMock: ReturnType<typeof vi.fn>;
let settings: InstanceSettings = SETTINGS;
let toastError: ReturnType<typeof vi.spyOn>;

function byUrl(input: unknown): Response {
  const url = String(input);
  if (url.includes('/admin/settings')) return json(settings);
  if (url.includes('/instance/config')) {
    return json({
      orgMode: settings.orgMode,
      defaultOrgSlug: settings.defaultOrgSlug,
      instanceName: settings.instanceName,
    });
  }
  if (url.includes('/api/orgs')) return json(ORGS);
  return json([]);
}

function respondWith(...responses: (() => Response)[]): void {
  const queue = [...responses];
  fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const next = method === 'GET' ? undefined : queue.shift();
    return next ? next() : byUrl(input);
  });
}

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

let queryClient: QueryClient;

function renderPage() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AdminSettingsPage />
        </TooltipProvider>
      </QueryClientProvider>
    </BrowserRouter>,
  );
}

/** Picks an organization out of the default-organization select. */
async function pickDefaultOrg(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByTestId('default-org-select'));
  await user.click(await screen.findByRole('option', { name }));
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
  toastError = vi.spyOn(toast, 'error').mockReturnValue('id');
  vi.spyOn(toast, 'success').mockReturnValue('id');
  window.history.replaceState({}, '', '/admin/settings');
  settings = SETTINGS;
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
  fetchMock = vi.fn().mockImplementation(byUrl);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the form', () => {
  it('renders the stored settings, and starts clean', async () => {
    renderPage();

    expect(await screen.findByTestId('instance-name-input')).toHaveValue('FlowBoard');
    expect(screen.getByTestId('org-mode-multi')).toHaveAttribute('data-state', 'on');
    // A save button that is live on arrival invites a no-op PATCH.
    expect(screen.getByTestId('save-instance-settings')).toBeDisabled();
    expect(screen.getByText('No changes to save')).toBeInTheDocument();
  });

  it('enables Save only once something differs from what is stored', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('instance-name-input');

    await user.type(screen.getByTestId('instance-name-input'), '!');

    await waitFor(() => {
      expect(screen.getByTestId('save-instance-settings')).toBeEnabled();
    });
  });

  it('sends the whole form as the PATCH body', async () => {
    const user = userEvent.setup();
    respondWith(() => json({ ...SETTINGS, instanceName: 'Acme Board' }));
    renderPage();
    await screen.findByTestId('instance-name-input');

    await user.clear(screen.getByTestId('instance-name-input'));
    await user.type(screen.getByTestId('instance-name-input'), 'Acme Board');
    await user.click(screen.getByTestId('save-instance-settings'));

    await waitFor(() => {
      const patch = requests().find((request) => request.method === 'PATCH');
      expect(patch?.url).toContain('/admin/settings');
      // `''` is mapped back to `null` at the boundary: `ui/select` has no
      // concept of a null value and reserves the empty string for "unset".
      expect(patch?.body).toEqual({
        instanceName: 'Acme Board',
        orgMode: 'multi',
        defaultOrgId: null,
      });
    });
  });
});

describe('organization mode', () => {
  it('explains what single mode changes, with the choice rather than after it', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('org-mode-single');

    expect(screen.queryByTestId('single-mode-alert')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('org-mode-single'));

    const alert = await screen.findByTestId('single-mode-alert');
    expect(within(alert).getByText(/The organization switcher is hidden/i)).toBeInTheDocument();
    // A static remark, not an assertive live region — it was not a response to
    // anything the user needs interrupting for.
    expect(alert).toHaveAttribute('role', 'note');
  });

  it('carries the mode and the chosen organization into the request', async () => {
    const user = userEvent.setup();
    respondWith(() =>
      json({ ...SETTINGS, orgMode: 'single', defaultOrgId: ACME_ID, defaultOrgSlug: 'acme' }),
    );
    renderPage();
    await screen.findByTestId('org-mode-single');

    await user.click(screen.getByTestId('org-mode-single'));
    await pickDefaultOrg(user, 'Acme');
    await user.click(screen.getByTestId('save-instance-settings'));

    await waitFor(() => {
      const patch = requests().find((request) => request.method === 'PATCH');
      expect(patch?.body).toEqual({
        instanceName: 'FlowBoard',
        orgMode: 'single',
        defaultOrgId: ACME_ID,
      });
    });
  });
});

describe('the two 422s', () => {
  /**
   * "Single mode requires a default organization that EXISTS" is a DATABASE
   * question, which is why the shared schema declines to express it and the
   * service answers a code. The form's job is to put that answer where the
   * admin can act on it.
   */
  it('shows `default_org_required` under the field, not in a toast', async () => {
    const user = userEvent.setup();
    respondWith(unprocessable('default_org_required'));
    renderPage();
    await screen.findByTestId('org-mode-single');

    await user.click(screen.getByTestId('org-mode-single'));
    await user.click(screen.getByTestId('save-instance-settings'));

    expect(
      await screen.findByText('Single-organization mode needs a default organization. Pick one.'),
    ).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('shows `default_org_invalid` under the field too', async () => {
    const user = userEvent.setup();
    respondWith(unprocessable('default_org_invalid'));
    renderPage();
    await screen.findByTestId('org-mode-single');

    await user.click(screen.getByTestId('org-mode-single'));
    await pickDefaultOrg(user, 'Globex');
    await user.click(screen.getByTestId('save-instance-settings'));

    expect(
      await screen.findByText(
        'That organization no longer exists, or has been archived. Pick another.',
      ),
    ).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('still raises a toast for a failure that belongs to no field', async () => {
    const user = userEvent.setup();
    respondWith(() => json(null, 500, { code: 'server_error', message: 'Boom.' }));
    renderPage();
    await screen.findByTestId('instance-name-input');

    await user.type(screen.getByTestId('instance-name-input'), '!');
    await user.click(screen.getByTestId('save-instance-settings'));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
  });
});

describe('saving', () => {
  /**
   * The whole point of the feature: the shell relays itself out. Invalidating
   * only `settings()` would leave an admin looking at a saved form and an
   * unchanged application.
   */
  it('invalidates the shell config as well as its own row', async () => {
    const user = userEvent.setup();
    const saved: InstanceSettings = {
      ...SETTINGS,
      orgMode: 'single',
      defaultOrgId: ACME_ID,
      defaultOrgSlug: 'acme',
    };
    // The server now HOLDS the saved row: the invalidation this test is about
    // triggers a refetch, and a fixture that kept answering the old row would
    // overwrite the very cache write being asserted.
    respondWith(() => {
      settings = saved;
      return json(saved);
    });
    renderPage();
    await screen.findByTestId('org-mode-single');

    // Seed a config entry, so there is something for the invalidation to reach.
    queryClient.setQueryData(qk.instance.config(), {
      orgMode: 'multi',
      defaultOrgSlug: null,
      instanceName: 'FlowBoard',
    });

    await user.click(screen.getByTestId('org-mode-single'));
    await pickDefaultOrg(user, 'Acme');
    await user.click(screen.getByTestId('save-instance-settings'));

    await waitFor(() => {
      // The response is written straight into the settings cache, so the form
      // re-baselines against what the server stored.
      expect(queryClient.getQueryData(qk.instance.settings())).toEqual(saved);
    });
    await waitFor(() => {
      expect(queryClient.getQueryState(qk.instance.config())?.isInvalidated).toBe(true);
    });
  });

  it('goes back to clean after a successful save', async () => {
    const user = userEvent.setup();
    respondWith(() => {
      settings = { ...SETTINGS, instanceName: 'Acme Board' };
      return json(settings);
    });
    renderPage();
    await screen.findByTestId('instance-name-input');

    await user.clear(screen.getByTestId('instance-name-input'));
    await user.type(screen.getByTestId('instance-name-input'), 'Acme Board');
    await user.click(screen.getByTestId('save-instance-settings'));

    await waitFor(() => {
      expect(screen.getByTestId('save-instance-settings')).toBeDisabled();
    });
  });
});
