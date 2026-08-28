import { expect, test, type Page } from '../helpers/test';

import { ApiClient, taskKey } from '../helpers/api';
import {
  boardCard,
  boardCardList,
  columnOfCard,
  dragTo,
  useSession,
  waitForBoard,
} from '../helpers/app';
import { observeApiCalls } from '../helpers/rate-budget';
import { ADMIN, FLOW, MEMBER, viewPath } from '../helpers/seed';

/**
 * Two browsers, one project.
 *
 * This is the only file that can test the realtime layer at all. Everything
 * underneath it — the domain-event bus, the room membership check, the echo
 * suppression keyed on `X-Socket-Id`, the cache patch on the receiving end —
 * exists solely so that what one person does appears on someone else's screen
 * WITHOUT A RELOAD, and "without a reload" is not a property a single page can
 * demonstrate.
 */

test('one person drags, the other sees it, and a mention rings the bell', async ({ browser }) => {
  test.setTimeout(180_000);

  const [adaSession, saraSession] = await Promise.all([
    ApiClient.session(ADMIN.email, ADMIN.password),
    ApiClient.session(MEMBER.email, MEMBER.password),
  ]);
  const ada = ApiClient.fromSession(adaSession);
  const sara = ApiClient.fromSession(saraSession);

  const project = await ada.project(FLOW.key);
  const [todo, inProgress] = await Promise.all([
    ada.status(project.id, 'To Do'),
    ada.status(project.id, 'In Progress'),
  ]);

  // Separate CONTEXTS, not just separate pages: two pages in one context share a
  // storage partition, so they would share a session and there would be only one
  // person in the room.
  const adaContext = await browser.newContext();
  const saraContext = await browser.newContext();
  // Contexts this spec builds itself are outside the automatic fixture, so they
  // opt into the request budget by hand — see `helpers/rate-budget.ts`.
  observeApiCalls(adaContext);
  observeApiCalls(saraContext);

  try {
    const adaPage: Page = await adaContext.newPage();
    const saraPage: Page = await saraContext.newPage();
    await useSession(adaPage, adaSession);
    await useSession(saraPage, saraSession);

    const moving = (await ada.column(project.id, todo.id))[0];
    if (!moving) throw new Error('the seeded To Do column is empty');
    const movingKey = taskKey(FLOW.key, moving);

    await Promise.all([
      adaPage.goto(viewPath(FLOW.key, 'board')),
      saraPage.goto(viewPath(FLOW.key, 'board')),
    ]);
    await Promise.all([waitForBoard(adaPage), waitForBoard(saraPage)]);
    await expect(boardCard(saraPage, movingKey)).toBeVisible();
    expect(await columnOfCard(saraPage, movingKey)).toBe(todo.id);

    await test.step('a drag in one browser lands in the other', async () => {
      const before = await columnOfCard(saraPage, movingKey);
      expect(before).toBe(todo.id);

      await dragTo(adaPage, boardCard(adaPage, movingKey), boardCardList(adaPage, inProgress.id));

      // NO RELOAD ANYWHERE. Sara's board is patched by a `task:moved` event that
      // the server emitted to the project room `except` the socket that caused
      // it — which is also why Ada's own board is written by her optimistic
      // update rather than by the echo.
      await expect
        .poll(() => columnOfCard(saraPage, movingKey), { timeout: 30_000 })
        .toBe(inProgress.id);
      await expect.poll(() => columnOfCard(adaPage, movingKey)).toBe(inProgress.id);
    });

    await test.step('a mention from one browser rings the other one’s bell', async () => {
      const unreadBefore = (await ada.get<{ count: number }>('/notifications/unread-count')).count;

      await saraPage.goto(`${viewPath(FLOW.key, 'board')}/t/${movingKey}`);
      const sheet = saraPage.locator('[data-slot="sheet-content"]');
      await expect(sheet).toBeVisible();

      const composer = sheet.getByRole('combobox', { name: 'Comments' });
      await composer.click();
      await composer.pressSequentially('@Ada');
      await expect(saraPage.getByRole('listbox', { name: 'Mention someone' })).toBeVisible();
      await composer.press('Enter');
      await composer.pressSequentially(' can you review this?');
      await sheet.getByRole('button', { name: 'Comment' }).click();
      await expect(sheet.getByText('can you review this?')).toBeVisible();

      // The bell updates from a `notification:new` push into Ada's own user
      // room, on the board page she never left.
      const badge = adaPage.getByTestId('notification-badge');
      await expect(badge).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(async () => Number((await badge.innerText()).trim()), { timeout: 30_000 })
        .toBeGreaterThan(unreadBefore);
    });

    await test.step('opening the notification lands on the task it is about', async () => {
      await adaPage.getByTestId('notification-bell').click();
      const panel = adaPage.getByTestId('notification-panel');
      await expect(panel).toBeVisible();

      await panel.getByTestId('notification-row').filter({ hasText: MEMBER.name }).first().click();

      await adaPage.waitForURL(new RegExp(`/p/${FLOW.key}/board/t/${movingKey}$`, 'u'));
      await expect(adaPage.locator('[data-slot="sheet-content"]')).toBeVisible();
    });

    // Put the seed back the way it was found.
    await ada.post(`/tasks/${moving.id}/move`, { statusId: todo.id });
    expect(sara.user.email).toBe(MEMBER.email);
  } finally {
    await adaContext.close();
    await saraContext.close();
  }
});
