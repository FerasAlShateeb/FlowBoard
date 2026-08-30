import { expect, test } from '../helpers/test';

import { ApiClient } from '../helpers/api';
import { signIn } from '../helpers/app';
import { ADMIN, ORG_NAME, ORG_SLUG, OTHER_ORG_MEMBER, unique } from '../helpers/seed';

/**
 * "View as member" — an admin's preview of the product without their own
 * console.
 *
 * It exists because "does this look right for a normal user" is a question
 * every admin surface raises and none of them could answer without a second
 * account. It is CHROME, never authorization: nothing here weakens a
 * permission, the API re-checks `isGlobalAdmin` on every admin endpoint, and the
 * single place the flag reaches the server (`GET /orgs?scope=member`) can only
 * remove rows.
 *
 * ═══ THE THREE CLAIMS, AND WHY EACH NEEDS A BROWSER ════════════════════════
 *
 *  1. **The console disappears from the chrome.** `nav.config` gates the two
 *     admin sections on `effectiveAdmin`; only a render proves the sidebar
 *     actually dropped them.
 *  2. **`/admin/*` refuses IN PLACE.** Not a redirect — a bookmarked admin URL
 *     must stay bookmarked, and the refusal carries the way back. (The toggle
 *     bounces you off an admin path when you switch INTO member view; a direct
 *     navigation afterwards is a different event, and it must not bounce.)
 *  3. **The switcher narrows to real memberships.** This is the one claim that
 *     needs a fixture: the seeded admin belongs to BOTH seeded organizations, so
 *     `scope=member` would remove nothing and a green test would prove nothing.
 *     So the spec provisions an organization owned by somebody else — `POST
 *     /orgs` takes an `adminUserId` for exactly this case — and asserts it is
 *     visible in admin view and gone in member view.
 *
 * The fixture org is archived by `afterEach`; see `admin-orgs.spec.ts` for why
 * archived is the closest thing to a teardown this domain has.
 */

const FIXTURE_PREFIX = 'e2e-viewas';

interface AdminOrgRow {
  readonly id: string;
  readonly slug: string;
  readonly deletedAt: string | null;
}

async function adminApi(): Promise<ApiClient> {
  return ApiClient.fromSession(await ApiClient.session(ADMIN.email, ADMIN.password));
}

test.afterEach(async () => {
  const api = await adminApi();
  const orgs = await api.get<AdminOrgRow[]>('/orgs?includeDeleted=1');
  for (const org of orgs) {
    if (org.slug.startsWith(FIXTURE_PREFIX) && org.deletedAt === null) {
      await api.delete(`/orgs/${org.id}`);
    }
  }
});

test('member view hides the console, refuses in place, and narrows the switcher', async ({
  page,
}) => {
  const api = await signIn(page, ADMIN);

  // ── An organization the admin is deliberately NOT in ──────────────────────
  const foreignSlug = unique(FIXTURE_PREFIX);
  const foreignName = `Foreign Org ${foreignSlug}`;
  const owner = (
    await api.get<{ id: string; email: string }[]>(
      `/admin/users?q=${encodeURIComponent(OTHER_ORG_MEMBER.email)}`,
    )
  ).find((row) => row.email === OTHER_ORG_MEMBER.email);
  expect(owner).toBeDefined();
  await api.post('/orgs', { name: foreignName, slug: foreignSlug, adminUserId: owner?.id });

  await page.goto(`/o/${ORG_SLUG}`);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  const sidebar = page.getByTestId('sidebar');
  const switcher = page.getByTestId('org-switcher');

  // Admin view: the console is in the chrome and the switcher sees everything.
  await expect(sidebar.getByRole('link', { name: 'Instance settings' })).toBeVisible();
  await switcher.click();
  await expect(page.getByRole('option', { name: foreignName })).toBeVisible();
  await page.keyboard.press('Escape');

  // ── Flip ──────────────────────────────────────────────────────────────────
  await page.getByTestId('user-menu').click();
  await page.getByTestId('view-as-toggle').click();

  // The pill is the standing reminder, and the other way back.
  await expect(page.getByTestId('view-as-pill')).toBeVisible();

  // ── (1) the console is gone from the chrome ───────────────────────────────
  await expect(sidebar.getByRole('link', { name: 'Instance settings' })).toHaveCount(0);
  await expect(sidebar.getByText('Administration')).toHaveCount(0);
  await expect(sidebar.getByText('Analytics')).toHaveCount(0);
  // …and from the palette, which is a separate consumer of the same model.
  await page.keyboard.press('Control+k');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await expect(palette.locator('[data-slot="command-item"][data-value="admin-orgs"]')).toHaveCount(
    0,
  );
  await expect(palette.locator('[data-slot="command-item"][data-value="home"]')).toBeVisible();
  await page.keyboard.press('Escape');

  // ── (3) the switcher narrows to real memberships ──────────────────────────
  await switcher.click();
  await expect(page.getByRole('option', { name: foreignName })).toHaveCount(0);
  await expect(page.getByRole('option', { name: ORG_NAME })).toBeVisible();
  await page.keyboard.press('Escape');

  // ── (2) an admin route refuses in place ───────────────────────────────────
  // A DIRECT navigation, which is the case the bounce rule must not catch: the
  // toggle sends you off an admin path when you switch into member view, and
  // nothing else may.
  await page.goto('/admin/users');
  // The BODY, not the title: the pill in the topbar says "Viewing as member"
  // too, and a locator that matched both would pass on a page where only the
  // pill rendered — which is the failure this assertion is for.
  await expect(
    page.getByText(
      'Administration is hidden while you are previewing FlowBoard as a member. Return to administrator view to open this page.',
    ),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/admin/users');
  // Not the OTHER refusal: a genuine non-admin gets "Administrators only" and
  // no way back, because there is nothing for them to switch out of.
  await expect(page.getByText('Administrators only')).toHaveCount(0);

  // ── Back, from the refusal itself ─────────────────────────────────────────
  await page.getByTestId('view-as-exit').click();
  // No bounce in this direction: returning to admin view only ADDS surfaces, so
  // the page that was refused is simply granted.
  expect(new URL(page.url()).pathname).toBe('/admin/users');
  await expect(page.getByRole('button', { name: 'Provision user' })).toBeVisible();
  await expect(page.getByTestId('view-as-pill')).toHaveCount(0);
});

test('the pill is the other way back, and it is not a redirect either', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto(`/o/${ORG_SLUG}`);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  await page.getByTestId('user-menu').click();
  await page.getByTestId('view-as-toggle').click();

  const pill = page.getByTestId('view-as-pill');
  await expect(pill).toBeVisible();
  await pill.click();

  // Two controls, one state — the menu row and the pill must both work, or the
  // feature is a one-way door with a `localStorage` key behind it.
  await expect(pill).toHaveCount(0);
  await expect(
    page.getByTestId('sidebar').getByRole('link', { name: 'Instance settings' }),
  ).toBeVisible();
  // Nowhere was navigated: the reader stays on the page they were reading.
  expect(new URL(page.url()).pathname).toBe(`/o/${ORG_SLUG}`);
});
