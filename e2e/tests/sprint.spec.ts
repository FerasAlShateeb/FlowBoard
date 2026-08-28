import { expect, test, type Page } from '../helpers/test';

import { dragTo, expectToast, signIn, waitForBoard } from '../helpers/app';
import { LIFECYCLE_TEST_COST, reserveApiBudget } from '../helpers/rate-budget';
import { CORE_ADMIN, CORE, unique, viewPath } from '../helpers/seed';

/**
 * Backlog ordering and the sprint lifecycle.
 *
 * CORE rather than FLOW, deliberately. This spec MUTATES sprint state — it
 * finishes the project's running sprint and starts another — and CORE is the
 * project no other spec depends on the sprint arrangement of. It is also the one
 * with no completed sprint in the seed, which makes "the velocity chart gained a
 * bar" a statement about zero becoming one rather than about n becoming n+1.
 */

/** The task keys currently rendered in the backlog section, in order. */
function backlogOrder(page: Page): Promise<string[]> {
  return page
    .locator('[data-slot="backlog-section"] li[data-slot="backlog-row"] a[href*="/t/"]')
    .evaluateAll((nodes: Element[]) =>
      nodes.map((node) => (node.getAttribute('href') ?? '').split('/t/')[1] ?? ''),
    );
}

test('a backlog row dragged up the list stays there across a reload', async ({ page }) => {
  await signIn(page, CORE_ADMIN);
  await page.goto(viewPath(CORE.key, 'backlog'));

  const rows = page.locator('[data-slot="backlog-section"] li[data-slot="backlog-row"]');
  await expect(rows.first()).toBeVisible();
  const before = await backlogOrder(page);
  expect(before.length).toBeGreaterThan(3);

  // The handle is the activator (`setActivatorNodeRef`); the row body is a link.
  // It only becomes opaque on hover, which is styling — it is in the DOM and
  // hit-testable throughout.
  const moved = before[2];
  if (moved === undefined) throw new Error('the seeded backlog is too short');

  const third = rows.nth(2);
  await third.hover();
  // Aimed at the TOP of the first row: `closestCenter` resolves the insertion
  // point from where the pointer is when the button comes up, so the drop lands
  // above rather than merely near it.
  await dragTo(page, third.getByRole('button', { name: 'Reorder task' }), rows.first(), {
    targetOffsetY: 4,
  });

  // The rank is recomputed SERVER-side from the neighbour ids, so the only
  // honest check is what comes back on a fresh read.
  await page.reload();
  await expect(rows.first()).toBeVisible();
  await expect.poll(() => backlogOrder(page)).not.toEqual(before);

  const after = await backlogOrder(page);
  // The list is REORDERED, not rewritten: same rows, same length, and the one
  // that was dragged is nearer the top. Pinning the exact landing index would be
  // asserting dnd-kit's collision arithmetic rather than the backlog's rank.
  expect(after).toHaveLength(before.length);
  expect([...after].sort()).toEqual([...before].sort());
  expect(after.indexOf(moved)).toBeLessThan(before.indexOf(moved));
});

test('a sprint is created, filled, started, and the finished one lands in velocity', async ({
  page,
}) => {
  test.setTimeout(180_000);

  // Four sprint mutations, two full reloads and a board walk — well past what a
  // typical test spends. See `helpers/rate-budget.ts`.
  await reserveApiBudget(LIFECYCLE_TEST_COST);

  const api = await signIn(page, CORE_ADMIN);
  const project = await api.project(CORE.key);
  const sprintName = unique('E2E Sprint');

  // CORE has never completed a sprint, so velocity starts empty.
  const velocity = async (): Promise<number> =>
    (await api.get<{ sprints: unknown[] }>(`/projects/${project.id}/reports/velocity`)).sprints
      .length;
  expect(await velocity()).toBe(0);

  await page.goto(viewPath(CORE.key, 'backlog'));
  await expect(page.locator('[data-slot="backlog-section"]')).toBeVisible();

  await test.step('a new sprint is planned', async () => {
    await page.getByRole('button', { name: 'New sprint' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(sprintName);
    await dialog.getByLabel('Goal').fill('Prove the lifecycle end to end.');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expectToast(page, 'Sprint created');

    const created = (await api.sprints(project.id)).find((sprint) => sprint.name === sprintName);
    expect(created?.state).toBe('planned');
  });

  const plannedSection = page
    .locator('[data-slot="sprint-section"]')
    .filter({ hasText: sprintName });

  await test.step('a backlog task is dragged into it', async () => {
    const backlogRows = page.locator('[data-slot="backlog-section"] li[data-slot="backlog-row"]');
    await expect(backlogRows.first()).toBeVisible();
    const moving = (await backlogOrder(page))[0] ?? '';
    expect(moving).not.toBe('');

    const row = backlogRows.first();
    await row.hover();
    // The EMPTY-STATE BODY, not the section box: the section's bounding box
    // starts at its header, and a drop landing there resolves against whichever
    // bucket the header overlaps — which put the first attempt in the sprint
    // above. `TaskRowList` registers the same droppable for its empty message.
    await dragTo(
      page,
      row.getByRole('button', { name: 'Reorder task' }),
      plannedSection.getByText('Nothing planned yet'),
    );

    // `POST /tasks/:id/rank` with `sprintId` — the backlog's twin of the board's
    // move. Asserted on the server, because the section it now appears under is
    // the optimistic splice until proven otherwise.
    const task = await api.taskByKey(project.id, moving);
    const sprint = (await api.sprints(project.id)).find((item) => item.name === sprintName);
    await expect.poll(async () => (await api.task(task.id)).sprintId).toBe(sprint?.id);
  });

  await test.step('the running sprint is completed, leftovers to the backlog', async () => {
    const active = page
      .locator('[data-slot="sprint-section"][data-state="active"]')
      .filter({ hasText: CORE.activeSprint });
    await expect(active).toBeVisible();

    await active.getByRole('button', { name: 'Sprint actions' }).click();
    await page.getByRole('menuitem', { name: 'Complete sprint' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`Complete ${CORE.activeSprint}`)).toBeVisible();
    // "Where does the unfinished work go?" has no default answer that could be
    // wrong silently — there is no "leave it here" option, which is what keeps
    // `completedPoints` a fact.
    await dialog.getByRole('radio', { name: 'Backlog' }).check();
    await dialog.getByRole('button', { name: 'Complete sprint' }).click();
    await expectToast(page, `${CORE.activeSprint} completed`);

    // ONE bar where there were none: `completedPoints` is stamped at completion,
    // and the velocity report reads exactly that.
    await expect.poll(velocity, { timeout: 20_000 }).toBe(1);
  });

  await test.step('the planned sprint starts, with the dates the dialog asks for', async () => {
    await plannedSection.getByRole('button', { name: 'Sprint actions' }).click();
    await page.getByRole('menuitem', { name: 'Start sprint' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`Start ${sprintName}`)).toBeVisible();
    // Dates are REQUIRED to start even though the column is nullable — a running
    // sprint with no end date has no burndown x-axis. The dialog pre-fills a
    // fortnight; this asserts they are really there rather than retyping them.
    await expect(dialog.getByLabel('Start date')).not.toBeEmpty();
    await expect(dialog.getByLabel('End date')).not.toBeEmpty();
    await dialog.getByRole('button', { name: 'Start sprint' }).click();
    await expectToast(page, `${sprintName} is now running`);

    await expect(plannedSection).toHaveAttribute('data-state', 'active');
    const sprints = await api.sprints(project.id);
    expect(sprints.find((sprint) => sprint.name === sprintName)?.state).toBe('active');
    // One active sprint per project, enforced by a partial unique index — the
    // one we just finished must not still be running.
    expect(sprints.filter((sprint) => sprint.state === 'active')).toHaveLength(1);
  });

  await test.step('the board still shows the work, now under the new sprint', async () => {
    await page.goto(viewPath(CORE.key, 'board'));
    await waitForBoard(page);
    const sprint = (await api.sprints(project.id)).find((item) => item.name === sprintName);
    const inSprint = Object.values(await api.board(project.id))
      .flat()
      .filter((task) => task.sprintId === sprint?.id);
    expect(inSprint.length).toBeGreaterThan(0);
    for (const task of inSprint) {
      await expect(
        page.locator(`[data-slot="board-card"][data-task-id="${task.id}"]`),
      ).toBeVisible();
    }
  });
});
