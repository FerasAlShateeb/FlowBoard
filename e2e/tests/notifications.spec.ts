import { expect, test } from '../helpers/test';

import { ApiClient, taskKey, type TaskSummary } from '../helpers/api';
import { signIn } from '../helpers/app';
import { FLOW, MEMBER, ORG_ADMIN } from '../helpers/seed';

/**
 * The notification centre.
 *
 * Every notification here is MADE BY THE APP, not by the seed. That is not
 * fussiness: the seeded rows carry a minimal payload (`taskTitle`, `actorName`)
 * and therefore deep-link nowhere, while a real fan-out snapshots
 * `{orgSlug, projectKey, taskKey, …}` into the row so the bell can navigate
 * without a join. Testing the deep link against a seeded row would assert the
 * fallback and call it a feature.
 */

/** Have Maya @-mention Sara on a seeded FLOW task, the way a person would. */
async function mentionSara(): Promise<{ task: TaskSummary; key: string }> {
  const maya = await ApiClient.signIn(ORG_ADMIN.email, ORG_ADMIN.password);
  const sara = await ApiClient.signIn(MEMBER.email, MEMBER.password);
  const project = await maya.project(FLOW.key);
  const columns = await maya.board(project.id);
  const task = Object.values(columns).flat()[0];
  if (!task) throw new Error('the seeded FLOW board is empty');

  // `@[Display Name](userId)` is the wire format the markdown renderer AND the
  // notification fan-out both parse — see the seed's mention comment.
  await maya.post(`/tasks/${task.id}/comments`, {
    body: `@[${MEMBER.name}](${sara.user.id}) could you take a look?`,
  });

  return { task, key: taskKey(FLOW.key, task) };
}

test('the bell counts unread work and the page filters it', async ({ page }) => {
  const { key } = await mentionSara();
  const api = await signIn(page, MEMBER);

  await page.goto('/notifications');

  const badge = page.getByTestId('notification-badge');
  await expect(badge).toBeVisible();
  const unreadBefore = (await api.get<{ count: number }>('/notifications/unread-count')).count;
  expect(unreadBefore).toBeGreaterThan(0);

  // Both tabs are real filters over the same list, not a client-side hide.
  const rows = page.getByTestId('notification-row');
  await page.getByRole('tab', { name: 'All' }).click();
  const all = await rows.count();
  await page.getByRole('tab', { name: 'Unread' }).click();
  await expect.poll(async () => rows.count()).toBeLessThanOrEqual(all);
  await expect(rows.filter({ has: page.getByTestId('notification-unread-dot') })).toHaveCount(
    await rows.count(),
  );

  // The mention is on the list, addressed to the right person.
  await expect(page.getByText(`@${MEMBER.name}`).or(page.getByText(key)).first()).toBeVisible();
});

test('opening a notification lands on the task it is about', async ({ page }) => {
  const { key } = await mentionSara();
  await signIn(page, MEMBER);

  await page.goto('/notifications');
  await page.getByRole('tab', { name: 'Unread' }).click();

  const mention = page.getByTestId('notification-row').filter({ hasText: ORG_ADMIN.name }).first();
  await expect(mention).toBeVisible();
  await mention.click();

  // Straight to the task sheet layered over the project's board — the row's own
  // payload is what knows the org slug and the project key.
  await page.waitForURL(new RegExp(`/o/[^/]+/p/${FLOW.key}/board/t/${key}$`, 'u'));
  await expect(page.locator('[data-slot="sheet-content"]')).toBeVisible();
});

test('mark-all-read empties the unread tab and clears the badge', async ({ page }) => {
  await mentionSara();
  const api = await signIn(page, MEMBER);

  await page.goto('/notifications');
  await expect(page.getByTestId('notification-badge')).toBeVisible();

  await page.getByTestId('mark-all-read').click();

  await expect(page.getByTestId('notification-badge')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Unread' }).click();
  await expect(page.getByTestId('notification-row')).toHaveCount(0);

  // And the server agrees — the badge is not merely hidden.
  await expect
    .poll(async () => (await api.get<{ count: number }>('/notifications/unread-count')).count)
    .toBe(0);
});
