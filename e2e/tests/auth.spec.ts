import { expect, test } from '../helpers/test';

import { ApiClient, reserveAuthSlot } from '../helpers/api';
import { expectToast, signInThroughForm, submitLoginForm, useSession } from '../helpers/app';
import { API_ORIGIN } from '../helpers/env';
import { ADMIN, ORG_SLUG, unique, viewPath } from '../helpers/seed';

/**
 * Getting in, and staying out.
 *
 * This is the ONE spec that signs in through the form on purpose — everything
 * else injects a session, because a login form is a dependency of the other
 * thirteen files and re-testing it in each of them buys nothing. What it costs
 * to test here is what nothing below can prove: that the form, the token pair,
 * the persisted store, the route guards and `tokenVersion` all agree.
 */

test('refuses a bad password and stays on the login page', async ({ page }) => {
  await signInThroughForm(page, { email: ADMIN.email, password: 'not-the-password' });

  // The server's `invalid_credentials` code, localized by `i18n/errors.ts`.
  await expectToast(page, 'That email and password do not match.');
  await expect(page).toHaveURL(/\/login$/u);
});

test('signs in through the form and signs out again', async ({ page }) => {
  await signInThroughForm(page, ADMIN);

  // Asserting the URL rather than a spinner means the whole resolve-and-redirect
  // path ran, not just that a request was fired.
  await page.waitForURL(`**/o/${ORG_SLUG}`);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  await page.getByTestId('user-menu').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  await page.waitForURL(/\/login/u);
  // The session is gone from storage, not merely from the screen: a protected
  // route must now bounce rather than render from a stale cache.
  await page.goto(viewPath('FLOW', 'board'));
  await page.waitForURL(/\/login/u);
});

test('a deep link survives the sign-in detour and lands where it was aimed', async ({ page }) => {
  const target = viewPath('FLOW', 'board');

  // Signed out, so the guard intercepts. `returnToPath` is carried in React
  // Router's navigation STATE, not a `?returnTo=` query param (see
  // `routes/auth-gate.ts`) — which is exactly why this has to be tested by
  // actually being redirected rather than by crafting a URL.
  await page.goto(target);
  await page.waitForURL(/\/login/u);

  // Submitted on the page the guard put us on — a fresh `goto('/login')` here
  // would discard the navigation state and the sign-in would land on the org
  // home, which is exactly the bug this test exists to catch.
  await submitLoginForm(page, ADMIN);

  await expect(page.locator('[data-slot="board-column"]').first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(target);
});

test('an invite link creates the account it was minted for', async ({ page }) => {
  const admin = await ApiClient.signIn(ADMIN.email, ADMIN.password);
  const orgId = await admin.orgId();

  // Locked to an address that has no account yet, so the landing page renders
  // its REGISTER form rather than the one-button "join as you" attach form.
  const email = `${unique('invitee')}@example.com`;
  const invite = await admin.post<{ token: string }>(`/orgs/${orgId}/invites`, {
    email,
    orgRole: 'member',
    expiresInDays: 7,
  });

  // Both the preview the page fetches on load and the accept it POSTs are on
  // the rate-limited credential router, so both are booked against the budget.
  await reserveAuthSlot();
  await page.goto(`/invite/${invite.token}`);
  await page.getByLabel('Your name').fill('Invited Person');
  await page.getByLabel('Choose a password').fill('invited1234');
  await reserveAuthSlot();
  await page.getByRole('button', { name: 'Create account and join' }).click();

  // Accepting signs the new account in and drops it inside the org it joined.
  await page.waitForURL(/\/o\//u);
  await expect(page.getByTestId('user-menu')).toBeVisible();

  // And the account is real: the credentials work on a cold login.
  const session = await ApiClient.login(email, 'invited1234');
  expect(session.user.email).toBe(email);
});

test('changing a password revokes the refresh tokens minted before it', async ({ page }) => {
  const admin = await ApiClient.signIn(ADMIN.email, ADMIN.password);
  const orgId = await admin.orgId();

  // A scratch account, so the seeded logins the other specs depend on keep
  // working. It gets an org membership because the app shell needs somewhere to
  // put a signed-in user.
  const email = `${unique('rotate')}@example.com`;
  const before = 'before-1234';
  const after = 'after-12345';
  await admin.post('/admin/users', {
    email,
    name: 'Rotating Rita',
    password: before,
    orgMemberships: [{ orgId, role: 'member' }],
  });

  const session = await ApiClient.login(email, before);
  await useSession(page, session);

  // Booked before the form is touched: `/auth/change-password` is on the
  // credential router, and if the budget has to wait it should wait on an idle
  // page rather than between a keystroke and a click.
  await reserveAuthSlot();
  await page.goto('/me');
  await page.getByLabel('Current password').fill(before);
  await page.getByLabel('New password', { exact: true }).fill(after);
  await page.getByLabel('Confirm new password').fill(after);

  const changed = page.waitForResponse((response) =>
    response.url().includes('/api/auth/change-password'),
  );
  await page.getByRole('button', { name: 'Change password' }).click();
  // Asserting the STATUS as well as the toast: a 429 from the rate limiter
  // renders its own toast and vanishes, and "no success toast" would otherwise
  // read as a broken password form.
  expect((await changed).status()).toBe(200);
  await expectToast(page, 'Password changed.');

  // THE POINT OF THE TEST. The change bumps `tokenVersion`, so the refresh
  // token this session was issued before it is now worthless — which is what
  // makes "change your password" a real remedy for a leaked session rather than
  // a cosmetic one.
  await reserveAuthSlot();
  const stale = await fetch(`${API_ORIGIN}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  expect(stale.ok).toBe(false);
  expect(stale.status).toBe(401);

  // …and the NEW password is a working credential, so the rotation completed
  // rather than merely breaking the account.
  const fresh = await ApiClient.login(email, after);
  expect(fresh.user.email).toBe(email);
});
