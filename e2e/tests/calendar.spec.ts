import { expect, test } from '../helpers/test';

import { dragTo, signIn } from '../helpers/app';
import { MEMBER, FLOW, viewPath } from '../helpers/seed';

/**
 * The calendar: dates as a place you can drop things.
 *
 * Both mutations here are asserted against the SERVER, not against the chip's
 * new position. A chip that moved because the optimistic cache moved it, over a
 * PATCH that 400ed, looks identical on screen — and that is precisely the bug
 * a calendar drag is most likely to have.
 */

test('seeded due dates appear as chips on the grid', async ({ page }) => {
  const api = await signIn(page, MEMBER);
  const project = await api.project(FLOW.key);
  const dated = Object.values(await api.board(project.id))
    .flat()
    .filter((task) => task.dueDate !== null);
  expect(dated.length).toBeGreaterThan(0);

  await page.goto(viewPath(FLOW.key, 'calendar'));
  await expect(page.locator('[data-calendar-chip]').first()).toBeVisible();
  // Not every dated task falls inside the month on screen, so the assertion is
  // "the grid drew some of them", not a count.
  await expect.poll(async () => page.locator('[data-calendar-chip]').count()).toBeGreaterThan(0);
});

test('dragging a chip to another day rewrites its due date', async ({ page }) => {
  const api = await signIn(page, MEMBER);

  await page.goto(viewPath(FLOW.key, 'calendar'));
  const chip = page.locator('[data-calendar-chip]').first();
  await expect(chip).toBeVisible();

  const taskId = await chip.getAttribute('data-task-id');
  const fromDay = await chip.getAttribute('data-day');
  if (taskId === null || fromDay === null) throw new Error('a chip is missing its identity');
  const before = await api.task(taskId);

  // A day cell in the same grid that is NOT the one the chip sits on. Reading
  // the keys off the DOM keeps this correct whatever month the run lands in.
  const dayKeys = await page
    .locator('[data-calendar-day]')
    .evaluateAll((nodes: Element[]) =>
      nodes.map((node) => node.getAttribute('data-calendar-day') ?? ''),
    );
  const index = dayKeys.indexOf(fromDay);
  const targetDay = dayKeys[index + 3] ?? dayKeys.find((key) => key !== fromDay);
  if (targetDay === undefined) throw new Error('the calendar rendered a single day');

  await dragTo(page, chip, page.locator(`[data-calendar-day="${targetDay}"]`));

  await expect
    .poll(async () => (await api.task(taskId)).dueDate, { timeout: 20_000 })
    .not.toBe(before.dueDate);

  // A span keeps its LENGTH when it is rescheduled — moving a task must not
  // silently make it longer (`reschedulePatch` preserves the duration).
  const after = await api.task(taskId);
  if (before.startDate !== null && before.dueDate !== null && after.startDate !== null) {
    const span = (from: string, to: string): number =>
      Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
    expect(span(after.startDate, after.dueDate ?? after.startDate)).toBe(
      span(before.startDate, before.dueDate),
    );
  }

  await api.patch(`/tasks/${taskId}`, {
    startDate: before.startDate,
    dueDate: before.dueDate,
  });
});

test('the unscheduled tray puts a dateless task on the calendar', async ({ page }) => {
  const api = await signIn(page, MEMBER);

  await page.goto(viewPath(FLOW.key, 'calendar'));
  await expect(page.locator('[data-calendar-chip]').first()).toBeVisible();

  await page.getByRole('button', { name: /Unscheduled/u }).click();
  const tray = page.getByRole('complementary', { name: 'Unscheduled' });
  await expect(tray).toBeVisible();

  const row = tray.locator('[data-calendar-chip]').first();
  await expect(row).toBeVisible();
  const taskId = await row.getAttribute('data-task-id');
  if (taskId === null) throw new Error('a tray row is missing its task id');
  // The tray is, by definition, the tasks with neither date.
  expect(await api.task(taskId)).toMatchObject({ startDate: null, dueDate: null });

  await tray.getByRole('button', { name: 'Schedule for today' }).first().click();

  await expect
    .poll(async () => (await api.task(taskId)).dueDate, { timeout: 20_000 })
    .not.toBeNull();
  // And it leaves the tray, because the tray is a query, not a list.
  await expect(tray.locator(`[data-task-id="${taskId}"]`)).toHaveCount(0);

  await api.patch(`/tasks/${taskId}`, { startDate: null, dueDate: null });
});
