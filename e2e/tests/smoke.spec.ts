import { expect, test } from '../helpers/test';

import { signInThroughForm } from '../helpers/app';
import { ADMIN, FLOW, ORG_SLUG } from '../helpers/seed';

/**
 * THE SMOKE TEST. One journey, through the form, end to end.
 *
 * Kept as its own file rather than folded into the suite around it, because it
 * answers a different question from every other spec: not "does this feature
 * work" but "do the two halves of the product still agree at all". The browser
 * bundle, the router, the auth store, `lib/api`'s envelope unwrap and zod parse,
 * the Express mount tree, the guards and the seeded database all have to line up
 * before a single assertion below can pass — and when a contract drifts, this is
 * the failure you want to read first, because it fails in one obvious place
 * instead of in eleven specialised ones.
 *
 * It signs in THROUGH THE FORM. Everything else injects a session (see
 * `helpers/app.ts`), which is right for a spec about the backlog and wrong for
 * the one test whose job is to notice that signing in stopped working.
 *
 * READ-ONLY: it navigates and asserts, and writes nothing.
 */

const PROJECT_KEY = FLOW.key;

test('signs in, lands on the org home, opens a project and its settings', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to FlowBoard' })).toBeVisible();
  await signInThroughForm(page, ADMIN);

  // The post-login landing is `/` -> `HomePage`. Since the seed grew a second
  // organization (Round 2), a fresh session has no remembered org and lands on
  // the org PICKER rather than auto-redirecting — that is the product behavior,
  // so the test picks acme the way a person would.
  await page.locator(`a[href="/o/${ORG_SLUG}"]`).first().click();
  await page.waitForURL(`**/o/${ORG_SLUG}`);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  // The seeded projects render. FLOW is the one with the default workflow.
  const projectLink = page.getByRole('link', { name: new RegExp(PROJECT_KEY) }).first();
  await expect(projectLink).toBeVisible();
  await projectLink.click();

  // Board is the project's default view.
  await page.waitForURL(`**/o/${ORG_SLUG}/p/${PROJECT_KEY}/board`);

  // Project settings is the deepest Wave-2 surface with a page of its own: it
  // reads the project detail, the workflow statuses AND the transitions, so a
  // contract mismatch in any of the three shows up here.
  await page.goto(`/o/${ORG_SLUG}/p/${PROJECT_KEY}/settings`);
  await expect(page.getByRole('heading', { name: 'Project settings' })).toBeVisible();

  // The section tabs are real LINKS inside a labelled `<nav>`, not ARIA tabs —
  // each is its own route, so the browser's back button works and a section is
  // deep-linkable. Asserted by role so a redesign that keeps the semantics
  // keeps the test.
  const sections = page.getByRole('navigation', { name: 'Project settings' });
  for (const name of ['General', 'Workflow', 'Members', 'Labels']) {
    await expect(sections.getByRole('link', { name })).toBeVisible();
  }

  // Following one proves the nested route resolves and its lazy chunk loads.
  await sections.getByRole('link', { name: 'Workflow' }).click();
  await page.waitForURL(`**/p/${PROJECT_KEY}/settings/workflow`);

  // Nothing on the way in threw. A thrown render lands on `errorElement`, which
  // would have replaced the page rather than failing a locator, so this is
  // worth asserting explicitly.
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

// The "refuses a bad password" case that used to live here moved to
// `auth.spec.ts`, next to the rest of the credential path. It is not a smoke
// test — it exercises one branch of one form — and keeping a second copy here
// spent a slot from the credential rate limiter for a duplicate assertion.
