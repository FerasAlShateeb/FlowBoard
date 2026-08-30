import { expect, test } from '../helpers/test';

import { ApiClient } from '../helpers/api';
import { expectToast, signIn } from '../helpers/app';
import { LIFECYCLE_TEST_COST, reserveApiBudget } from '../helpers/rate-budget';
import { ADMIN, ORG_NAME, ORG_SLUG, SECOND_ORG, unique } from '../helpers/seed';

/**
 * The user directory's two Round 2 surfaces: ORG GRANTS and ANONYMIZED DELETE.
 *
 * `admin.spec.ts` already owns the plain provisioning path — create, reveal the
 * temporary password once, deactivate. This file covers what that one cannot,
 * and both halves exist because the page used to lie about them:
 * `AdminUsersPage` hardcoded `orgMemberships: []`, so the one atomic
 * account-plus-membership path the API offers was unreachable from the product,
 * and the directory could not answer the question it exists to answer ("which
 * organizations is this person in?").
 *
 * ═══ WHY DELETE IS TESTED ON AN ACCOUNT THIS FILE MADE ═════════════════════
 *
 * `DELETE /admin/users/:id` is irreversible in the only way that matters: it
 * scrubs the name, rewrites the email to `deleted+<uuid>@flowboard.invalid` and
 * bumps `token_version`. There is no undo. Pointing it at a seeded account would
 * take that person out of every other spec in the suite — `sara@` is
 * `notifications.spec`'s recipient, `liam@` drives three files — so the subject
 * is provisioned here, used once, and left scrubbed.
 *
 * ═══ THE SWEEPER ═══════════════════════════════════════════════════════════
 *
 * `afterEach` anonymizes any fixture account still carrying an identity. That is
 * as close to a teardown as this domain has: accounts are never hard-deleted,
 * because their comments, activity rows and task history reference them. A
 * scrubbed row is inert — deactivated, in no organization, with every token
 * revoked — so it cannot affect a later spec.
 */

/** Every account this spec provisions carries this in its local part. */
const FIXTURE_PREFIX = 'e2e-user';

interface DirectoryRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly memberships: ReadonlyArray<{ readonly orgSlug: string }>;
}

/** An admin client, minted from the run-scoped session cache. */
async function adminApi(): Promise<ApiClient> {
  return ApiClient.fromSession(await ApiClient.session(ADMIN.email, ADMIN.password));
}

/** One organization's id, by slug — the switcher's endpoint, read directly. */
async function orgIdBySlug(api: ApiClient, slug: string): Promise<string> {
  const orgs = await api.get<{ id: string; slug: string }[]>('/orgs');
  const org = orgs.find((candidate) => candidate.slug === slug);
  if (!org) throw new Error(`no organization ${slug} is visible to the admin`);
  return org.id;
}

test.afterEach(async () => {
  const api = await adminApi();
  const rows = await api.get<DirectoryRow[]>(
    `/admin/users?q=${encodeURIComponent(FIXTURE_PREFIX)}&pageSize=100`,
  );
  for (const row of rows) {
    // An already-scrubbed row answers 409; skip it rather than swallow errors
    // broadly, so a genuine failure here is still loud.
    if (row.name === 'Deleted user') continue;
    await api.delete(`/admin/users/${row.id}`);
  }
});

test('provisioning grants an organization, and the dialog adds a second one', async ({ page }) => {
  await reserveApiBudget(LIFECYCLE_TEST_COST);
  const api = await signIn(page, ADMIN);
  const acmeId = await orgIdBySlug(api, ORG_SLUG);

  const email = `${unique(FIXTURE_PREFIX)}@example.com`;
  const name = `Granted Gita ${email.split('@')[0] ?? ''}`;

  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Provision user' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill(name);
  await dialog.getByLabel('Email').fill(email);

  // ── The grant, drafted before the account exists ──────────────────────────
  // Nothing in the picker writes: it edits a value on a request that has not
  // been sent, which is what makes the membership land in the SAME transaction
  // as the account. "Create, then add member" has two chances to half-succeed
  // and leave an account that exists but belongs nowhere.
  const picker = dialog.getByTestId('org-membership-picker');
  await picker.getByTestId('membership-org-select').click();
  await page.getByRole('option', { name: ORG_NAME }).click();
  await picker.getByTestId('membership-add').click();
  await expect(picker.getByTestId(`membership-draft-${acmeId}`)).toBeVisible();

  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expectToast(page, `Account created for ${name}`);
  // The temporary password is shown once, in a dialog with no cancel.
  await expect(page.getByTestId('temp-password')).not.toBeEmpty();
  await page.getByRole('button', { name: 'I have copied it' }).click();

  // ── The chip is the directory answering its own question ──────────────────
  const row = page.getByTestId(`admin-user-${email}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId('user-memberships')).toContainText(ORG_NAME);

  // …and the server agrees the grant is a real membership row, not a chip the
  // client drew from what it had just posted.
  const created = (
    await api.get<DirectoryRow[]>(`/admin/users?q=${encodeURIComponent(email)}`)
  ).find((candidate) => candidate.email === email);
  expect(created?.memberships.map((entry) => entry.orgSlug)).toEqual([ORG_SLUG]);

  // ── A second organization, added live ─────────────────────────────────────
  // The dialog has no Save button on purpose: each row is its own request
  // against the org's own membership endpoints, so a dialog-wide save would
  // have to batch independent writes and invent a rollback for the third.
  await row.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Manage memberships…' }).click();

  const memberships = page.getByTestId('memberships-dialog');
  await expect(memberships.getByTestId(`membership-${ORG_SLUG}`)).toBeVisible();

  await memberships.getByTestId('memberships-add-org').click();
  await page.getByRole('option', { name: SECOND_ORG.name }).click();
  await memberships.getByTestId('memberships-add').click();
  await expectToast(page, `Added to ${SECOND_ORG.name}`);

  // The row the dialog redraws comes from the invalidated list query, not from
  // local bookkeeping — which is what keeps it honest when a write is refused.
  await expect(memberships.getByTestId(`membership-${SECOND_ORG.slug}`)).toBeVisible();
  // Escape rather than the footer button: `ui/dialog` also renders its own
  // sr-only "Close" affordance, so the name matches twice and the intent here is
  // "dismiss", not "press that particular control".
  await page.keyboard.press('Escape');
  await expect(memberships).toBeHidden();

  await expect(row.getByTestId('user-memberships')).toContainText(SECOND_ORG.name);
});

test('an account is anonymized behind a typed-email gate', async ({ page }) => {
  const api = await signIn(page, ADMIN);
  const acmeId = await orgIdBySlug(api, ORG_SLUG);

  const email = `${unique(FIXTURE_PREFIX)}@example.com`;
  const name = 'Throwaway Theo';

  // ARRANGED THROUGH THE API. The provisioning flow is `admin.spec`'s subject
  // and the test above's; re-driving it here would spend a temporary-password
  // dialog to reach the row this test is actually about. The membership is what
  // makes the "removed from N organizations" half of the outcome non-trivial.
  const created = await api.post<DirectoryRow>('/admin/users', {
    name,
    email,
    password: 'throwaway1234',
    orgMemberships: [{ orgId: acmeId, role: 'member' }],
  });

  await page.goto('/admin/users');
  const row = page.getByTestId(`admin-user-${email}`);
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Delete user…' }).click();

  const dialog = page.getByTestId('delete-user-dialog');
  // The copy leads with what actually happens, because an admin who expects a
  // hard delete and gets an anonymized account has been surprised by the
  // product rather than informed by it.
  await expect(dialog).toContainText('anonymized rather than erased');

  const confirm = dialog.getByTestId('delete-user-confirm');
  await expect(confirm).toBeDisabled();
  // The EMAIL, not the name: two people can share a name, and the address is
  // the thing the admin copied out of the ticket.
  await dialog.getByTestId('delete-user-gate').fill(email);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expectToast(page, new RegExp(`${name} was deleted`, 'u'));

  // The old address is gone from the table — the row testid IS the email, so
  // this is the identity being rewritten rather than the row being hidden.
  await expect(row).toHaveCount(0);

  // The row survives, scrubbed: comments, activity and task history still
  // reference this id and would be unrenderable if it had been erased.
  // The scrubbed address carries a fresh uuid, not the account's own, so the
  // only way back to the row is its ID. Captured out of the poll rather than
  // re-fetched after it: two reads of a row that is still settling could
  // legitimately disagree, and this way the assertions below are all made
  // against the one answer that satisfied the poll.
  let scrubbed: DirectoryRow | undefined;
  await expect
    .poll(async () => {
      const rows = await api.get<DirectoryRow[]>('/admin/users?q=flowboard.invalid&pageSize=100');
      scrubbed = rows.find((candidate) => candidate.id === created.id);
      return scrubbed?.name ?? null;
    })
    .toBe('Deleted user');

  expect(scrubbed?.isActive).toBe(false);
  // Scrubbing a name while leaving the account on an org member list would be a
  // deletion that deleted nothing that mattered.
  expect(scrubbed?.memberships).toEqual([]);

  // And the table draws the scrubbed identity rather than dropping the row.
  const deletedRow = page.getByTestId(`admin-user-${scrubbed?.email ?? ''}`);
  await expect(deletedRow).toBeVisible();
  await expect(deletedRow).toContainText('Deleted user');
  await expect(deletedRow).toContainText('Deactivated');
});
