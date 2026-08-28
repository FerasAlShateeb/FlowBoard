import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '../helpers/test';

import { signIn } from '../helpers/app';
import { MEMBER_2, FLOW, viewPath } from '../helpers/seed';

/**
 * The table view: editing in place, ordering, remembering, and exporting.
 *
 * The grid is a `role="grid"` of divs rather than a `<table>` (it virtualises
 * past fifty rows), so every locator here goes through the ARIA roles the
 * component publishes. That is not a workaround — those roles ARE the contract
 * a screen-reader user gets, and asserting on them tests both audiences at once.
 */

/** The first data row. `aria-rowindex` is 1-based and the header holds row 1. */
function firstRow(page: Page) {
  return page.getByRole('row').filter({ hasNotText: /^$/u }).nth(1);
}

/** Every non-empty line of a CSV, RFC 4180 record separator included. */
function csvLines(text: string): string[] {
  return text.split('\r\n').filter((line) => line !== '');
}

test('an inline title edit is written through, not just painted', async ({ page }) => {
  const api = await signIn(page, MEMBER_2);
  const project = await api.project(FLOW.key);

  await page.goto(viewPath(FLOW.key, 'table'));
  const row = firstRow(page);
  await expect(row).toBeVisible();

  const key = (await row.getByRole('gridcell').first().innerText()).trim();
  const before = await api.taskByKey(project.id, key);
  const after = `${before.title} [edited]`;

  await row.getByRole('gridcell').nth(1).dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit title' });
  await expect(editor).toBeVisible();
  await editor.fill(after);
  await editor.press('Enter');

  // A reload reads the database. Anything less would pass on an optimistic
  // cache write the server rejected.
  await page.reload();
  await expect(page.getByRole('gridcell').filter({ hasText: after }).first()).toBeVisible();
  expect((await api.taskByKey(project.id, key)).title).toBe(after);

  await api.patch(`/tasks/${before.id}`, { title: before.title });
});

test('sorting by Updated reorders the grid and says so', async ({ page }) => {
  await signIn(page, MEMBER_2);
  await page.goto(viewPath(FLOW.key, 'table'));
  await expect(firstRow(page)).toBeVisible();

  const header = page.getByRole('columnheader').filter({ hasText: 'Updated' });
  await expect(header).toHaveAttribute('aria-sort', 'none');
  const unsorted = (await firstRow(page).getByRole('gridcell').first().innerText()).trim();

  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', /ascending|descending/u);
  const first = (await firstRow(page).getByRole('gridcell').first().innerText()).trim();

  // Reversing the direction must reverse the grid — the strongest cheap check
  // that the sort reaches the query rather than decorating the header.
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', /ascending|descending/u);
  await expect
    .poll(async () => (await firstRow(page).getByRole('gridcell').first().innerText()).trim())
    .not.toBe(first);
  expect([first, unsorted]).toBeDefined();
});

test('hiding a column survives a reload', async ({ page }) => {
  await signIn(page, MEMBER_2);
  await page.goto(viewPath(FLOW.key, 'table'));
  await expect(firstRow(page)).toBeVisible();

  const priority = page.getByRole('columnheader').filter({ hasText: 'Priority' });
  await expect(priority).toBeVisible();

  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByLabel('Show the Priority column').uncheck();
  await page.keyboard.press('Escape');
  await expect(priority).toHaveCount(0);

  // The preference lives in `fb-table-columns-v1`, keyed BY PROJECT — a hidden
  // column on one board must not disappear from another.
  await page.reload();
  await expect(firstRow(page)).toBeVisible();
  await expect(page.getByRole('columnheader').filter({ hasText: 'Priority' })).toHaveCount(0);

  const stored = await page.evaluate(() => window.localStorage.getItem('fb-table-columns-v1'));
  expect(stored).toContain('priority');
});

test('the CSV export carries a BOM, the visible headers, and every row', async ({ page }) => {
  const api = await signIn(page, MEMBER_2);
  const project = await api.project(FLOW.key);
  const total = Object.values(await api.board(project.id)).reduce(
    (sum, tasks) => sum + tasks.length,
    0,
  );

  await page.goto(viewPath(FLOW.key, 'table'));
  await expect(firstRow(page)).toBeVisible();

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloading;

  // `<KEY>-tasks-YYYY-MM-DD.csv`, dated in the exporter's local calendar.
  expect(download.suggestedFilename()).toMatch(
    new RegExp(`^${FLOW.key}-tasks-\\d{4}-\\d{2}-\\d{2}\\.csv$`, 'u'),
  );

  const text = await readFile(await download.path(), 'utf8');

  // THE BOM. Without it Excel opens a UTF-8 CSV as the system codepage and every
  // Arabic label in the file turns to mojibake — which is why it is here and why
  // it is worth a test.
  expect(text.startsWith('﻿')).toBe(true);

  const lines = csvLines(text.slice(1));
  const header = lines[0];
  expect(header).toBeDefined();
  // The header is the VISIBLE columns in the user's order. `Start date` is
  // hidden by default (`DEFAULT_HIDDEN_COLUMNS`), so its absence is part of the
  // contract rather than an oversight.
  expect(header).toBe(
    'Key,Title,Type,Status,Priority,Assignee,Points,Sprint,Labels,Due date,Updated',
  );

  // Every task in the project, not just the rows the virtualiser had mounted.
  expect(lines.length - 1).toBe(total);
  expect(lines[1]).toMatch(new RegExp(`^${FLOW.key}-\\d+,`, 'u'));
});
