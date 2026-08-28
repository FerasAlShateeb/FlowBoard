// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Notification } from '@flowboard/shared';

/**
 * `/notifications` — the notification centre.
 *
 * WHAT IS WORTH ASSERTING HERE, and what is not. The sentence layer and the
 * grouping arithmetic are pure and tested directly
 * (`notification-sentence.test.ts`); repeating them through a rendered tree
 * would be slower and would fail in two places for one bug. This suite covers
 * only what the PAGE adds: the day headings actually appearing, the two tabs
 * asking the server two different questions, the "Load more" affordance
 * following `totalPages`, and the two empty states saying opposite things.
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

import { api } from '@/lib/api';
import NotificationsPage from '@/pages/NotificationsPage';
import { makeNotification, renderWithProviders } from './notifications-fixtures';

/** Local noon `n` days back — a time no timezone can push into another day. */
function daysAgo(days: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 12, 0, 0).toISOString();
}

function arrange(options: { items?: Notification[]; unreadCount?: number; totalPages?: number }) {
  const items = options.items ?? [];
  vi.mocked(api.get).mockResolvedValue({ count: options.unreadCount ?? 0 });
  vi.mocked(api.paged).mockResolvedValue({
    data: items,
    meta: {
      page: 1,
      pageSize: 20,
      total: items.length,
      totalPages: options.totalPages ?? 1,
    },
  });
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.paged).mockReset();
  vi.mocked(api.post).mockReset();
});

afterEach(cleanup);

describe('the notification centre', () => {
  it('groups rows under Today and Yesterday headings', async () => {
    arrange({
      unreadCount: 1,
      items: [
        makeNotification({ createdAt: daysAgo(0) }),
        makeNotification({ createdAt: daysAgo(1) }),
      ],
    });
    renderWithProviders(<NotificationsPage />);

    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.getAllByTestId('notification-row')).toHaveLength(2);
  });

  it('asks the server for unread only when the Unread tab is chosen', async () => {
    arrange({ unreadCount: 2, items: [makeNotification({ createdAt: daysAgo(0) })] });
    const user = userEvent.setup();
    renderWithProviders(<NotificationsPage />);

    await screen.findAllByTestId('notification-row');
    expect(vi.mocked(api.paged).mock.calls[0]?.[1]?.query).toMatchObject({ unread: undefined });

    await user.click(screen.getByRole('tab', { name: 'Unread' }));

    await waitFor(() => {
      const queries = vi.mocked(api.paged).mock.calls.map((call) => call[1]?.query);
      expect(queries.some((query) => query?.unread === 'true')).toBe(true);
    });
  });

  it('says "no notifications yet" on All and "all caught up" on Unread', async () => {
    arrange({ unreadCount: 0, items: [] });
    const user = userEvent.setup();
    renderWithProviders(<NotificationsPage />);

    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Unread' }));
    expect(await screen.findByText('You are all caught up')).toBeInTheDocument();
  });

  it('offers Load more only while pages remain', async () => {
    arrange({
      unreadCount: 0,
      items: [makeNotification({ createdAt: daysAgo(0) })],
      totalPages: 3,
    });
    renderWithProviders(<NotificationsPage />);

    expect(await screen.findByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('hides Load more on the last page', async () => {
    arrange({ unreadCount: 0, items: [makeNotification({ createdAt: daysAgo(0) })] });
    renderWithProviders(<NotificationsPage />);

    await screen.findAllByTestId('notification-row');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('disables "Mark all as read" when the badge is already clear', async () => {
    arrange({ unreadCount: 0, items: [makeNotification({ createdAt: daysAgo(0) })] });
    renderWithProviders(<NotificationsPage />);

    await screen.findAllByTestId('notification-row');
    expect(screen.getByTestId('mark-all-read')).toBeDisabled();
  });

  it('marks everything read when the button is pressed', async () => {
    arrange({ unreadCount: 4, items: [makeNotification({ createdAt: daysAgo(0) })] });
    vi.mocked(api.post).mockResolvedValue({ marked: 4 });
    const user = userEvent.setup();
    renderWithProviders(<NotificationsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('mark-all-read')).toBeEnabled();
    });
    await user.click(screen.getByTestId('mark-all-read'));

    await waitFor(() => {
      // WP4.7 attached `markAllReadResponseSchema` to the call, so the response
      // is PARSED rather than asserted with a cast. Match the path and the
      // schema option, not the exact argument list — the point of the test is
      // which endpoint the button hits.
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        '/notifications/read-all',
        undefined,
        expect.objectContaining({ schema: expect.anything() as unknown }),
      );
    });
  });
});
