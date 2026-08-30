// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { InstanceConfig } from '@flowboard/shared';

import '@/i18n';
import { useAuthStore } from '@/stores/useAuthStore';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { setLastOrgSlug, clearLastOrgSlug } from '@/hooks/useLastOrg';
import { installJsdomStubs } from '@/components/tasks/__tests__/test-utils';
import Sidebar from '@/components/layout/Sidebar';

/**
 * The sidebar, rendered — the headline Round 2 defect, end to end.
 *
 * `nav.config.test.ts` proves the MODEL; this proves the WIRING, which is the
 * half that actually broke. The old file built its own sections from
 * `useRouteScope().orgSlug`, so on `/admin/users` — a route with no org in it —
 * the rendered column contained no organization link and no way home. Nothing
 * about that was visible in a unit test of anything: it was a render of a list
 * that happened to be empty.
 */

const CONFIG = vi.hoisted(() => ({
  current: { orgMode: 'multi', defaultOrgSlug: null, instanceName: 'FlowBoard' } as InstanceConfig,
}));

vi.mock('@/hooks/useInstanceConfig', () => ({
  useInstanceConfig: () => CONFIG.current,
}));

installJsdomStubs();

function renderSidebar(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Sidebar />
    </MemoryRouter>,
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

/** Every in-app destination the rendered column offers. */
function links(): string[] {
  return within(screen.getByTestId('sidebar'))
    .getAllByRole('link')
    .map((link) => link.getAttribute('href') ?? '');
}

beforeEach(() => {
  CONFIG.current = { orgMode: 'multi', defaultOrgSlug: null, instanceName: 'FlowBoard' };
  clearLastOrgSlug();
  useLayoutStore.setState({ sidebarCollapsed: false, mobileNavOpen: false });
  setAdmin(false);
});

afterEach(cleanup);

describe('Sidebar — the escape routes', () => {
  it('makes the brand mark a link home', () => {
    renderSidebar('/admin/users');

    expect(screen.getByTestId('brand-home')).toHaveAttribute('href', '/');
  });

  it('offers a Home row on an admin route', () => {
    setAdmin(true);
    renderSidebar('/admin/users');

    expect(links()).toContain('/');
  });

  it('keeps the organization links on `/admin/*` via the remembered org', () => {
    setAdmin(true);
    setLastOrgSlug('acme');
    renderSidebar('/admin/users');

    expect(links()).toEqual(
      expect.arrayContaining(['/o/acme', '/o/acme/teams', '/o/acme/members', '/o/acme/settings']),
    );
  });

  it('keeps them via the instance default org when nothing is remembered', () => {
    setAdmin(true);
    CONFIG.current = { orgMode: 'single', defaultOrgSlug: 'globex', instanceName: 'Globex' };
    renderSidebar('/admin/users');

    expect(links()).toContain('/o/globex');
  });
});

describe('Sidebar — the admin sections', () => {
  it('renders Administration and Analytics for a global admin', () => {
    setAdmin(true);
    renderSidebar('/admin/users');

    const hrefs = links();
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/admin/overview',
        '/admin/orgs',
        '/admin/projects',
        '/admin/users',
        '/admin/settings',
        '/admin/analytics/engagement',
        '/admin/analytics/work',
        '/admin/analytics/traffic',
        '/admin/analytics/growth',
        // The two pages nothing used to link to.
        '/admin/telemetry/events',
        '/admin/telemetry/requests',
      ]),
    );
  });

  it('hides both from a plain member', () => {
    renderSidebar('/');

    expect(links().some((href) => href.startsWith('/admin'))).toBe(false);
  });

  it('hides both from an admin previewing as a member — but keeps Home', () => {
    setAdmin(true, true);
    renderSidebar('/');

    expect(links().some((href) => href.startsWith('/admin'))).toBe(false);
    expect(links()).toContain('/');
  });
});

describe('Sidebar — project context', () => {
  it('adds the project views inside a project, built from the URL', () => {
    renderSidebar('/o/acme/p/FLOW/board');

    expect(links()).toEqual(
      expect.arrayContaining([
        '/o/acme/p/FLOW/board',
        '/o/acme/p/FLOW/backlog',
        '/o/acme/p/FLOW/settings',
        // …and the org links for the org that project is in.
        '/o/acme',
      ]),
    );
  });

  it('marks the active view as the current page', () => {
    renderSidebar('/o/acme/p/FLOW/backlog');

    const active = within(screen.getByTestId('sidebar')).getByRole('link', { current: 'page' });
    expect(active).toHaveAttribute('href', '/o/acme/p/FLOW/backlog');
  });
});
