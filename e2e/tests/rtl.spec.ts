import { expect, test, type Locator, type Page } from '../helpers/test';

import { signIn, waitForBoard } from '../helpers/app';
import { ADMIN, MEMBER_2, FLOW, ORG_SLUG, SECOND_ORG, viewPath } from '../helpers/seed';

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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ROUND 2's SURFACES, IN ARABIC (R2 W3.5)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The spec above proves the app mirrors on the surfaces Round 1 shipped. Round 2
 * added four that it never reached — the instance-admin overview, the analytics
 * dashboards and their drill-down, the org switcher's popover, and the Theme
 * Studio drawer — and each of them is the KIND of thing an RTL pass exists to
 * catch: a physically-positioned panel, a portalled popover, and a family of
 * numeric badges whose whole content is a Latin run.
 *
 * None of it is assertable without a browser. `dir` is stamped on `<html>` and
 * inherited; `end-0` resolves to a physical edge only after layout; and whether
 * an arrow points the right way is a computed `transform`, not a class name.
 */

/** Switch the running session to Arabic through the UI, as `rtl.spec` does. */
async function switchToArabic(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

/** The whole rendered document, whitespace-collapsed. */
async function documentText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).replace(/\s+/gu, ' ');
}

/**
 * Is this glyph turned a half-turn — i.e. did `rtl:rotate-180` fire?
 *
 * READ FROM COMPUTED STYLE, and from BOTH properties. Tailwind v4 emits the
 * standalone `rotate` property (`rotate: 180deg`) rather than a `transform`
 * matrix, so a `transform`-only assertion reads `none` on a correctly mirrored
 * arrow. Accepting either keeps this about the mirroring rather than about which
 * CSS property this major version of Tailwind happens to use.
 *
 * Asserting the CLASS instead would prove nothing: `rtl:rotate-180` is on the
 * element in English too, and the whole question is whether `<html dir>` made it
 * apply.
 */
function isMirrored(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return style.rotate === '180deg' || style.transform === 'matrix(-1, 0, 0, -1, 0, 0)';
  });
}

test('the admin console and the analytics console mirror, and keep their LTR islands', async ({
  page,
}) => {
  await signIn(page, ADMIN);
  await page.goto('/admin/overview');
  // `stat-tile-users`, not `telemetry-stat-row`: the overview builds its KPI row
  // from the kit's `StatTile` directly, while `TelemetryStatRow` (which wraps
  // `MetricTile`) belongs to `/admin/telemetry`.
  await expect(page.getByTestId('stat-tile-users')).toBeVisible();

  // ── The arrow, BEFORE the flip ────────────────────────────────────────────
  // Captured in English so the assertion after the switch is a CHANGE rather
  // than a state. A glyph that was already rotated would satisfy the RTL check
  // while proving nothing about `dir`.
  await page.goto('/admin/analytics/traffic');
  const detailsArrow = page.getByTestId('analytics-chart-requests-details').locator('svg').first();
  await expect(detailsArrow).toBeVisible();
  expect(await isMirrored(detailsArrow)).toBe(false);

  await switchToArabic(page);

  // ── /admin/overview ───────────────────────────────────────────────────────
  // The KPI row survives the flip. A console that mirrors but loses its numbers
  // is the failure a `dir` assertion cannot see.
  await page.goto('/admin/overview');
  const usersTile = page.getByTestId('stat-tile-users');
  await expect(usersTile).toBeVisible();
  await expect(usersTile.getByTestId('stat-value')).toBeVisible();
  expect(await documentText(page)).not.toMatch(ARABIC_INDIC);

  // ── An analytics dashboard ────────────────────────────────────────────────
  await page.goto('/admin/analytics/traffic');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('analytics-kpi-requests')).toBeVisible();

  // THE TREND PILL IS AN LTR ISLAND and must stay one: BiDi treats a leading
  // `+`/`-` as neutral, so an un-pinned `+12.5%` renders as `12.5%+` in Arabic.
  const pill = page.getByTestId('stat-delta').first();
  await expect(pill).toHaveAttribute('dir', 'ltr');

  // The chart card's "Details →" arrow now points the other way.
  const details = page.getByTestId('analytics-chart-requests-details');
  await expect(details).toBeVisible();
  expect(await isMirrored(details.locator('svg').first())).toBe(true);

  // ── The drill-down it points at ───────────────────────────────────────────
  await details.click();
  await page.waitForURL('**/admin/analytics/traffic/requests');
  await expect(page.getByTestId('admin-analytics-detail')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  // Its table draws, and its own back arrow mirrors the same way.
  await expect(page.getByTestId('analytics-detail-table').getByRole('table')).toBeVisible();
  expect(await isMirrored(page.getByTestId('analytics-detail-back').locator('svg').first())).toBe(
    true,
  );

  // Western digits across the whole drill-down, buckets and counts included.
  const text = await documentText(page);
  expect(text).toMatch(/\d/u);
  expect(text).not.toMatch(ARABIC_INDIC);
});

test('the org switcher and the theme drawer open at the READING end in Arabic', async ({
  page,
}) => {
  // Inside an org, not on `/`: the picker has no app shell, and the switcher and
  // the Theme Studio trigger both live in the shell's topbar.
  await signIn(page, MEMBER_2);
  await page.goto(`/o/${ORG_SLUG}`);
  await expect(page.getByTestId('org-switcher')).toBeVisible();

  await switchToArabic(page);

  // ── The org switcher's popover ────────────────────────────────────────────
  // Portalled to `body`, so it inherits `dir` from `<html>` rather than from the
  // trigger — which is exactly the wiring that silently breaks.
  await page.getByTestId('org-switcher').click();
  const listbox = page.locator('[data-slot="popover-content"]').filter({
    has: page.locator('[data-slot="command"]'),
  });
  await expect(listbox).toBeVisible();
  await expect(listbox).toHaveCSS('direction', 'rtl');
  // Both seeded organizations are listed — the popover is not merely open, it
  // has content, which a mirrored-but-empty list would not.
  await expect(listbox).toContainText(SECOND_ORG.name);
  await page.keyboard.press('Escape');
  await expect(listbox).toBeHidden();

  // ── The Theme Studio drawer ───────────────────────────────────────────────
  await page.getByTestId('theme-studio-trigger').click();
  const drawer = page.getByTestId('theme-studio');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS('direction', 'rtl');

  // `end-0` is the READING end: the right edge in English, the LEFT edge here.
  // Asserting the box rather than the class is the point — a logical utility
  // that silently became physical would keep the class and move the panel.
  const box = await drawer.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('the drawer has no layout');
  expect(box.x).toBeLessThan(2);
  expect(box.x + box.width).toBeLessThan(viewport.width);

  // Its tablist is there and its arrow keys are direction-aware: in RTL the tabs
  // run end-to-start, so ArrowLeft moves to the NEXT tab.
  const tabs = drawer.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await tabs.first().focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

  expect(await documentText(page)).not.toMatch(ARABIC_INDIC);

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});
