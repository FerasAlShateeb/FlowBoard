import { expect, test } from '../helpers/test';

import { ApiClient } from '../helpers/api';
import { expectToast, signIn } from '../helpers/app';
import { ADMIN, MULTI_ORG_MEMBER, ORG_NAME, ORG_SLUG } from '../helpers/seed';

/**
 * Single-organization mode — the instance setting that removes a whole surface.
 *
 * `orgMode` is the one row in the product that changes what the SHELL renders
 * for everybody: the org switcher stops existing, `/` stops being a picker and
 * becomes a redirect, and the admin organizations table grows a banner
 * explaining why only one of its rows is reachable. None of that is a page —
 * it is chrome, decided on boot from `GET /instance/config` — so it can only be
 * tested by booting the app twice under two different settings.
 *
 * ═══ THE SETTING IS GLOBAL, WHICH MAKES THE TEARDOWN LOAD-BEARING ══════════
 *
 * There is exactly ONE `instance_settings` row and it is shared by every spec in
 * the run. A test that flipped the instance to `single` and failed on its way
 * back would take the org switcher away from `admin-nav.spec`, turn `/` into a
 * redirect for `smoke.spec`, and do it in whichever file happened to run next —
 * the worst failure mode there is, because it points away from the cause.
 *
 * So the restore is an `afterEach` and it goes through the API, not the form:
 * it has to work even when the test failed BECAUSE the settings page is broken.
 * It is unconditional, so a run that never flipped simply rewrites the value it
 * already had.
 *
 * ═══ WHY THE MEMBER IS A MEMBER OF TWO ORGANIZATIONS ═══════════════════════
 *
 * `resolveHomeTarget` already redirects somebody with exactly one organization
 * straight into it, in either mode. Testing single mode with such an account
 * would assert a redirect that was going to happen anyway. `liam@` belongs to
 * both seeded organizations, so in `multi` he provably lands on the picker —
 * which is what makes the short-circuit an observable change rather than a
 * coincidence.
 */

/** An admin client, minted from the run-scoped session cache. */
async function adminApi(): Promise<ApiClient> {
  return ApiClient.fromSession(await ApiClient.session(ADMIN.email, ADMIN.password));
}

/** The instance's one settings row, as `GET /admin/settings` answers it. */
interface Settings {
  readonly orgMode: 'multi' | 'single';
  readonly defaultOrgId: string | null;
  readonly defaultOrgSlug: string | null;
}

test.afterEach(async () => {
  const api = await adminApi();
  // `defaultOrgId: null` alongside the mode: leaving a default behind would
  // work, but the seed ships `null` and a suite that is idempotent about the
  // mode and not about the field it guards is only half restored.
  await api.patch<Settings>('/admin/settings', { orgMode: 'multi', defaultOrgId: null });
});

test('an admin flips the instance to single mode and the switcher disappears', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/admin/settings');

  const form = page.getByTestId('instance-settings-form');
  await expect(form).toBeVisible();
  // Multi is the seeded mode, so the switcher is on screen to begin with —
  // otherwise its absence later would prove nothing.
  await expect(page.getByTestId('org-switcher')).toBeVisible();

  await page.getByTestId('org-mode-single').click();
  // The alert is not decoration: single mode hides a control and changes where
  // `/` goes, and an admin who has not been told that will read both as bugs.
  await expect(page.getByTestId('single-mode-alert')).toBeVisible();

  // Single mode without a default organization has nowhere to send anyone, so
  // the field is required — a mode that could be saved half-configured would
  // strand every signed-in session on a page that cannot resolve.
  await page.getByTestId('default-org-select').click();
  await page.getByRole('option', { name: ORG_NAME }).click();

  await page.getByTestId('save-instance-settings').click();
  await expectToast(page, 'Instance settings saved');

  // ── The shell reacts without a reload ─────────────────────────────────────
  // The mutation invalidates the instance keys, and `GET /instance/config` is
  // what the topbar reads — so an admin who saves the setting sees its effect
  // in the same breath rather than after refreshing.
  await expect(page.getByTestId('org-switcher')).toHaveCount(0);

  // ── `/` short-circuits ────────────────────────────────────────────────────
  // Straight into the default organization, WITHOUT waiting on `GET /orgs`:
  // the config has already answered the question the picker exists to ask.
  await page.goto('/');
  await page.waitForURL(`**/o/${ORG_SLUG}`);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  // ── And the organizations console explains itself ─────────────────────────
  // A banner rather than a disabled page: creating an organization is how you
  // prepare a switch back, so it stays available — but a two-row table where
  // only one row is reachable needs to say why.
  await page.goto('/admin/orgs');
  await expect(page.getByTestId('single-org-banner')).toBeVisible();
});

test('a member of two organizations lands in the default one, with no switcher', async ({
  page,
}) => {
  const memberApi = await signIn(page, MULTI_ORG_MEMBER);

  // ── Multi mode: the picker, because he genuinely has a choice ─────────────
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Choose an organization' })).toBeVisible();
  await expect(page.getByTestId('org-switcher')).toBeVisible();

  // ── Flip through the API ──────────────────────────────────────────────────
  // The FORM is the test above's subject; driving it again here would need a
  // second sign-in as an admin to change a value this test only consumes.
  const api = await adminApi();
  const orgs = await api.get<{ id: string; slug: string }[]>('/orgs');
  const acme = orgs.find((org) => org.slug === ORG_SLUG);
  expect(acme).toBeDefined();
  await api.patch<Settings>('/admin/settings', {
    orgMode: 'single',
    defaultOrgId: acme?.id ?? null,
  });

  // A reload, because the config is read once on boot and cached — which is
  // exactly the behaviour being asserted: the shell decides what to render from
  // the config it booted with.
  await page.goto('/');
  await page.waitForURL(`**/o/${ORG_SLUG}`);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  // The switcher is GONE for an ordinary member too — it is an instance-wide
  // shape, not an admin affordance.
  await expect(page.getByTestId('org-switcher')).toHaveCount(0);

  // He is still a member of the other organization; single mode hides it from
  // the interface rather than revoking anything. Nothing is deleted, and the
  // `afterEach` above puts the instance back.
  const mine = await memberApi.get<{ slug: string }[]>('/orgs');
  expect(mine.length).toBeGreaterThan(1);
});
