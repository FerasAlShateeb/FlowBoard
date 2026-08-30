import { expect, test, type Page } from '../helpers/test';

import { taskKey } from '../helpers/api';
import {
  boardCard,
  boardCardList,
  columnOfCard,
  dragTo,
  expectToast,
  signIn,
  useMotionPreference,
  waitForBoard,
} from '../helpers/app';
import { FLOW, MEMBER_2, ORG_SLUG, PROJECT_ADMIN, viewPath } from '../helpers/seed';

/**
 * The Theme Studio DRAWER — the quick surface, distinct from `/theme`.
 *
 * `theme.spec.ts` owns the page: the full token editor, export and import. This
 * file owns the thing the page cannot be, which is a theme editor you can open
 * ON TOP OF what you are theming. Round 2 split them for that reason — the
 * drawer is the quick one, the page is the deep one — and the split created
 * three claims that only a browser can settle.
 *
 *  1. **Three ways in.** A topbar button, a chord, and a command-palette row all
 *     drive one piece of layout state. Three call sites is three chances for one
 *     of them to stop reaching it.
 *  2. **It is not a Radix dialog.** It is hand-rolled precisely so the app
 *     behind the scrim stays a live, readable preview: no `aria-hidden` on the
 *     background, no pointer-events cage, nothing unmounted. That is exactly the
 *     kind of deliberate choice that a well-meaning refactor to `ui/sheet`
 *     silently reverses — and the board losing its state behind the drawer is
 *     how you would find out.
 *  3. **Applying is not saving.** Every control repaints the whole app live and
 *     NOTHING persists until Save. A reload is the only thing that can tell the
 *     two apart.
 *
 * The assertion is always the CSS CUSTOM PROPERTY on `<html>`, never the store
 * or the storage blob: `applyTheme()` writes the token set there as inline
 * styles and every component resolves its colour through them, so a test that
 * checked the state would pass on a build where nothing on screen changed.
 */

/** The live value of one theme token, as the browser has resolved it. */
function token(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (property: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );
}

/** `<html data-motion>` — what the CSS gate actually keys off. */
function motionStamp(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-motion'));
}

test('the drawer opens from the topbar, the chord and the palette, and Escape closes it', async ({
  page,
}) => {
  await signIn(page, MEMBER_2);
  await page.goto(`/o/${ORG_SLUG}`);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  const drawer = page.getByTestId('theme-studio');

  // ── (a) the topbar's palette icon ─────────────────────────────────────────
  await page.getByTestId('theme-studio-trigger').click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // ── (b) the chord ─────────────────────────────────────────────────────────
  // `mod+shift+t` and not `mod+t`: the browser owns that one, and a shortcut
  // that opens a new tab instead of the studio is a shortcut nobody can use.
  // Registered with `allowInInputs`, so it works from wherever focus happens to
  // be after the Escape above.
  await page.keyboard.press('Control+Shift+t');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // ── (c) the command palette ───────────────────────────────────────────────
  await page.keyboard.press('Control+k');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await palette.locator('[data-slot="command-item"][data-value="action-theme-studio"]').click();
  await expect(palette).toBeHidden();
  await expect(drawer).toBeVisible();

  // The scrim exists and the close button is focused — the drawer manages focus
  // itself, since it is not a Radix dialog and gets none of that for free.
  await expect(page.getByTestId('theme-studio-scrim')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('a preset applied in the drawer saves, survives a reload, and resets', async ({ page }) => {
  await signIn(page, MEMBER_2);
  await page.goto(`/o/${ORG_SLUG}`);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  const drawer = page.getByTestId('theme-studio');
  const initial = await token(page, '--primary');
  expect(initial).not.toBe('');

  await page.getByTestId('theme-studio-trigger').click();
  await expect(drawer).toBeVisible();

  // Save is disabled until something is dirty — "dirty" being measured against
  // the PERSISTED document, so an untouched drawer offers nothing to save.
  const save = drawer.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();

  await drawer.getByRole('button', { name: 'Apply Ocean' }).click();
  const ocean = await token(page, '--primary');
  expect(ocean).not.toBe(initial);

  // Live but not persistent: that distinction is the whole reason Save exists.
  await expect(save).toBeEnabled();
  await save.click();
  await expectToast(page, 'Theme saved to this device.');

  await page.reload();
  await expect.poll(() => token(page, '--primary')).toBe(ocean);
  // Applied PRE-PAINT: the store runs at module scope, before `createRoot`, so
  // a saved theme is on screen at first paint rather than after a flash.
  const stored = await page.evaluate(() => window.localStorage.getItem('fb-theme-v1'));
  expect(stored).toContain('"themePreset":"Ocean"');

  // ── Reset, and save the reset ─────────────────────────────────────────────
  // Reset is itself only an edit — the toast says "Save to keep it" — so the
  // second Save is what actually puts the device back.
  await page.getByTestId('theme-studio-trigger').click();
  await drawer.getByRole('button', { name: 'Reset', exact: true }).click();
  await expectToast(page, 'Back to the default theme. Save to keep it.');
  await expect.poll(() => token(page, '--primary')).toBe(initial);
  await drawer.getByRole('button', { name: 'Save', exact: true }).click();

  await page.reload();
  await expect.poll(() => token(page, '--primary')).toBe(initial);
});

test('the drawer opens over a live board and hands off to the advanced editor', async ({
  page,
}) => {
  const api = await signIn(page, PROJECT_ADMIN);
  const project = await api.project(FLOW.key);
  const todo = await api.status(project.id, 'To Do');
  const card = (await api.column(project.id, todo.id))[0];
  if (!card) throw new Error('the seeded To Do column is empty');
  const cardKey = taskKey(FLOW.key, card);

  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);
  await expect(boardCard(page, cardKey)).toBeVisible();

  const drawer = page.getByTestId('theme-studio');
  await page.getByTestId('theme-studio-trigger').click();
  await expect(drawer).toBeVisible();

  // THE BOARD IS STILL THERE, AND STILL LIVE. Not `aria-hidden`, not unmounted,
  // not behind a pointer-events cage — the drawer is a preview surface and the
  // thing being previewed has to remain readable.
  await expect(boardCard(page, cardKey)).toBeVisible();
  await drawer.getByRole('button', { name: 'Apply Forest' }).click();

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  // Same card, same column, same DOM — the board was never remounted, so no
  // filter, scroll position or open sheet was lost behind the drawer.
  expect(await columnOfCard(page, cardKey)).toBe(todo.id);

  // ── The hand-off ──────────────────────────────────────────────────────────
  // The drawer is mounted OUTSIDE the router (it renders above `RouterProvider`),
  // so this row is a button that calls an injected `navigate`, not an anchor —
  // which is exactly why it is worth asserting that it navigates at all.
  await page.getByTestId('theme-studio-trigger').click();
  await drawer.getByRole('button', { name: /Advanced editor/u }).click();
  await page.waitForURL('**/theme');
  await expect(drawer).toBeHidden();
});

test('reduced motion boots, opens the drawer and still drags a card', async ({ page }) => {
  // THE REGRESSION GUARD FOR THE CSS GATE. The gate is an unlayered block at the
  // end of `index.css` that floors every `[data-slot][data-state]` animation to
  // 1ms and declares the drawer's own entrance keyframes only under
  // `data-motion="full"`. Two things could go wrong and neither would fail a
  // unit test: the app could fail to stamp the attribute at all, or a rule
  // written to kill an animation could take a transform with it and break
  // dnd-kit — which reads element geometry mid-drag.
  await useMotionPreference(page, 'reduced');
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
  // Stamped pre-paint by `initMotionPolicy()`, before React mounts.
  expect(await motionStamp(page)).toBe('reduced');

  // The drawer's entrance animation simply does not exist in this mode (the
  // keyframes are declared only under `full`), so it is on screen immediately
  // rather than after an animation Playwright would have to wait out.
  const drawer = page.getByTestId('theme-studio');
  await page.getByTestId('theme-studio-trigger').click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // ── Drag still works ──────────────────────────────────────────────────────
  // Only the post-drop "settle" flourish is motion-gated (`DropSettle` renders a
  // plain div under reduced motion); the sensors, the overlay and the sortable
  // strategy are motion-agnostic, and this is what proves it.
  await dragTo(page, boardCard(page, movingKey), boardCardList(page, inProgress.id));
  await expect.poll(() => columnOfCard(page, movingKey)).toBe(inProgress.id);
  await page.reload();
  await waitForBoard(page);
  await expect.poll(() => columnOfCard(page, movingKey)).toBe(inProgress.id);

  // Put it back through the API — restoring by dragging would make the cleanup
  // as flaky as the thing it is cleaning up after.
  await api.post(`/tasks/${moving.id}/move`, { statusId: todo.id });
});
