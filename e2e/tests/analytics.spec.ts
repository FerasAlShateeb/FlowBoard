import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '../helpers/test';

import { signIn } from '../helpers/app';
import { ADMIN } from '../helpers/seed';

/**
 * The analytics console: the KPI row, the drill-down, and the events feed.
 *
 * `admin.spec.ts` proves telemetry is COLLECTED — that walking the app emits
 * `page_view` rows and that the charts draw. This file is about the console
 * built on top of that data, and specifically about the four behaviours that are
 * navigation or state rather than numbers:
 *
 *  - **the tile is the link.** Every headline number answers "…and then what?",
 *    so the whole card drills into its breakdown and the breadcrumb of a back
 *    link returns.
 *  - **the window survives a move between dashboards.** The four domain pages
 *    share one in-memory range, so a range chosen on Work is still chosen on
 *    Traffic — which only holds under CLIENT-SIDE navigation, and is therefore
 *    only testable by clicking a link.
 *  - **the detail table filters and exports what it filtered.** The facet is
 *    applied client-side over one domain fetch; the CSV is written from the
 *    filtered set, not from the visible page.
 *  - **the events feed's state lives in the URL.** A narrowed feed has to be a
 *    link somebody can paste into an incident channel, which means it must
 *    survive a reload.
 *
 * READ-ONLY. Nothing here writes anything the rest of the suite can see.
 */

/** How many body rows a `DataTable` is currently drawing inside `card`. */
function rowCount(page: Page, testId: string): Promise<number> {
  return page.getByTestId(testId).locator('tbody tr').count();
}

/** CRLF records, RFC 4180 — the same split `table.spec.ts` uses. */
function csvLines(text: string): string[] {
  return text.split('\r\n').filter((line) => line !== '');
}

test('the overview tiles carry numbers and a KPI drills into its breakdown', async ({ page }) => {
  await signIn(page, ADMIN);

  await page.goto('/admin/overview');
  // Cold, the tiles render a skeleton in place of the value, so an assertion on
  // the tile alone would pass before any data arrived. The VALUE is the claim.
  for (const id of ['users', 'orgs', 'projects', 'tasks']) {
    await expect(
      page.getByTestId(`stat-tile-${id}`).getByTestId('stat-value'),
      `${id} tile shows a number`,
    ).toHaveText(/\d/u);
  }

  // ── The tile is the link ──────────────────────────────────────────────────
  await page.goto('/admin/analytics/engagement');
  // `analytics-kpi-<metric>` is the console's own contract; `stat-tile-<metric>`
  // is the kit primitive's, and both resolve to the same pixels (`MetricTile`
  // puts one on a wrapper because a node can carry only one testid).
  const dau = page.getByTestId('analytics-kpi-dau');
  await expect(dau.getByTestId('stat-value')).toHaveText(/\d/u);
  await dau.getByRole('link').click();

  await page.waitForURL('**/admin/analytics/engagement/dau');
  const detail = page.getByTestId('admin-analytics-detail');
  await expect(detail).toBeVisible();
  await expect(page.getByTestId('analytics-detail-chart')).toBeVisible();

  // ── …and the way back lives in the sentence that says where you are ───────
  await page.getByTestId('analytics-detail-back').click();
  await page.waitForURL('**/admin/analytics/engagement');
  await expect(page.getByTestId('analytics-kpi-dau')).toBeVisible();
});

test('a range chosen on Work is still chosen on Traffic', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/admin/analytics/work');

  const range = page.getByTestId('analytics-range');
  const ninety = range.getByTestId('range-pill-90d');
  // 30d is the shipped default, so 90d is a real change rather than a click
  // that happened to reselect what was already selected.
  await expect(range.getByTestId('range-pill-30d')).toHaveAttribute('aria-pressed', 'true');
  await ninety.click();
  await expect(ninety).toHaveAttribute('aria-pressed', 'true');

  // IN-APP NAVIGATION, and it has to be. The four dashboards share one
  // in-memory range in `useAnalyticsStore` — deliberately not a URL parameter
  // and not `localStorage` — so a `goto` would tear the store down and this
  // would assert the default. Clicking the sidebar row is the journey an
  // operator actually makes when they widen the window and then go looking for
  // the cause somewhere else.
  await page.getByTestId('sidebar').getByRole('link', { name: 'Traffic' }).click();
  await page.waitForURL('**/admin/analytics/traffic');

  await expect(page.getByTestId('analytics-range').getByTestId('range-pill-90d')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('a facet narrows the detail table, and the CSV carries what it narrowed to', async ({
  page,
}) => {
  await signIn(page, ADMIN);
  // `events-by-type` is the one engagement breakdown with a facet, and its rows
  // are a closed vocabulary — so "filtered to one event type" is exactly one
  // row, which is a countable claim rather than "fewer than before".
  await page.goto('/admin/analytics/engagement/events-by-type');
  await expect(page.getByTestId('admin-analytics-detail')).toBeVisible();

  // Wait for REAL rows before counting: a cold `DataTable` draws skeleton `<tr>`s
  // of its own, so a bare row count can be satisfied by the loading state.
  const table = page.getByTestId('analytics-detail-table');
  await expect(table).toContainText('Page view');
  await expect.poll(() => rowCount(page, 'analytics-detail-table')).toBeGreaterThan(1);

  await page.getByTestId('table-facet-type').click();
  await page.getByTestId('table-facet-type-page_view').click();
  // The facet is a popover over the grid; close it so the rows are unobscured.
  await page.keyboard.press('Escape');

  await expect.poll(() => rowCount(page, 'analytics-detail-table')).toBe(1);
  await expect(table).toContainText('Page view');

  // ── The export ────────────────────────────────────────────────────────────
  // Written from `exportRows` — the whole FILTERED and SORTED set, not the
  // visible page — through the same `value()` the table renders, so the file
  // and the screen cannot disagree about what a cell says.
  const downloading = page.waitForEvent('download');
  await page.getByTestId('analytics-detail-export').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^flowboard-engagement-events-by-type-\d{4}-\d{2}-\d{2}\.csv$/u,
  );

  const text = await readFile(await download.path(), 'utf8');
  // THE BOM IS NOT DECORATION. Without it Excel reads a UTF-8 export as the
  // system codepage, and every non-Latin label in the file is mojibake.
  expect(text.startsWith('﻿')).toBe(true);

  const lines = csvLines(text.slice(1));
  // The metric's own column headers, translated — not the wire field names.
  // EVERY HEADER, EXACTLY, and in column order (R2 W3.5): the `type` and `wire`
  // columns both read `analytics:columns.eventType` until then, so the file
  // carried "Event" twice — two identically-named columns in a spreadsheet
  // somebody is about to sort, and a `toContain` assertion could not see it.
  expect(lines[0]).toBe('Event,Event ID,Events,Share');
  const headers = (lines[0] ?? '').split(',');
  expect(new Set(headers).size).toBe(headers.length);
  // One header plus the one row the facet left standing: the export follows the
  // filter rather than dumping the domain.
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain('page_view');
});

test('the events feed defaults to all time, and its narrowing survives a reload', async ({
  page,
}) => {
  await signIn(page, ADMIN);
  await page.goto('/admin/telemetry/events');

  const rows = page.getByTestId('telemetry-event-row');
  await expect.poll(async () => rows.count()).toBeGreaterThan(0);

  // ── All time is the default, and it says so ───────────────────────────────
  // The feed is the raw stream, and a raw stream that silently hid everything
  // older than a day would answer "no events" to a question about last week.
  // The chip is `aria-pressed`, not a `data-state`: it is a toggle, and that is
  // the attribute a screen reader reads.
  const picker = page.getByTestId('telemetry-range-picker');
  await expect(picker.getByRole('button', { name: 'All time' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Defaults are omitted from the query string, so a pristine feed is a clean URL.
  expect(new URL(page.url()).search).toBe('');

  // ── The type facet, and the sort ──────────────────────────────────────────
  await page.getByTestId('table-facet-type').click();
  await page.getByTestId('table-facet-type-page_view').click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => rows.count()).toBeGreaterThan(0);

  const eventHeader = page.getByRole('columnheader').filter({ hasText: 'Event' });
  await expect(eventHeader).toHaveAttribute('aria-sort', 'none');
  await eventHeader.getByRole('button').click();
  await expect(eventHeader).not.toHaveAttribute('aria-sort', 'none');

  // ── The URL is the state ──────────────────────────────────────────────────
  const narrowed = new URL(page.url());
  expect(narrowed.searchParams.get('type')).toBe('page_view');
  expect(narrowed.searchParams.get('sort')).toBe('type');

  await page.reload();

  // Hydrated SYNCHRONOUSLY, before the first fetch: the page decodes the query
  // string during its first render rather than in an effect, so opening a
  // pasted link costs one request for the right rows instead of two for the
  // wrong ones and then the right ones.
  await expect.poll(async () => rows.count()).toBeGreaterThan(0);
  await expect(page.getByRole('columnheader').filter({ hasText: 'Event' })).not.toHaveAttribute(
    'aria-sort',
    'none',
  );
  const reloaded = new URL(page.url());
  expect(reloaded.searchParams.get('type')).toBe('page_view');
  expect(reloaded.searchParams.get('sort')).toBe('type');
});

/**
 * R2 W3.5 — the Project column shows a NAME.
 *
 * It rendered `row.projectId`, a raw UUID, one column away from a User cell
 * that already showed a person. `projectName` now rides the row from a LEFT
 * JOIN, and the id stays in the payload for the filter and the cell's `title`.
 *
 * A browser test rather than a unit one because the claim spans three layers —
 * the SQL join, the shared schema's new field, and the cell — and the seed is
 * where a project-scoped event and a project-less one both exist.
 */
test('the events feed names the project instead of printing its UUID', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/admin/telemetry/events');

  const rows = page.getByTestId('telemetry-event-row');
  await expect.poll(async () => rows.count()).toBeGreaterThan(0);

  // `task_created` always carries a project; `auth_login` never does. Narrowing
  // to the first is what makes "there is a name here" a countable claim.
  await page.getByTestId('table-facet-type').click();
  await page.getByTestId('table-facet-type-task_created').click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => rows.count()).toBeGreaterThan(0);

  const named = page.getByTestId('telemetry-event-project').first();
  await expect(named).toBeVisible();
  const label = (await named.innerText()).trim();
  expect(label.length).toBeGreaterThan(0);
  // The thing that was wrong: a v4 UUID where a name belongs.
  expect(label).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/iu);
  // The id is still reachable — the filter takes it and the cell hovers it.
  await expect(named).toHaveAttribute('title', /^[0-9a-f]{8}-[0-9a-f]{4}-/iu);
});
