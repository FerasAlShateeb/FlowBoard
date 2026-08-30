// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { InstanceConfig, OrgWithRole } from '@flowboard/shared';

import '@/i18n';
import { useAuthStore } from '@/stores/useAuthStore';
import { LAST_ORG_STORAGE_KEY } from '@/hooks/useLastOrg';
import { installJsdomStubs } from '@/components/tasks/__tests__/test-utils';
import OrgSwitcher from '@/components/layout/OrgSwitcher';

/**
 * The org switcher, rendered.
 *
 * ═══ THE REGRESSION THIS SUITE EXISTS FOR ══════════════════════════════════
 *
 * The old switcher rendered a **disabled button** whenever the user had one
 * organization or none — and "or none" is every `/admin/*` route, because the
 * old control read the org out of the URL. A disabled control is invisible to a
 * click and to a keyboard, so on the deployments most likely to have a single
 * admin and a single org, the topbar's only route into org land was inert. It
 * is asserted here rather than in the pure suites because "is it enabled" is a
 * DOM property: nothing about the component's inputs would have looked wrong.
 *
 * The data hooks are mocked (a switcher suite is not a fetch suite); the
 * `Command` keyboard model, the popover and the catalog are all real.
 */

const ORGS = vi.hoisted(() => ({ current: [] as OrgWithRole[], searched: [] as OrgWithRole[] }));
const CONFIG = vi.hoisted(() => ({
  current: { orgMode: 'multi', defaultOrgSlug: null, instanceName: 'FlowBoard' } as InstanceConfig,
}));

vi.mock('@/hooks/useOrgs', () => ({
  ORG_SERVER_SEARCH_THRESHOLD: 20,
  useOrgs: () => ({ data: ORGS.current }),
  useOrgsSearch: () => ({ data: ORGS.searched }),
}));

vi.mock('@/hooks/useInstanceConfig', () => ({
  useInstanceConfig: () => CONFIG.current,
}));

installJsdomStubs();

function org(slug: string, name: string): OrgWithRole {
  return {
    id: `id-${slug}`,
    name,
    slug,
    role: 'member',
    memberCount: 1,
    projectCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as OrgWithRole;
}

const ACME = org('acme', 'Acme Corp');
const GLOBEX = org('globex', 'Globex');

/** Echoes the router's location, so a navigation is assertable. */
function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-testid="pathname">{pathname}</span>;
}

function renderSwitcher(initialPath: string, children?: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <OrgSwitcher />
        <LocationProbe />
        {children}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setAdmin(isGlobalAdmin: boolean, viewingAsMember = false) {
  useAuthStore.setState({
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'ada@flowboard.dev',
      name: 'Ada',
      avatarUrl: null,
      isGlobalAdmin,
      locale: 'en',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    viewingAsMember,
  });
}

beforeEach(() => {
  ORGS.current = [ACME, GLOBEX];
  ORGS.searched = [];
  CONFIG.current = { orgMode: 'multi', defaultOrgSlug: null, instanceName: 'FlowBoard' };
  localStorage.clear();
  setAdmin(false);
});

afterEach(cleanup);

describe('OrgSwitcher — the trigger', () => {
  it('is ENABLED with exactly one organization', () => {
    ORGS.current = [ACME];
    renderSwitcher('/o/acme');

    expect(screen.getByTestId('org-switcher')).toBeEnabled();
  });

  it('is ENABLED with no organizations at all', () => {
    ORGS.current = [];
    renderSwitcher('/');

    expect(screen.getByTestId('org-switcher')).toBeEnabled();
  });

  it('is ENABLED on an org-less admin route — the trap it was built to close', () => {
    renderSwitcher('/admin/users');

    expect(screen.getByTestId('org-switcher')).toBeEnabled();
  });

  it('names the org in the URL', () => {
    renderSwitcher('/o/globex/teams');

    expect(screen.getByTestId('org-switcher')).toHaveTextContent('Globex');
  });

  it('reads as a combobox, not a menu', () => {
    renderSwitcher('/o/acme');

    expect(screen.getByTestId('org-switcher')).toHaveAttribute('role', 'combobox');
  });

  it('says "Organizations" when the route has no org in it', () => {
    renderSwitcher('/admin/users');

    expect(screen.getByTestId('org-switcher')).toHaveTextContent('Organizations');
  });
});

describe('OrgSwitcher — single-org mode', () => {
  it('renders nothing at all', () => {
    CONFIG.current = { orgMode: 'single', defaultOrgSlug: 'acme', instanceName: 'Acme' };
    renderSwitcher('/o/acme');

    expect(screen.queryByTestId('org-switcher')).not.toBeInTheDocument();
  });
});

describe('OrgSwitcher — the list', () => {
  it('lists every org and checks the current one', async () => {
    const user = userEvent.setup();
    renderSwitcher('/o/acme');

    await user.click(screen.getByTestId('org-switcher'));

    expect(screen.getByRole('option', { name: /Acme Corp/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: /Globex/ })).toBeInTheDocument();
  });

  it('navigates to the chosen org and remembers it', async () => {
    const user = userEvent.setup();
    renderSwitcher('/o/acme');

    await user.click(screen.getByTestId('org-switcher'));
    await user.click(screen.getByRole('option', { name: /Globex/ }));

    expect(screen.getByTestId('pathname')).toHaveTextContent('/o/globex');
    // Written BEFORE the navigation, so the sidebar's org fallback is already
    // right on the destination's first render.
    expect(localStorage.getItem(LAST_ORG_STORAGE_KEY)).toBe('globex');
  });

  it('filters in the browser below the server-search threshold', async () => {
    const user = userEvent.setup();
    renderSwitcher('/o/acme');

    await user.click(screen.getByTestId('org-switcher'));
    await user.keyboard('globe');

    expect(screen.queryByRole('option', { name: /Acme Corp/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Globex/ })).toBeInTheDocument();
  });
});

describe('OrgSwitcher — the escape route', () => {
  it('always offers "All organizations", and it goes to /', async () => {
    const user = userEvent.setup();
    renderSwitcher('/admin/users');

    await user.click(screen.getByTestId('org-switcher'));
    await user.click(screen.getByRole('button', { name: 'All organizations' }));

    expect(screen.getByTestId('pathname')).toHaveTextContent('/');
  });

  /**
   * The reason the footer is not two more `CommandItem`s: a needle that matches
   * nothing is exactly when a way out matters most, and a `CommandItem` would
   * have been filtered away by it.
   */
  it('survives a needle that matches no organization', async () => {
    const user = userEvent.setup();
    renderSwitcher('/admin/users');

    await user.click(screen.getByTestId('org-switcher'));
    await user.keyboard('zzzzzz');

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All organizations' })).toBeInTheDocument();
  });

  it('offers "Manage organizations" to an effective global admin', async () => {
    setAdmin(true);
    const user = userEvent.setup();
    renderSwitcher('/admin/users');

    await user.click(screen.getByTestId('org-switcher'));
    await user.click(screen.getByTestId('org-switcher-manage'));

    expect(screen.getByTestId('pathname')).toHaveTextContent('/admin/orgs');
  });

  it('hides it from a plain member', async () => {
    const user = userEvent.setup();
    renderSwitcher('/o/acme');

    await user.click(screen.getByTestId('org-switcher'));

    expect(screen.queryByTestId('org-switcher-manage')).not.toBeInTheDocument();
  });

  it('hides it from an admin who is previewing as a member', async () => {
    setAdmin(true, true);
    const user = userEvent.setup();
    renderSwitcher('/o/acme');

    await user.click(screen.getByTestId('org-switcher'));

    expect(screen.queryByTestId('org-switcher-manage')).not.toBeInTheDocument();
  });
});
