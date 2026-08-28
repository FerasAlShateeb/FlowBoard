import { expect, test, type Locator, type Page } from '../helpers/test';

import { taskKey } from '../helpers/api';
import {
  boardCard,
  boardCardList,
  boardColumn,
  columnOfCard,
  dragTo,
  expectToast,
  signIn,
  waitForBoard,
} from '../helpers/app';
import { PROJECT_ADMIN, CORE, FLOW, unique, viewPath } from '../helpers/seed';

/**
 * The Kanban board: what it shows, and what it refuses.
 *
 * Two projects, on purpose. FLOW has the DEFAULT workflow — three columns, no
 * transition rows, no WIP limit — so a drag there is the happy path. CORE has
 * the custom one: five columns, a whitelist, and an "In Progress" column seeded
 * exactly at its limit of three. Every rule the board enforces is therefore
 * testable without editing a workflow first, which is what keeps this spec
 * re-runnable.
 */

/**
 * A drag that PAUSES over the target so the drop feedback can be asserted, then
 * releases.
 *
 * `dragTo` in the helpers is the fire-and-forget version. A blocked drop has two
 * separate observable halves — the column says "you cannot put that here" while
 * the pointer is over it, and the card does not move when the button comes up —
 * and only this shape can see both.
 */
async function dragAndInspect(
  page: Page,
  card: Locator,
  list: Locator,
  inspect: () => Promise<void>,
): Promise<void> {
  const from = await card.boundingBox();
  const to = await list.boundingBox();
  if (!from || !to) throw new Error('drag endpoints are not laid out');

  const startX = from.x + from.width / 2;
  const startY = from.y + 12;
  const endX = to.x + to.width / 2;
  const endY = to.y + Math.min(to.height / 2, 40);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 12, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 16 });
  await page.mouse.move(endX, endY + 6, { steps: 4 });
  await inspect();
  await page.mouse.up();
}

test('every column renders exactly the cards the server puts in it', async ({ page }) => {
  const api = await signIn(page, PROJECT_ADMIN);
  const project = await api.project(FLOW.key);
  const statuses = await api.statuses(project.id);
  const columns = await api.board(project.id);

  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);

  for (const status of statuses) {
    const column = boardColumn(page, status.id);
    await expect(column, `column ${status.name} is on screen`).toBeVisible();
    // Compared against the SERVER's answer rather than a hard-coded number: the
    // seed's distribution comes from a seeded PRNG, and pinning the counts here
    // would turn any seed tweak into three unexplained failures.
    await expect(column.locator('[data-slot="board-card-sortable"]')).toHaveCount(
      (columns[status.id] ?? []).length,
    );
  }
});

test('a card dragged to another column stays there across a reload', async ({ page }) => {
  const api = await signIn(page, PROJECT_ADMIN);
  const project = await api.project(FLOW.key);
  const [todo, inProgress] = await Promise.all([
    api.status(project.id, 'To Do'),
    api.status(project.id, 'In Progress'),
  ]);

  const moving = (await api.column(project.id, todo.id))[0];
  if (!moving) throw new Error('the seeded To Do column is empty');
  const movingKey = taskKey(FLOW.key, moving);

  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);
  await expect(boardCard(page, movingKey)).toBeVisible();

  await dragTo(page, boardCard(page, movingKey), boardCardList(page, inProgress.id));

  // The optimistic splice is not the assertion — a reload reads the database,
  // which is the only thing that can tell an optimistic write from a persisted
  // one.
  await expect.poll(() => columnOfCard(page, movingKey)).toBe(inProgress.id);
  await page.reload();
  await waitForBoard(page);
  await expect.poll(() => columnOfCard(page, movingKey)).toBe(inProgress.id);

  // Put it back, through the API — restoring by dragging would make the cleanup
  // as flaky as the thing it is cleaning up after.
  await api.post(`/tasks/${moving.id}/move`, { statusId: todo.id });
});

test('a full WIP column shows its limit and refuses the drop', async ({ page }) => {
  const api = await signIn(page, PROJECT_ADMIN);
  const project = await api.project(CORE.key);
  const [selected, wip] = await Promise.all([
    api.status(project.id, 'Selected'),
    api.status(project.id, CORE.wipColumn),
  ]);

  // The seed fills this column to exactly its limit — see `buildCoreDrafts`.
  expect(wip.wipLimit).toBe(CORE.wipLimit);
  const before = await api.column(project.id, wip.id);
  expect(before).toHaveLength(CORE.wipLimit);

  await page.goto(viewPath(CORE.key, 'board'));
  await waitForBoard(page);

  const badge = boardColumn(page, wip.id).locator('[data-slot="wip-badge"]');
  await expect(badge).toHaveAttribute('data-wip', 'at-limit');
  await expect(badge).toHaveText(`${String(CORE.wipLimit)}/${String(CORE.wipLimit)}`);

  const candidate = (await api.column(project.id, selected.id))[0];
  if (!candidate) throw new Error('the seeded Selected column is empty');
  const candidateKey = taskKey(CORE.key, candidate);

  const targetList = boardCardList(page, wip.id);
  await dragAndInspect(page, boardCard(page, candidateKey), targetList, async () => {
    // `Selected → In Progress` IS a legal transition; the only thing standing in
    // the way is the limit, which the board pre-checks client-side from the
    // project detail so the refusal is instant rather than a round trip.
    await expect(targetList).toHaveAttribute('data-drop-blocked', 'true');
    await expect(
      boardColumn(page, wip.id).getByText(`${CORE.wipColumn} is already at its limit`),
    ).toBeVisible();
  });

  await expect.poll(() => columnOfCard(page, candidateKey)).toBe(selected.id);
  // And the server agrees: nothing was written behind the refusal.
  expect(await api.column(project.id, wip.id)).toHaveLength(CORE.wipLimit);
});

test('a move outside the transition whitelist is refused', async ({ page }) => {
  const api = await signIn(page, PROJECT_ADMIN);
  const project = await api.project(CORE.key);
  const [from, to] = await Promise.all([
    api.status(project.id, CORE.forbidden.from),
    api.status(project.id, CORE.forbidden.to),
  ]);

  const candidate = (await api.column(project.id, from.id))[0];
  if (!candidate) throw new Error(`the seeded ${CORE.forbidden.from} column is empty`);
  const candidateKey = taskKey(CORE.key, candidate);

  await page.goto(viewPath(CORE.key, 'board'));
  await waitForBoard(page);

  const targetList = boardCardList(page, to.id);
  await dragAndInspect(page, boardCard(page, candidateKey), targetList, async () => {
    await expect(targetList).toHaveAttribute('data-drop-blocked', 'true');
    await expect(boardColumn(page, to.id).getByText('That move is not allowed')).toBeVisible();
  });

  await expect.poll(() => columnOfCard(page, candidateKey)).toBe(from.id);

  // The server enforces the same rule independently — the client-side pre-check
  // is a courtesy, not the boundary.
  const rejection = await api.expectFailure('POST', `/tasks/${candidate.id}/move`, {
    statusId: to.id,
  });
  expect(rejection.status).toBeGreaterThanOrEqual(400);
  expect((await api.taskByKey(project.id, candidateKey)).statusId).toBe(from.id);
});

test('quick-add creates a card in the column it was opened from', async ({ page }) => {
  const api = await signIn(page, PROJECT_ADMIN);
  const project = await api.project(FLOW.key);
  const todo = await api.status(project.id, 'To Do');
  const title = unique('quick-add');

  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);

  const column = boardColumn(page, todo.id);
  await column.getByRole('button', { name: 'Add a card to To Do' }).first().click();
  await column.getByLabel('New card in To Do').fill(title);
  await column.getByLabel('New card in To Do').press('Enter');

  await expectToast(page, /^Created FLOW-\d+$/u);
  await expect(column.getByText(title)).toBeVisible();

  // The card is in the DATABASE, in that column — not merely on screen.
  const created = (await api.column(project.id, todo.id)).find((task) => task.title === title);
  expect(created).toBeDefined();
  if (created) await api.delete(`/tasks/${created.id}`);
});

test('the filter bar narrows the board, and the swimlane switch regroups it', async ({ page }) => {
  const api = await signIn(page, PROJECT_ADMIN);
  const project = await api.project(FLOW.key);
  const columns = await api.board(project.id);
  const total = Object.values(columns).reduce((sum, tasks) => sum + tasks.length, 0);

  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);

  const cards = page.locator('[data-slot="board-card-sortable"]');
  await expect(cards).toHaveCount(total);

  // A fragment of one seeded title. The search is debounced 300 ms before it
  // reaches the query, so this asserts on the RESULT rather than on a timer.
  await page.getByLabel('Search cards by title or key').fill('swimlane');
  await expect.poll(async () => cards.count()).toBeLessThan(total);
  await expect.poll(async () => cards.count()).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(cards).toHaveCount(total);

  await page.getByLabel('Swimlanes').click();
  await page.getByRole('option', { name: 'Group by assignee' }).click();

  const lanes = page.locator('[data-slot="swimlane"]');
  await expect.poll(async () => lanes.count()).toBeGreaterThan(1);
  // Regrouping must not lose cards: every task is still on the board, just in a
  // different arrangement of boxes.
  await expect(cards).toHaveCount(total);
});
