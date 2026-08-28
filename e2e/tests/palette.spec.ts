import { expect, test } from '../helpers/test';

import { signIn, waitForBoard } from '../helpers/app';
import { MEMBER_2, FLOW, viewPath } from '../helpers/seed';

/**
 * The command palette and the shortcut registry behind it.
 *
 * Both are keyboard-only surfaces, which is exactly why they need an end-to-end
 * test: a unit test can call the handler, but only a browser can prove that the
 * chord reaches it — that nothing swallowed the keydown, that the dialog took
 * focus, and that Enter on a highlighted row navigates.
 */

test('Ctrl+K jumps to another view of the current project', async ({ page }) => {
  await signIn(page, MEMBER_2);
  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);

  await page.keyboard.press('Control+k');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();

  await page.getByRole('combobox', { name: 'Search or run a command' }).fill('Backlog');
  await palette.getByRole('option', { name: 'Backlog' }).first().click();

  await page.waitForURL(`**${viewPath(FLOW.key, 'backlog')}`);
  await expect(palette).toBeHidden();
});

test('a search of three characters finds a task and Enter opens its sheet', async ({ page }) => {
  const api = await signIn(page, MEMBER_2);
  const project = await api.project(FLOW.key);
  // A real seeded title, read from the server rather than pasted here — the seed
  // shuffles which task ends up where, but the titles themselves are fixed.
  const target = (await api.column(project.id, (await api.statuses(project.id))[0]?.id ?? ''))[0];
  if (!target) throw new Error('the first seeded column is empty');

  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);

  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Search or run a command' });

  // Two characters is deliberately below the palette's floor (SEARCH_MIN_CHARS
  // is 3): the task lane must not even be rendered, let alone queried.
  await input.fill(target.title.slice(0, 2));
  await expect(page.getByTestId('palette-tasks-lane')).toHaveCount(0);

  await input.fill(target.title.slice(0, 18));
  const lane = page.getByTestId('palette-tasks-lane');
  await expect(lane).toBeVisible();
  await expect(lane.getByText(target.title, { exact: false }).first()).toBeVisible();

  await lane.getByRole('option').first().click();
  await page.waitForURL(/\/t\/[A-Z]+-\d+/u);
});

test('the "?" cheat sheet lists the chords that are actually registered', async ({ page }) => {
  await signIn(page, MEMBER_2);
  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);

  await page.keyboard.press('Shift+Slash');

  const sheet = page.getByTestId('cheat-sheet');
  await expect(sheet).toBeVisible();

  // The rows are rendered FROM the live registry (`lib/shortcuts.ts`), not from
  // a hand-written list, so their presence is evidence the chords exist.
  const list = page.getByTestId('shortcuts-list');
  await expect(list.getByText('Open the command palette')).toBeVisible();
  await expect(list.getByText('Show this list')).toBeVisible();
  await expect(list.getByText('Create a task in this project')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
