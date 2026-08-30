import { expect, test } from '../helpers/test';

import { ApiClient } from '../helpers/api';
import { expectToast, signIn, toasts } from '../helpers/app';
import { LIFECYCLE_TEST_COST, reserveApiBudget } from '../helpers/rate-budget';
import { ADMIN, ORG_SLUG, unique } from '../helpers/seed';

/**
 * `/admin/orgs` — the tenancy console, end to end.
 *
 * An organization's lifecycle is the one place in FlowBoard where the UI verb
 * and the API verb deliberately DISAGREE: the console says "archive" and
 * "restore", the API says `DELETE` and `POST /restore`, and the whole reason the
 * console renames them is that the operation is reversible. A spec that drove
 * the API would prove the soft delete works and prove nothing about whether an
 * operator can undo it, which is the actual product claim.
 *
 * ═══ WHAT IS ASSERTED, AND WHERE ═══════════════════════════════════════════
 *
 * Every step here is confirmed on a surface OTHER than the one that performed
 * it — the created org in the switcher, the archived org behind the toggle, the
 * restored org's badge — because each of the four mutations invalidates a cache
 * the page then re-renders from, and a repaint that never reached the server is
 * indistinguishable from one that did until something else asks.
 *
 * ═══ THE FIXTURE AND ITS SWEEPER ═══════════════════════════════════════════
 *
 * `workers: 1` on one shared seeded database makes the specs neighbours, and an
 * organization is the widest blast radius in the product: creating one adds a
 * row to every switcher, every admin table and `GET /orgs` for the account that
 * made it. So this file only ever touches organizations it created itself, under
 * a unique slug, and `afterEach` archives whatever a mid-test failure left live —
 * archived is as close to "gone" as the API offers (there is no hard delete, by
 * design), and an archived org is invisible to every surface the other specs
 * read.
 */

/** Every organization this spec creates starts with this. The sweeper's needle. */
const FIXTURE_PREFIX = 'e2e-org';

interface AdminOrgRow {
  readonly id: string;
  readonly slug: string;
  readonly deletedAt: string | null;
}

/**
 * Archive any fixture organization still live.
 *
 * API-only, with no page: this has to work even when the test failed because
 * the console is broken, which is exactly when litter is most likely.
 */
test.afterEach(async () => {
  const api = ApiClient.fromSession(await ApiClient.session(ADMIN.email, ADMIN.password));
  const orgs = await api.get<AdminOrgRow[]>('/orgs?includeDeleted=1');
  for (const org of orgs) {
    if (org.slug.startsWith(FIXTURE_PREFIX) && org.deletedAt === null) {
      await api.delete(`/orgs/${org.id}`);
    }
  }
});

test('an organization is created, renamed, archived and restored', async ({ page }) => {
  // Four mutations, six page states and a switcher read — well past what the
  // fixture's default reservation covers.
  await reserveApiBudget(LIFECYCLE_TEST_COST);
  await signIn(page, ADMIN);

  const slug = unique(FIXTURE_PREFIX);
  const name = `E2E Org ${slug}`;
  const renamed = `${name} renamed`;

  await page.goto('/admin/orgs');

  // ── Create ────────────────────────────────────────────────────────────────
  await page.getByTestId('create-org').click();
  const form = page.getByRole('dialog');
  await expect(form.getByText('New organization')).toBeVisible();
  await form.getByTestId('org-name-input').fill(name);
  // NOT derived from the name: the console deliberately has no auto-slugify, so
  // the slug is its own field and typing it is the real interaction.
  await form.getByTestId('org-slug-input').fill(slug);
  await form.getByRole('button', { name: 'Create organization' }).click();
  await expectToast(page, `${name} created`);

  const row = page.getByTestId(`admin-org-${slug}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(`/o/${slug}`);

  // ── It reached the switcher, not only the table ───────────────────────────
  // The creator becomes the organization's first admin, so it must appear in
  // the one control that reads `GET /orgs` for the caller's own memberships.
  await page.getByTestId('org-switcher').click();
  await expect(page.getByRole('option', { name })).toBeVisible();
  await page.keyboard.press('Escape');

  // ── Rename ────────────────────────────────────────────────────────────────
  // The slug is left alone: re-slugging is a URL change with its own warning in
  // the dialog, and keeping it stable lets the row testid stay the row's name
  // for the rest of the test.
  await row.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const renameForm = page.getByRole('dialog');
  await expect(renameForm.getByText(`Rename ${name}`)).toBeVisible();
  await renameForm.getByTestId('org-name-input').fill(renamed);
  await renameForm.getByRole('button', { name: 'Save changes' }).click();
  await expectToast(page, `${renamed} updated`);
  await expect(row).toContainText(renamed);

  // ── Archive, behind the typed gate ────────────────────────────────────────
  await row.getByRole('button', { name: `Actions for ${renamed}` }).click();
  await page.getByRole('menuitem', { name: 'Archive…' }).click();

  const archive = page.getByTestId('archive-org-dialog');
  const confirm = archive.getByRole('button', { name: 'Archive organization' });
  // THE GATE IS THE ASSERTION. Archiving takes every project, team and task in
  // the organization out of reach, so the button is inert until the org's own
  // name is typed verbatim — a dialog whose confirm was live on open would be
  // one misplaced Enter from an outage.
  await expect(confirm).toBeDisabled();
  await archive.getByTestId('archive-org-gate').fill(renamed);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expectToast(page, `${renamed} archived`);

  // Archived rows are hidden by default — `includeDeleted` is a SERVER flag, so
  // this is the row genuinely not being asked for rather than being hidden in
  // the browser.
  await expect(row).toHaveCount(0);

  // ── The toggle brings it back into view ───────────────────────────────────
  await page.getByTestId('orgs-show-archived').click();
  await expect(row).toBeVisible();
  await expect(row).toContainText('Archived');

  // ── Restore ───────────────────────────────────────────────────────────────
  // An archived row offers Restore and nothing else: opening or renaming one
  // would act on a row every other read filters out.
  await row.getByRole('button', { name: `Actions for ${renamed}` }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expectToast(page, `${renamed} restored`);
  await expect(row).toContainText('Live');

  // …and the server agrees, which is the only thing the badge cannot prove.
  const api = ApiClient.fromSession(await ApiClient.session(ADMIN.email, ADMIN.password));
  const orgs = await api.get<AdminOrgRow[]>('/orgs?includeDeleted=1');
  expect(orgs.find((org) => org.slug === slug)?.deletedAt).toBeNull();
});

test('a duplicate slug is refused with the address message, not the refresh one', async ({
  page,
}) => {
  await signIn(page, ADMIN);
  await page.goto('/admin/orgs');

  await page.getByTestId('create-org').click();
  const form = page.getByRole('dialog');
  await form.getByTestId('org-name-input').fill(`E2E Duplicate ${unique('slug')}`);
  // The seeded organization's slug. A slug is part of every URL under the org,
  // so colliding on one is the mistake an operator is most likely to make.
  await form.getByTestId('org-slug-input').fill(ORG_SLUG);
  await form.getByRole('button', { name: 'Create organization' }).click();

  // THE POINT OF THIS TEST. The API answers 409 `slug_taken` rather than the
  // generic `conflict`, and the web catalog gives that code a sentence an
  // operator can act on. The generic message tells them to refresh, which does
  // nothing here — the address really is taken, and no amount of reloading will
  // free it. Asserting the absence of the wrong string is what makes this a
  // regression test rather than a smoke test: both are "an error appeared".
  await expectToast(page, 'That address is already in use. Pick another.');
  await expect(toasts(page).getByText('Someone else changed this first.')).toHaveCount(0);

  // The dialog stays open on failure, holding what was typed, so the slug can
  // be corrected without re-entering the name.
  await expect(form).toBeVisible();
  await expect(form.getByTestId('org-slug-input')).toHaveValue(ORG_SLUG);
  await page.keyboard.press('Escape');
});
