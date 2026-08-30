// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { OrgWithRole } from '@flowboard/shared';

import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/useAuthStore';
import { useOrgs, useOrgsSearch } from '@/hooks/useOrgs';

/**
 * THE ORG SWITCHER'S TWO QUERIES, AND THE ONE THING THEY MUST AGREE ON.
 *
 * `GET /orgs` has a global-admin branch that returns EVERY organization on the
 * instance. "View as member" narrows it with `?scope=member`, and that narrowing
 * is the whole preview: an admin checking what a member sees must not get a
 * switcher listing the platform.
 *
 * `useOrgs` carried the parameter from the start. `useOrgsSearch` — the SAME
 * switcher, above `ORG_SERVER_SEARCH_THRESHOLD` organizations — did not, so on a
 * large instance typing one character refilled the list with everything (R2
 * W3.5). Both hooks are therefore driven through the same matrix here, and the
 * assertions are on the QUERY OBJECT handed to `api.get`, because that is the
 * request the server actually sees.
 *
 * `api.get` is mocked rather than `fetch`: what is under test is which
 * parameters go out and which cache key they land under, not the envelope
 * unwrap (`useAdminOrgs.test.ts` owns that).
 */

// PARTIAL: `useOrgs` also pulls in `i18n/errors`, which reads the real
// `NETWORK_ERROR_CODE` at module scope. Only the transport is faked.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

const get = vi.mocked(api.get);

const ROW: OrgWithRole = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Acme',
  slug: 'acme',
  role: 'admin',
  memberCount: 4,
  projectCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Put the store in one of the three states the switcher can be rendered in. */
function signIn(options: { isGlobalAdmin: boolean; viewingAsMember?: boolean }): void {
  useAuthStore.setState({
    accessToken: 'token',
    refreshToken: null,
    user: {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'a@flowboard.test',
      name: 'Admin',
      avatarUrl: null,
      isGlobalAdmin: options.isGlobalAdmin,
      locale: 'en',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    viewingAsMember: options.viewingAsMember ?? false,
  });
}

/** The `query` bag `api.get` was last called with. */
function sentQuery(): Record<string, string> | undefined {
  const options = get.mock.calls.at(-1)?.[1] as { query?: Record<string, string> } | undefined;
  return options?.query;
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue([ROW]);
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ accessToken: null, refreshToken: null, user: null });
  useAuthStore.getState().setViewingAsMember(false);
});

describe('useOrgs — the list', () => {
  it('sends no scope for a plain member', async () => {
    signIn({ isGlobalAdmin: false });

    const { result } = renderHook(() => useOrgs(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(get).toHaveBeenCalledWith('/orgs', expect.anything());
    expect(sentQuery()).toEqual({});
  });

  it('sends no scope for an admin who is NOT previewing', async () => {
    signIn({ isGlobalAdmin: true });

    const { result } = renderHook(() => useOrgs(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(sentQuery()).toEqual({});
  });

  it('sends scope=member for an admin previewing as a member', async () => {
    signIn({ isGlobalAdmin: true, viewingAsMember: true });

    const { result } = renderHook(() => useOrgs(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(sentQuery()).toEqual({ scope: 'member' });
  });
});

describe('useOrgsSearch — the server-side search', () => {
  it('sends the needle and no scope for a plain member', async () => {
    signIn({ isGlobalAdmin: false });

    const { result } = renderHook(() => useOrgsSearch('acm'), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(sentQuery()).toEqual({ q: 'acm' });
  });

  it('sends the needle and no scope for an admin who is NOT previewing', async () => {
    signIn({ isGlobalAdmin: true });

    const { result } = renderHook(() => useOrgsSearch('acm'), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(sentQuery()).toEqual({ q: 'acm' });
  });

  /** THE REGRESSION. Without this the preview leaks the whole instance. */
  it('sends scope=member ALONGSIDE the needle for an admin previewing as a member', async () => {
    signIn({ isGlobalAdmin: true, viewingAsMember: true });

    const { result } = renderHook(() => useOrgsSearch('acm'), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(sentQuery()).toEqual({ q: 'acm', scope: 'member' });
  });

  it('still sends the scope on an EMPTY needle — the popover opens before you type', async () => {
    signIn({ isGlobalAdmin: true, viewingAsMember: true });

    const { result } = renderHook(() => useOrgsSearch('   '), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(sentQuery()).toEqual({ scope: 'member' });
  });

  it('does not run at all when the caller disables it', () => {
    signIn({ isGlobalAdmin: true, viewingAsMember: true });

    renderHook(() => useOrgsSearch('acm', { enabled: false }), { wrapper });

    expect(get).not.toHaveBeenCalled();
  });

  /**
   * The scope is part of the KEY, so flipping the switch swaps lists instead of
   * serving the admin-wide answer under a member-scoped request. Same client for
   * both renders — a fresh one would prove nothing.
   */
  it('keys the two scopes separately, so a flip refetches instead of reusing', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    signIn({ isGlobalAdmin: true });
    const first = renderHook(() => useOrgsSearch('acm'), { wrapper: shared });
    await waitFor(() => {
      expect(first.result.current.isSuccess).toBe(true);
    });
    expect(get).toHaveBeenCalledTimes(1);

    first.unmount();
    signIn({ isGlobalAdmin: true, viewingAsMember: true });
    const second = renderHook(() => useOrgsSearch('acm'), { wrapper: shared });
    await waitFor(() => {
      expect(second.result.current.isSuccess).toBe(true);
    });

    expect(get).toHaveBeenCalledTimes(2);
    expect(sentQuery()).toEqual({ q: 'acm', scope: 'member' });
  });
});
