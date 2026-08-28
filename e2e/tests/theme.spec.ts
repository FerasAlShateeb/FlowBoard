import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '../helpers/test';

import { expectToast, signIn } from '../helpers/app';
import { MEMBER } from '../helpers/seed';

/**
 * Theme Studio: applying, persisting, and round-tripping a theme document.
 *
 * The assertion that matters is always the CSS CUSTOM PROPERTY on `<html>`.
 * `applyTheme()` writes the whole token set there as inline styles, and every
 * component — including the charts, which may read `--chart-*` only — resolves
 * its colour through them. A test that checked the store or the localStorage
 * blob would pass on a build where nothing on screen actually changed.
 */

/** The live value of one theme token, as the browser has resolved it. */
function token(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (property: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );
}

test('a preset applies live, saves, survives a reload, and resets', async ({ page }) => {
  await signIn(page, MEMBER);
  await page.goto('/theme');

  const initial = await token(page, '--primary');
  expect(initial).not.toBe('');

  await page.getByRole('button', { name: 'Apply Ocean' }).click();
  await expectToast(page, /Ocean applied/u);
  const ocean = await token(page, '--primary');
  expect(ocean).not.toBe(initial);

  // Applying is live but NOT persistent — that is what the Save button is for,
  // and the distinction is the whole reason the button exists.
  // Scoped to the page's action bar: the live PREVIEW panel renders its own
  // inert "Save" button as part of the mock UI it is previewing.
  const actions = page.getByRole('group', { name: 'Theme actions' });
  await actions.getByRole('button', { name: 'Save' }).click();
  await expectToast(page, 'Theme saved to this device.');

  await page.reload();
  await expect.poll(() => token(page, '--primary')).toBe(ocean);
  const stored = await page.evaluate(() => window.localStorage.getItem('fb-theme-v1'));
  expect(stored).toContain('"themePreset":"Ocean"');

  await actions.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(() => token(page, '--primary')).toBe(initial);
});

test('a theme exports to JSON and imports back', async ({ page }) => {
  await signIn(page, MEMBER);
  await page.goto('/theme');
  const actions = page.getByRole('group', { name: 'Theme actions' });

  const initial = await token(page, '--primary');
  await page.getByRole('button', { name: 'Apply Forest' }).click();
  const forest = await token(page, '--primary');
  expect(forest).not.toBe(initial);

  // The export is a detached `<a download>` over a blob URL, so Playwright sees
  // it as a real download rather than a navigation.
  const downloading = page.waitForEvent('download');
  await actions.getByRole('button', { name: 'Export' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^flowboard-theme-\d{4}-\d{2}-\d{2}\.json$/u);

  const file = await download.path();
  const exported: unknown = JSON.parse(await readFile(file, 'utf8'));
  expect(exported).toMatchObject({ themePreset: 'Forest' });

  // Back to where we started, so the import has something to prove.
  await actions.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(() => token(page, '--primary')).toBe(initial);

  await actions.getByRole('button', { name: 'Import' }).click();
  const dialog = page.getByRole('dialog');
  // The file input is `sr-only`, which `setInputFiles` does not mind — the
  // visible "Choose file…" button only exists to click it for a human. Choosing
  // a file IMPORTS immediately (`ImportThemeDialog` submits from the FileReader
  // callback); the paste box beside it is the other half of the same dialog, for
  // JSON that arrived over chat rather than as a file.
  await dialog.getByLabel('Theme JSON file').setInputFiles(file);
  await expectToast(page, /Theme imported/iu);
  await expect(dialog).toBeHidden();

  // Round trip complete: the document that came out is the document that went
  // back in, token for token.
  await expect.poll(() => token(page, '--primary')).toBe(forest);
});
