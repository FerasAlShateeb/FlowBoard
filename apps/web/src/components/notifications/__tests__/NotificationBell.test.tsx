// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Notification } from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import NotificationBell from '@/components/notifications/NotificationBell';
import { makeNotification, renderWithProviders } from './notifications-fixtures';

/**
 * The bell: badge, panel, rows.
 *
 * ── The API is mocked at the MODULE boundary, not at `fetch` ────────────────
 *
 * `lib/api.ts` owns the envelope unwrap, the zod parse and the single-flight
 * refresh, and all three have their own suite (`lib/api.test.ts`). Re-driving
 * them through a stubbed `fetch` here would make every bell assertion depend on
 * three unrelated mechanisms; stubbing `api` instead means a failure in this
 * file is a failure in the bell. `importActual` is spread back in so
 * `ApiError` — which `i18n/errors.ts` does an `instanceof` against — is still
 * the real class.
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

/** Point the two reads the bell makes at fixed answers. */
function arrange(options: { unreadCount?: number; items?: Notification[] } = {}): void {
  const items = options.items ?? [];
  vi.mocked(api.get).mockResolvedValue({ count: options.unreadCount ?? 0 });
  vi.mocked(api.paged).mockResolvedValue({
    data: items,
    meta: { page: 1, pageSize: 8, total: items.length, totalPages: 1 },
  });
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.paged).mockReset();
  vi.mocked(api.post).mockReset();
});

afterEach(cleanup);

describe('the badge', () => {
  it('is absent when there is nothing unread', async () => {
    arrange({ unreadCount: 0 });
    renderWithProviders(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByTestId('notification-bell')).toHaveAccessibleName(/unread: 0/iu);
    });
    expect(screen.queryByTestId('notification-badge')).toBeNull();
  });

  it('shows the count, and carries it in the accessible name', async () => {
    arrange({ unreadCount: 3 });
    renderWithProviders(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toHaveTextContent('3');
    });
    // The number is never left to the glyph: a screen reader gets it too.
    expect(screen.getByTestId('notification-bell')).toHaveAccessibleName(/unread: 3/iu);
  });

  it('carries the pop class, which is inert unless the policy says Full', async () => {
    arrange({ unreadCount: 3 });
    renderWithProviders(<NotificationBell />);

    const badge = await screen.findByTestId('notification-badge');
    // Motion registry entry #5. The class is ALWAYS applied — the gate is in
    // `index.css` §B1, which declares `fb-badge-pop`'s animation only under
    // `html[data-motion='full']`, so Reduced motion needs no branch here and
    // there is no kill rule anyone can forget to write.
    expect(badge).toHaveClass('fb-badge-pop');
  });

  it('re-keys the badge on every count change, so the pop actually retriggers', async () => {
    arrange({ unreadCount: 3 });
    const { queryClient } = renderWithProviders(<NotificationBell />);
    const first = await screen.findByTestId('notification-badge');
    expect(first).toHaveTextContent('3');

    // Written straight into the cache rather than through a refetch, because
    // that is how the count actually moves in production: the socket bridge
    // pushes a new value into `qk.notifications.unreadCount()`.
    act(() => {
      queryClient.setQueryData(qk.notifications.unreadCount(), 4);
    });

    // `waitFor`, not `findBy`: an element with this testid already exists (it
    // says 3), so a `findBy` would resolve on the STALE node. React Query
    // notifies its observers through the notify manager's scheduler rather than
    // inside `setQueryData`, so the re-render lands a tick later.
    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toHaveTextContent('4');
    });

    // A CSS animation runs once when its element enters the DOM and never
    // again, and the badge otherwise persists across counts. `key={unreadCount}`
    // is what makes 3 → 4 a remount, which is what restarts the keyframe from
    // frame zero with no JavaScript at all. A NEW node is the proof.
    const second = screen.getByTestId('notification-badge');
    expect(second).not.toBe(first);
    expect(second).toHaveClass('fb-badge-pop');
  });

  it('caps the badge at 99+ rather than widening the topbar', async () => {
    arrange({ unreadCount: 143 });
    renderWithProviders(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByTestId('notification-badge')).toHaveTextContent('99+');
    });
    // The EXACT number survives in the accessible name.
    expect(screen.getByTestId('notification-bell')).toHaveAccessibleName(/unread: 143/iu);
  });
});

describe('the panel', () => {
  it('renders a row per notification, with its sentence', async () => {
    arrange({
      unreadCount: 2,
      items: [
        makeNotification({ type: 'task_assigned' }),
        makeNotification({ type: 'mentioned', readAt: new Date().toISOString() }),
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />);

    await user.click(screen.getByTestId('notification-bell'));

    const rows = await screen.findAllByTestId('notification-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/assigned/iu);
    expect(rows[1]).toHaveTextContent(/mentioned you/iu);
  });

  it('marks the unread rows, and only those', async () => {
    arrange({
      unreadCount: 1,
      items: [
        makeNotification({ readAt: null }),
        makeNotification({ readAt: '2026-03-01T09:00:00.000Z' }),
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />);
    await user.click(screen.getByTestId('notification-bell'));

    const rows = await screen.findAllByTestId('notification-row');
    expect(rows[0]).toHaveAttribute('data-unread', 'true');
    expect(rows[1]).toHaveAttribute('data-unread', 'false');
    expect(screen.getAllByTestId('notification-unread-dot')).toHaveLength(1);
  });

  it('says so when there is nothing to show', async () => {
    arrange({ unreadCount: 0, items: [] });
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />);
    await user.click(screen.getByTestId('notification-bell'));

    expect(await screen.findByText('Nothing new')).toBeInTheDocument();
    expect(screen.queryAllByTestId('notification-row')).toHaveLength(0);
  });

  it('marks a row read when it is clicked', async () => {
    const unread = makeNotification({ readAt: null });
    arrange({ unreadCount: 1, items: [unread] });
    vi.mocked(api.post).mockResolvedValue({ ...unread, readAt: new Date().toISOString() });

    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />);
    await user.click(screen.getByTestId('notification-bell'));
    await user.click((await screen.findAllByTestId('notification-row'))[0] as HTMLElement);

    await waitFor(() => {
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        `/notifications/${unread.id}/read`,
        undefined,
        expect.anything(),
      );
    });
  });

  it('does not re-mark a row that is already read', async () => {
    const read = makeNotification({ readAt: '2026-03-01T09:00:00.000Z' });
    arrange({ unreadCount: 0, items: [read] });

    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />);
    await user.click(screen.getByTestId('notification-bell'));
    await user.click((await screen.findAllByTestId('notification-row'))[0] as HTMLElement);

    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });
});
