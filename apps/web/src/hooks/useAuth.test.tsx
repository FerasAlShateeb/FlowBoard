// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginResponseSchema, type LoginResponse } from '@flowboard/shared';

import { useAuthStore, type AuthUser } from '@/stores/useAuthStore';

/**
 * `useChangePassword`, and the token pair it used to throw away.
 *
 * Changing a password bumps the account's `tokenVersion` server-side, which
 * kills every token minted before it — INCLUDING the ones this tab is holding.
 * The endpoint answers with a freshly minted pair precisely so the device that
 * made the change survives; typing the mutation as `void` meant that pair was
 * parsed off the envelope and dropped on the floor.
 *
 * The failure is invisible at the moment it happens — the toast says "saved",
 * the page does not move — and surfaces minutes later as an unexplained
 * sign-out when the dead access token expires and the refresh spends a revoked
 * credential. That delay is exactly why it needs a test rather than a manual
 * check.
 */

const post = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, post: (...args: unknown[]) => post(...args) as unknown },
  };
});

// The localized toast needs an i18n tree this suite has no interest in booting.
vi.mock('@/i18n/errors', () => ({ useApiErrorToast: () => vi.fn() }));

const { useChangePassword } = await import('@/hooks/useAuth');

const USER: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ada@flowboard.dev',
  name: 'Ada Lovelace',
  avatarUrl: null,
  isGlobalAdmin: false,
  locale: 'en',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** What the API answers a change-password with: a whole new session. */
const REMINTED: LoginResponse = {
  user: USER,
  accessToken: 'access-2',
  refreshToken: 'refresh-2',
};

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  post.mockReset();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  useAuthStore.setState({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    user: USER,
    sessionGeneration: 1,
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('useChangePassword', () => {
  it('stores the re-minted pair, so the device that changed the password stays signed in', async () => {
    post.mockResolvedValue(REMINTED);

    const { result } = renderHook(() => useChangePassword(), { wrapper });
    result.current.mutate({ currentPassword: 'old-password', newPassword: 'new-password' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(useAuthStore.getState().accessToken).toBe('access-2');
    expect(useAuthStore.getState().refreshToken).toBe('refresh-2');
  });

  it('parses the response against the shared contract, like every other boundary', async () => {
    post.mockResolvedValue(REMINTED);

    const { result } = renderHook(() => useChangePassword(), { wrapper });
    result.current.mutate({ currentPassword: 'old-password', newPassword: 'new-password' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const [path, body, options] = post.mock.calls[0] as [string, unknown, { schema?: unknown }];
    expect(path).toBe('/auth/change-password');
    expect(body).toEqual({ currentPassword: 'old-password', newPassword: 'new-password' });
    expect(options.schema).toBe(loginResponseSchema);
  });

  /**
   * It is a new SESSION, not a rotation: the server changed `tokenVersion`, so
   * any refresh still in flight under the old one is now worthless and must not
   * be allowed to write its result back. Bumping the generation is what tells
   * `lib/api`'s `performRefresh` to discard it.
   */
  it('bumps the session generation, discarding a refresh raced against the old tokenVersion', async () => {
    post.mockResolvedValue(REMINTED);
    const before = useAuthStore.getState().sessionGeneration;

    const { result } = renderHook(() => useChangePassword(), { wrapper });
    result.current.mutate({ currentPassword: 'old-password', newPassword: 'new-password' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(useAuthStore.getState().sessionGeneration).toBe(before + 1);
  });

  it('keeps the user signed in, and the caches with them, when the change fails', async () => {
    post.mockRejectedValue(new Error('Current password is incorrect'));

    const { result } = renderHook(() => useChangePassword(), { wrapper });
    result.current.mutate({ currentPassword: 'wrong', newPassword: 'new-password' });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(useAuthStore.getState().accessToken).toBe('access-1');
  });
});
