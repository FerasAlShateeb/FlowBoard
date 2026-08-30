import { expect, test } from '../helpers/test';

import { signIn } from '../helpers/app';
import { ADMIN, ORG_NAME, ORG_SLUG, SECOND_ORG } from '../helpers/seed';

/**
 * THE ADMIN TRAP, and the three chrome routes that close it.
 *
 * Round 2's audit named a specific dead end: `/admin/*` has no `/o/:orgSlug` in
 * it, the sidebar built its Workspace links from the URL alone, the brand mark
 * was not a link, and the org switcher rendered DISABLED for anyone in a single
 * org. A global admin who walked into the console had no chrome route back out
 * of it — they had to type a URL.
 *
 * Every fix for that is a NAVIGATION guarantee, which is precisely the class of
 * claim a unit test cannot make. `nav.config.test.ts` already proves the model
 * emits the rows; only a browser can prove the row is on screen, is a link, and
 * lands where it says. So this file asserts the destinations, not the markup.
 *
 * ═══ WHY IT VISITS AN ORG BEFORE IT VISITS THE CONSOLE ══════════════════════
 *
 * The Workspace section resolves its org from `orgSlug ?? lastOrgSlug ??
 * defaultOrgSlug` (`buildSections`). On `/admin/telemetry` the first rung is
 * null and, on a multi-org instance, so is the third — so `fb-last-org-v1` is
 * the only rung that can resolve, and it is written by having BEEN in an org.
 * That is not a fixture convenience: it is the journey the ladder exists for,
 * and starting the test on `/admin/telemetry` in a brand-new context would
 * assert the empty-instance case while claiming to assert this one.
 *
 * READ-ONLY. Nothing here writes; it navigates and asserts.
 */

const TELEMETRY = '/admin/telemetry';
const ORG_HOME = `/o/${ORG_SLUG}`;

test('an admin page keeps three chrome routes back into the product', async ({ page }) => {
  await signIn(page, ADMIN);

  // Rung 2 of the ladder, established the way a person establishes it.
  await page.goto(ORG_HOME);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  const sidebar = page.getByTestId('sidebar');
  /** The console has painted AND painted as an admin: this row is gated. */
  const adminRendered = async (): Promise<void> => {
    await page.goto(TELEMETRY);
    await expect(sidebar.getByRole('link', { name: 'Instance settings' })).toBeVisible();
  };

  // ── (a) the sidebar's own organization row ────────────────────────────────
  // `exact` because "Organization settings" is two rows below it.
  await adminRendered();
  await sidebar.getByRole('link', { name: 'Organization', exact: true }).click();
  await page.waitForURL(`**${ORG_HOME}`);

  // ── (b) the brand mark ────────────────────────────────────────────────────
  // It points at `/`, which is the picker — but `/` resolves the remembered org
  // and redirects, so the observable outcome is the org home. That resolution
  // is the point: the escape hatch needs no org in the URL to work, and it
  // still lands somewhere useful rather than on a chooser.
  await adminRendered();
  await page.getByTestId('brand-home').click();
  await page.waitForURL(`**${ORG_HOME}`);

  // ── (c) the breadcrumb's leading Home crumb ───────────────────────────────
  await adminRendered();
  await page.getByTestId('breadcrumbs').getByRole('link', { name: 'Home' }).click();
  await page.waitForURL(`**${ORG_HOME}`);

  // Landed on a real page, not on the router's error element.
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
});

test('the org switcher is enabled, searchable and works from an admin route', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto(TELEMETRY);

  // ENABLED is the assertion, not merely present: the old switcher rendered as
  // a disabled button, which is what made it part of the trap.
  const switcher = page.getByTestId('org-switcher');
  await expect(switcher).toBeEnabled();
  await switcher.click();

  // Typing narrows the list. Below `ORG_SERVER_SEARCH_THRESHOLD` this is the
  // `Command` primitive's own matcher over the cached `GET /orgs`, so no
  // request is made per keystroke — the observable contract is the same either
  // way, which is why the assertion is on the rows and not on the network.
  const search = page.getByPlaceholder('Search organizations…');
  await search.fill('glob');
  await expect(page.getByRole('option', { name: ORG_NAME })).toHaveCount(0);

  const globex = page.getByRole('option', { name: SECOND_ORG.name });
  await expect(globex).toBeVisible();
  await globex.click();

  await page.waitForURL(`**/o/${SECOND_ORG.slug}`);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  // The trigger now names where we are — the switcher is also a statement of
  // which organization the reader is inside.
  await expect(page.getByTestId('org-switcher')).toContainText(SECOND_ORG.name);
});

test('the palette offers Home and the admin rows from an admin route', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto(TELEMETRY);
  await expect(
    page.getByTestId('sidebar').getByRole('link', { name: 'Instance settings' }),
  ).toBeVisible();

  await page.keyboard.press('Control+k');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();

  // NO NEEDLE. An empty query renders every row the scope allows
  // (`filterPaletteItems` short-circuits), which is exactly the state an admin
  // reaches for when they are lost — so it is the state worth asserting.
  // Addressed by `data-value`, which is the nav model's own item id: the
  // accessible name is "label + section heading" and would make this a string
  // match on two concatenated translations.
  const row = (id: string) => palette.locator(`[data-slot="command-item"][data-value="${id}"]`);

  await expect(row('home')).toBeVisible();
  await expect(row('admin-orgs')).toBeVisible();
  await expect(row('admin-settings')).toBeVisible();
  await expect(row('analytics-engagement')).toBeVisible();

  // And it navigates: a row that renders but does not run is not an escape.
  await row('home').click();
  await expect(palette).toBeHidden();
  await page.waitForURL((url) => !url.pathname.startsWith('/admin'));
});
