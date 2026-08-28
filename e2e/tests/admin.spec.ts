import { expect, test } from '../helpers/test';

import { expectToast, signIn } from '../helpers/app';
import { ADMIN, FLOW, ORG_ADMIN, unique, viewPath } from '../helpers/seed';

/**
 * The global-admin area: who may see it, what provisioning actually writes, and
 * whether the telemetry the app emits comes back out of the analytics pages.
 */

test('an org admin who is not a global admin is refused', async ({ page }) => {
  // Maya administers Acme. That is deliberately NOT the same privilege — the
  // seed exists partly to make this distinction testable.
  await signIn(page, ORG_ADMIN);
  await page.goto('/admin/users');

  await expect(page.getByText('Administrators only')).toBeVisible();
  await expect(page.getByText('This area is reserved for global administrators.')).toBeVisible();
  // Refused IN PLACE, not redirected — a bookmarked admin URL must stay
  // bookmarked rather than silently becoming the home page.
  expect(new URL(page.url()).pathname).toBe('/admin/users');
  await expect(page.getByRole('button', { name: 'Provision user' })).toHaveCount(0);
});

test('a global admin provisions an account and then deactivates it', async ({ page }) => {
  const api = await signIn(page, ADMIN);
  const email = `${unique('provisioned')}@example.com`;
  const name = 'Provisioned Pat';

  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Provision user' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill(name);
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('button', { name: 'Create account' }).click();

  await expectToast(page, `Account created for ${name}`);

  // The temporary password is shown ONCE, in a dialog with no cancel — the only
  // moment it exists in plaintext anywhere.
  const password = page.getByTestId('temp-password');
  await expect(password).toBeVisible();
  await expect(password).not.toBeEmpty();
  await page.getByRole('button', { name: 'I have copied it' }).click();

  const row = page.getByTestId(`admin-user-${email}`);
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Deactivate account' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate account' }).click();

  // The list is chrome; the account state is the fact. Deactivating also bumps
  // `token_version`, which is what makes it a revocation rather than a flag.
  await expect
    .poll(async () => {
      const users = await api.get<{ email: string; isActive: boolean }[]>(
        `/admin/users?q=${encodeURIComponent(email)}`,
      );
      return users.find((user) => user.email === email)?.isActive;
    })
    .toBe(false);
});

test('the telemetry pages draw, and the events feed shows this session', async ({ page }) => {
  const api = await signIn(page, ADMIN);

  // A window that can only contain events from THIS run: the seed's newest
  // telemetry row is minutes-to-days old and never inside it.
  const since = new Date(Date.now() - 30_000).toISOString();
  const pageViews = async (): Promise<number> =>
    (
      await api.get<{ type: string }[]>(
        `/admin/telemetry/events?type=page_view&from=${encodeURIComponent(since)}`,
      )
    ).length;

  // Walking the app is what emits `page_view` — `lib/telemetry-client.ts` posts
  // one per route change.
  await page.goto(viewPath(FLOW.key, 'board'));
  await page.goto(viewPath(FLOW.key, 'backlog'));
  await page.goto(viewPath(FLOW.key, 'dashboard'));
  await expect.poll(pageViews, { timeout: 20_000 }).toBeGreaterThan(0);

  await page.goto('/admin/telemetry');
  // Every report is drawn inside a `ChartFrame`, which carries a localized
  // `aria-label` summarising the series — so a chart that rendered empty still
  // announces itself, and this asserts on the frames rather than on SVG guts.
  await expect
    .poll(async () => page.locator('[data-slot="chart-frame"]').count())
    .toBeGreaterThan(0);

  await page.goto('/admin/telemetry/events');
  const rows = page.getByTestId('telemetry-event-row');
  await expect.poll(async () => rows.count()).toBeGreaterThan(0);

  // Narrowed to the event this session just produced, in the shortest window
  // the filter bar offers. The seed's `page_view` rows are spread over the past
  // fortnight with a recency bias, so 24 hours is not by itself proof — the
  // `from`-windowed API assertion above is. This is the UI half: the feed can
  // render what the API returned.
  await page
    .getByTestId('telemetry-range-picker')
    .getByRole('button', { name: 'Last 24 hours' })
    .click();
  await page.getByRole('combobox').filter({ hasText: 'All events' }).first().click();
  await page.getByRole('option', { name: 'Page view' }).click();
  await expect.poll(async () => rows.count()).toBeGreaterThan(0);
});
