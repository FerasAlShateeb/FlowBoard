// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import type { Notification } from '@flowboard/shared';

import { qk } from '@/lib/query-keys';
import { api, ApiError } from '@/lib/api';
import {
  NOTIFICATIONS_PAGE_SIZE,
  useMarkAllRead,
  useMarkRead,
  type NotificationPage,
} from '@/hooks/useNotifications';
import { hookWrapper, makeInfiniteData, makeNotification } from './notifications-fixtures';

/**
 * The optimistic writes, and the rollback that makes them safe.
 *
 * ═══ WHY THIS IS TESTED THROUGH THE CACHE, NOT THE SCREEN ═════════════════
 *
 * The user-visible promise is "the badge drops the instant I click, and comes
 * BACK if the write failed". Both halves are cache facts — the count entry and
 * the `readAt` stamp inside the infinite-query pages — and asserting them
 * directly is what pins the contract. A DOM assertion would only prove that the
 * component re-rendered, which is React's job, not this hook's.
 *
 * ═══ THE ONE SUBTLETY ═════════════════════════════════════════════════════
 *
 * `onSettled` invalidates the whole `qk.notifications` prefix. `renderHook`
 * mounts no list observer, so invalidation marks those entries stale WITHOUT
 * refetching — which is exactly what lets the assertion see the rolled-back
 * value instead of a server answer racing it. In the real app the refetch is
 * the point; here its absence is what makes the test about the rollback.
 */
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      paged: vi.fn(),
    },
  };
});

const listKey = [...qk.notifications.list(false), 'paged', NOTIFICATIONS_PAGE_SIZE] as const;

/**
 * A cache primed exactly as an open notification centre would leave it.
 *
 * `gcTime: Infinity` is load-bearing HERE and nowhere else: `renderHook` mounts
 * no observer for the list or the count, so the shared harness's `gcTime: 0`
 * would collect both entries the moment they were seeded and every assertion
 * below would read `undefined`. The rest of the suite's client is the usual
 * retries-off configuration.
 */
function primed(items: Notification[], unreadCount: number): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(qk.notifications.unreadCount(), unreadCount);
  queryClient.setQueryData(listKey, makeInfiniteData(items));
  return queryClient;
}

function cachedRows(queryClient: QueryClient): Notification[] {
  const data = queryClient.getQueryData<InfiniteData<NotificationPage, number>>(listKey);
  return (data?.pages ?? []).flatMap((page) => page.items);
}

beforeEach(() => {
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockResolvedValue({ count: 0 });
});

afterEach(cleanup);

describe('useMarkRead', () => {
  it('decrements the badge and stamps the row before the server answers', async () => {
    const first = makeNotification({ readAt: null });
    const second = makeNotification({ readAt: null });
    const queryClient = primed([first, second], 2);
    vi.mocked(api.post).mockResolvedValue({ ...first, readAt: new Date().toISOString() });

    const { result } = renderHook(() => useMarkRead(), { wrapper: hookWrapper(queryClient) });
    result.current.mutate(first.id);

    await waitFor(() => {
      expect(queryClient.getQueryData(qk.notifications.unreadCount())).toBe(1);
    });
    const rows = cachedRows(queryClient);
    expect(rows.find((row) => row.id === first.id)?.readAt).not.toBeNull();
    // The row nobody clicked is untouched.
    expect(rows.find((row) => row.id === second.id)?.readAt).toBeNull();
  });

  it('never takes the badge below zero', async () => {
    const notification = makeNotification({ readAt: null });
    const queryClient = primed([notification], 0);
    vi.mocked(api.post).mockResolvedValue({ ...notification, readAt: new Date().toISOString() });

    const { result } = renderHook(() => useMarkRead(), { wrapper: hookWrapper(queryClient) });
    result.current.mutate(notification.id);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(queryClient.getQueryData(qk.notifications.unreadCount())).toBe(0);
  });

  it('ROLLS BACK the badge and the stamp when the write fails', async () => {
    const notification = makeNotification({ readAt: null });
    const queryClient = primed([notification], 4);
    vi.mocked(api.post).mockRejectedValue(new ApiError('nope', 500, 'internal_error'));

    const { result } = renderHook(() => useMarkRead(), { wrapper: hookWrapper(queryClient) });
    result.current.mutate(notification.id);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(queryClient.getQueryData(qk.notifications.unreadCount())).toBe(4);
    expect(cachedRows(queryClient)[0]?.readAt).toBeNull();
  });
});

describe('useMarkAllRead', () => {
  it('clears the badge and stamps every unread row', async () => {
    const already = makeNotification({ readAt: '2026-03-01T09:00:00.000Z' });
    const queryClient = primed([makeNotification({ readAt: null }), already], 5);
    vi.mocked(api.post).mockResolvedValue({ marked: 1 });

    const { result } = renderHook(() => useMarkAllRead(), { wrapper: hookWrapper(queryClient) });
    result.current.mutate();

    await waitFor(() => {
      expect(queryClient.getQueryData(qk.notifications.unreadCount())).toBe(0);
    });
    expect(cachedRows(queryClient).every((row) => row.readAt !== null)).toBe(true);
    // An already-read row keeps its ORIGINAL timestamp — the stamp only fills
    // in the missing ones, so history does not get rewritten by a bulk action.
    expect(cachedRows(queryClient).find((row) => row.id === already.id)?.readAt).toBe(
      already.readAt,
    );
  });

  it('restores the whole subtree when the write fails', async () => {
    const notification = makeNotification({ readAt: null });
    const queryClient = primed([notification], 7);
    vi.mocked(api.post).mockRejectedValue(new ApiError('nope', 503, 'service_unavailable'));

    const { result } = renderHook(() => useMarkAllRead(), { wrapper: hookWrapper(queryClient) });
    result.current.mutate();

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(queryClient.getQueryData(qk.notifications.unreadCount())).toBe(7);
    expect(cachedRows(queryClient)[0]?.readAt).toBeNull();
  });
});
