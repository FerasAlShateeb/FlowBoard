/**
 * Driving the app: signing in, dragging, and the handful of locators that more
 * than one spec needs.
 *
 * The rule these helpers follow — and the reason there are so few of them — is
 * that a helper may ARRANGE, never ASSERT. `signIn` gets a spec to a signed-in
 * page; whether the login FORM works is `auth.spec.ts`'s job and it does that
 * one through the form, because a fixture that fakes a session proves the
 * opposite of what a login test is for.
 */
import { expect, type Locator, type Page } from '@playwright/test';

import { ApiClient, reserveAuthSlot, type LoginResult } from './api';

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

/**
 * Put a session in place BEFORE the first script of the page runs.
 *
 * `addInitScript` rather than `page.evaluate` after a `goto`: the auth store is
 * a zustand `persist` store read once at module init, so a token written after
 * load is a token the app has already decided it does not have. The envelope
 * (`{state, version}`) is zustand's, not ours — see `useAuthStore.ts`.
 */
export async function useSession(page: Page, session: LoginResult): Promise<void> {
  await page.addInitScript(
    ([key, value]: [string, string]) => {
      window.localStorage.setItem(key, value);
    },
    [
      'fb-auth-v1',
      JSON.stringify({
        state: {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          user: session.user,
        },
        version: 0,
      }),
    ] as [string, string],
  );
}

/**
 * Sign in via the API and inject the session — the fast path every spec that is
 * not testing authentication should use.
 *
 * Returns the API client for the same account, because a spec that needs a
 * session almost always also needs to look something up.
 */
export async function signIn(page: Page, credentials: Credentials): Promise<ApiClient> {
  const session = await ApiClient.session(credentials.email, credentials.password);
  await useSession(page, session);
  return ApiClient.fromSession(session);
}

/**
 * Sign in the way a person does. Used by `auth.spec.ts`, and nowhere else.
 *
 * It claims a slot from the credential budget first: the form POSTs the same
 * rate-limited endpoint the API client does, and a limiter cannot tell the two
 * apart — see `reserveAuthSlot` in `helpers/api.ts`.
 */
export async function signInThroughForm(page: Page, credentials: Credentials): Promise<void> {
  await page.goto('/login');
  await submitLoginForm(page, credentials);
}

/**
 * Fill and submit the login form ALREADY ON SCREEN.
 *
 * Separate from `signInThroughForm` because of the return-to test: the guard
 * redirects to `/login` carrying the intended path in React Router's navigation
 * STATE, and a fresh `page.goto('/login')` would throw that state away and land
 * the sign-in on the org home — a green test proving nothing.
 */
export async function submitLoginForm(page: Page, credentials: Credentials): Promise<void> {
  await reserveAuthSlot();
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Set the device language before boot, so the pre-mount `dir` stamp is observable. */
export async function useLanguage(page: Page, lang: 'en' | 'ar'): Promise<void> {
  await page.addInitScript((value: string) => {
    window.localStorage.setItem('fb-lang-v1', value);
  }, lang);
}

/** The sonner host. Toasts are text-only in this app — assert on the string. */
export function toasts(page: Page): Locator {
  return page.getByTestId('toast-host');
}

/** Wait for a toast whose text matches, then let it go. */
export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(toasts(page).getByText(text).first()).toBeVisible();
}

/**
 * A dnd-kit pointer drag.
 *
 * FOUR moves, not one. dnd-kit's `PointerSensor` is configured with
 * `activationConstraint: { distance: 4 }` in all three views, so the drag does
 * not START until the pointer has travelled 4px — a single jump from source to
 * target arrives before the sensor is listening and drops nothing. The moves
 * after the first also matter: the sortable strategy resolves the drop from the
 * LAST `dragover` it saw, and one instantaneous jump can register none at all.
 */
export async function dragTo(
  page: Page,
  source: Locator,
  target: Locator,
  options: { readonly targetOffsetY?: number } = {},
): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('drag endpoints are not laid out');

  const startX = from.x + from.width / 2;
  const startY = from.y + Math.min(from.height / 2, 14);
  const endX = to.x + to.width / 2;
  const endY = to.y + (options.targetOffsetY ?? Math.min(to.height / 2, 40));

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Past the 4px activation constraint, in place: this is what starts the drag.
  await page.mouse.move(startX, startY + 12, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 16 });
  // One more inside the target so the last `dragover` is the one we want.
  await page.mouse.move(endX, endY + 6, { steps: 4 });
  await page.mouse.up();
}

// ── Board locators, shared by board / realtime / palette specs ───────────────

export function boardColumn(page: Page, statusId: string): Locator {
  return page.locator(`[data-slot="board-column"][data-status-id="${statusId}"]`);
}

export function boardCardList(page: Page, statusId: string): Locator {
  return page.locator(`[data-slot="board-card-list"][data-status-id="${statusId}"]`);
}

/** The draggable/clickable wrapper of one card, addressed by its task key. */
export function boardCard(page: Page, taskKey: string): Locator {
  return page.locator(`[data-slot="board-card-sortable"][aria-label="Open ${taskKey}"]`);
}

/** The status id a card is currently rendered under, read from the DOM. */
export async function columnOfCard(page: Page, taskKey: string): Promise<string | null> {
  return page
    .locator(`[data-slot="board-column"]:has([aria-label="Open ${taskKey}"])`)
    .first()
    .getAttribute('data-status-id');
}

/** Wait until the board has painted at least one column. */
export async function waitForBoard(page: Page): Promise<void> {
  await expect(page.locator('[data-slot="board-column"]').first()).toBeVisible();
}
