import { expect, test } from '../helpers/test';

import { signIn, waitForBoard } from '../helpers/app';
import { MEMBER_2, FLOW, viewPath } from '../helpers/seed';

/** Arabic-Indic digits — the ones FlowBoard deliberately never renders. */
const ARABIC_INDIC = /[٠-٩۰-۹]/u;

/**
 * Arabic, and the right-to-left layout that comes with it.
 *
 * Switching language is a whole-document operation: `lang-policy.ts` restamps
 * `<html lang>` and `<html dir>` synchronously, i18next swaps catalogues, and
 * Radix's `Direction.Provider` flips every primitive underneath. None of that is
 * observable without a real document, which is why the RTL check lives here
 * rather than in a component test.
 */

test('switching to Arabic mirrors the app, and switching back restores it', async ({ page }) => {
  await signIn(page, MEMBER_2);
  await page.goto(viewPath(FLOW.key, 'board'));
  await waitForBoard(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: 'العربية' }).click();

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

  // The board still draws. A layout that mirrors but loses its columns is the
  // failure mode worth catching, and it is invisible to a `dir` assertion.
  await waitForBoard(page);
  const columns = page.locator('[data-slot="board-column"]');
  await expect.poll(async () => columns.count()).toBe(FLOW.statuses.length);

  // The task sheet opens over the mirrored board and renders its own chrome.
  await page.locator('[data-slot="board-card-sortable"]').first().click();
  await page.waitForURL(/\/t\/[A-Z]+-\d+/u);
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();

  // WESTERN DIGITS. The locale is pinned to `ar-u-nu-latn`, so an Arabic page
  // must still count 1, 2, 3 — dates, points and counts included. Asserting on
  // the whole rendered document is the only version of this that cannot be
  // satisfied by one lucky element.
  const text = (await page.locator('body').innerText()).replace(/\s+/gu, ' ');
  expect(text).toMatch(/\d/u);
  expect(text).not.toMatch(ARABIC_INDIC);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Language|اللغة/u }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
