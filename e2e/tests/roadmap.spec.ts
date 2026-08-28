import { expect, test } from '../helpers/test';

import { signIn } from '../helpers/app';
import { CORE_ADMIN, FLOW, viewPath } from '../helpers/seed';

/**
 * The roadmap: a hand-built Gantt, and the only view whose geometry is ours.
 *
 * Bars, arrows and the today line all resolve their pixels through one hook
 * (`useGanttGeometry`), which has its own unit tests. What those cannot see is
 * whether the pixels line up with a real DOM, whether a pointer drag survives
 * capture and the 3px threshold, and whether the committed PATCH matches the
 * days the user dropped on. That is this file.
 */

test('bars and dependency arrows are drawn for the seeded plan', async ({ page }) => {
  const api = await signIn(page, CORE_ADMIN);
  const project = await api.project(FLOW.key);
  const { edges } = await api.get<{ edges: { blockerTaskId: string; blockedTaskId: string }[] }>(
    `/projects/${project.id}/dependencies`,
  );
  expect(edges.length).toBeGreaterThan(0);

  await page.goto(viewPath(FLOW.key, 'roadmap'));
  await expect(page.getByTestId('gantt-canvas')).toBeVisible();
  await expect.poll(async () => page.getByTestId('gantt-bar').count()).toBeGreaterThan(0);
  await expect(page.getByTestId('gantt-sidebar-row').first()).toBeVisible();

  // The arrow layer only mounts when there is at least one edge whose BOTH ends
  // are on screen and dated — so its presence is the real assertion, and the
  // path count merely says it drew something.
  const layer = page.getByTestId('gantt-dependency-layer');
  await expect(layer).toBeAttached();
  await expect.poll(async () => layer.locator('path').count()).toBeGreaterThan(0);
});

test('dragging a bar sideways moves the task, whole days at a time', async ({ page }) => {
  const api = await signIn(page, CORE_ADMIN);
  const project = await api.project(FLOW.key);

  await page.goto(viewPath(FLOW.key, 'roadmap'));
  await expect(page.getByTestId('gantt-bar').first()).toBeVisible();

  /**
   * A bar that is actually draggable.
   *
   * NOT `.first()`: the sidebar tree puts epics at the top, and an epic whose
   * dates are ROLLED UP from its children refuses the gesture on purpose
   * (`draggable = editable && !(isEpic && rolledUp)` in `GanttBar.tsx`) — moving
   * the roll-up would mean silently moving every child. So the subject is picked
   * from the tasks that own their own dates.
   */
  const candidates = Object.values(await api.board(project.id))
    .flat()
    .filter((task) => task.type !== 'epic' && task.startDate !== null && task.dueDate !== null);

  let bar = null;
  let taskId = '';
  for (const task of candidates) {
    const located = page.locator(`[data-testid="gantt-bar"][data-task-id="${task.id}"]`);
    if ((await located.count()) > 0) {
      bar = located;
      taskId = task.id;
      break;
    }
  }
  if (bar === null) throw new Error('no draggable bar is rendered for the seeded plan');

  const before = await api.task(taskId);
  await bar.scrollIntoViewIfNeeded();
  const box = await bar.boundingBox();
  if (!box) throw new Error('the bar is not laid out');

  // Pointer events with capture, not dnd-kit: `GanttBar` handles them itself.
  // The first move must clear `DRAG_THRESHOLD_PX` (3) or the gesture is treated
  // as a click and opens the task instead of moving it.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2, { steps: 15 });
  await page.mouse.up();

  await expect
    .poll(async () => (await api.task(taskId)).startDate, { timeout: 20_000 })
    .not.toBe(before.startDate);

  const after = await api.task(taskId);
  const days = (from: string | null, to: string | null): number =>
    from === null || to === null
      ? Number.NaN
      : Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

  // Rightwards, by a whole number of days, keeping its length: `deltaDaysFromPx`
  // rounds to the nearest day and the resize path is the only one that changes
  // duration.
  const shift = days(before.startDate, after.startDate);
  expect(shift).toBeGreaterThan(0);
  expect(Number.isInteger(shift)).toBe(true);
  expect(days(after.startDate, after.dueDate)).toBe(days(before.startDate, before.dueDate));

  await api.patch(`/tasks/${taskId}`, {
    startDate: before.startDate,
    dueDate: before.dueDate,
  });
});

test('changing zoom keeps today on screen', async ({ page }) => {
  await signIn(page, CORE_ADMIN);
  await page.goto(viewPath(FLOW.key, 'roadmap'));
  await expect(page.getByTestId('gantt-canvas')).toBeVisible();

  // Month is the default zoom, and the seed spans dates either side of today.
  await expect(page.getByTestId('gantt-zoom-month')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('gantt-today-line')).toBeVisible();

  for (const level of ['week', 'quarter'] as const) {
    await page.getByTestId(`gantt-zoom-${level}`).click();
    await expect(page.getByTestId(`gantt-zoom-${level}`)).toHaveAttribute('aria-pressed', 'true');
    // The axis is rebuilt at every zoom; the today marker is derived from the
    // same geometry, so losing it would mean the two had drifted apart.
    await expect(page.getByTestId('gantt-today-line')).toBeVisible();
    await expect.poll(async () => page.getByTestId('gantt-bar').count()).toBeGreaterThan(0);
  }
});
