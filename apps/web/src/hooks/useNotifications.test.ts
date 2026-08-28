import { describe, expect, it } from 'vitest';
import type { Notification } from '@flowboard/shared';

import {
  flattenNotifications,
  notificationHref,
  notificationsTotal,
  type NotificationPage,
} from '@/hooks/useNotifications';

/**
 * The pure half of the notifications hook.
 *
 * `notificationHref` is the reason this file exists: it is the ONE place a
 * notification turns into a URL, it is built entirely from a snapshot whose
 * every field is optional, and getting it wrong means a bell that navigates to
 * a 404 — the single most annoying bug a notification centre can have. It is a
 * pure function precisely so it can be pinned here instead of clicked through.
 */

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    recipientId: '22222222-2222-4222-8222-222222222222',
    type: 'comment_added',
    payload: {
      taskId: '33333333-3333-4333-8333-333333333333',
      taskKey: 'FLOW-142',
      taskTitle: 'Rebalance fractional ranks',
      projectKey: 'FLOW',
      projectName: 'FlowBoard',
      orgSlug: 'acme',
      actorName: 'Ada Lovelace',
    },
    readAt: null,
    createdAt: '2026-03-02T10:00:00.000Z',
    ...overrides,
  };
}

function makePage(items: Notification[], overrides: Partial<NotificationPage['meta']> = {}) {
  return {
    items,
    meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1, ...overrides },
  } satisfies NotificationPage;
}

describe('notificationHref', () => {
  it('deep-links to the task sheet layered over the board', () => {
    expect(notificationHref(makeNotification())).toBe('/o/acme/p/FLOW/board/t/FLOW-142');
  });

  it('falls back to the notification centre when there is no task', () => {
    const sprint = makeNotification({
      type: 'sprint_started',
      payload: { orgSlug: 'acme', projectKey: 'FLOW', sprintName: 'Sprint 9' },
    });
    expect(notificationHref(sprint)).toBe('/notifications');
  });

  it.each([
    ['orgSlug', { taskKey: 'FLOW-1', projectKey: 'FLOW' }],
    ['projectKey', { taskKey: 'FLOW-1', orgSlug: 'acme' }],
    ['taskKey', { projectKey: 'FLOW', orgSlug: 'acme' }],
  ])('falls back when %s is missing from the snapshot', (_field, payload) => {
    expect(notificationHref(makeNotification({ payload }))).toBe('/notifications');
  });

  it('falls back rather than building a URL with an empty segment', () => {
    const blank = makeNotification({
      payload: { taskKey: '', projectKey: 'FLOW', orgSlug: 'acme' },
    });
    expect(notificationHref(blank)).toBe('/notifications');
  });
});

describe('flattenNotifications', () => {
  it('concatenates the pages in the order they arrived', () => {
    const first = makeNotification({ id: 'a' });
    const second = makeNotification({ id: 'b' });
    const data = { pages: [makePage([first]), makePage([second])], pageParams: [1, 2] };

    expect(flattenNotifications(data).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('answers an empty list before the first page lands', () => {
    expect(flattenNotifications(undefined)).toEqual([]);
  });
});

describe('notificationsTotal', () => {
  it('reads the total off the FIRST page, which is the freshest count', () => {
    const data = {
      pages: [makePage([makeNotification()], { total: 42, totalPages: 3 })],
      pageParams: [1],
    };
    expect(notificationsTotal(data)).toBe(42);
  });

  it('is zero with no pages', () => {
    expect(notificationsTotal(undefined)).toBe(0);
  });
});
