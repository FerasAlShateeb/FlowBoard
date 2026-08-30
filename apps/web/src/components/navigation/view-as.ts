/**
 * "View as member" — the two pure rules, extracted so they can be proved.
 *
 * The feature: a global admin flips a switch and the whole product renders as a
 * plain member would see it — no Administration or Analytics sections, no admin
 * palette rows, no admin routes. It exists because "does this look right for a
 * normal user" is a question every admin surface raises and none of them could
 * previously answer without a second account.
 *
 * ═══ IT IS CHROME, NEVER AUTHORIZATION ═════════════════════════════════════
 *
 * Nothing here weakens a permission. The API re-checks `isGlobalAdmin` on every
 * admin endpoint (`requireGlobalAdmin`), so an admin who tampered with the
 * persisted flag in the other direction buys a screen of 403s. The one place it
 * reaches the server is `GET /orgs?scope=member`, which asks the API to answer
 * the LIST question as a member would — a narrowing, never a widening.
 */

/** The `localStorage` key. Convention: `fb-<name>-v1`. */
export const VIEW_MODE_STORAGE_KEY = 'fb-view-mode-v1';

/** True when a path is inside the global-admin console. */
export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/**
 * Where to go after the view switch, or null to stay put.
 *
 * THE BOUNCE. Switching to member view while standing on `/admin/users` leaves
 * the reader on a route their own chrome no longer admits exists: the guard
 * refuses, the sidebar has dropped the section, and the only thing on screen is
 * a denial. So the toggle navigates them out first.
 *
 * WHY THE RULE LIVES IN THE TOGGLE AND NOT IN THE GUARD. A guard that
 * redirected on `!effectiveAdmin` would also redirect a genuine non-admin who
 * followed a bookmarked `/admin/*` link — turning an explicable refusal into
 * the app silently losing their navigation, and risking a redirect loop if the
 * flag were ever wrong. Only the toggle knows the transition just happened.
 *
 * The reverse switch (member → admin) never bounces: returning to admin view
 * only ADDS surfaces, and the page you were reading is still yours.
 */
export function viewChangeBounceTarget(
  pathname: string,
  nextViewingAsMember: boolean,
): string | null {
  if (!nextViewingAsMember) return null;
  return isAdminPath(pathname) ? '/' : null;
}
