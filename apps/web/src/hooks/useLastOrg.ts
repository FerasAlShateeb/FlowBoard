import { useCallback, useEffect } from 'react';
import type { OrgMode, OrgWithRole } from '@flowboard/shared';

import { useRouteScope } from '@/hooks/useRouteScope';

/**
 * "Which organization was I last in?" — the device-local memory behind the root
 * redirect and the org switcher.
 *
 * NOT A ZUSTAND STORE, deliberately. This is a single string that is written on
 * navigation and read exactly once per cold boot; a persisted store would add a
 * subscription, a hydration step and a module singleton for a value nothing
 * re-renders on. `localStorage` directly is the whole feature.
 *
 * It stores a SLUG, not an id: the slug is what the URL takes, so a redirect
 * needs no lookup, and a stale slug degrades to the picker rather than to a
 * 404 (the caller checks it against the org list before using it).
 *
 * Key follows the project convention: `fb-<name>-v1`.
 */
export const LAST_ORG_STORAGE_KEY = 'fb-last-org-v1';

/** Reads the remembered slug, or `null`. Never throws on blocked storage. */
export function getLastOrgSlug(): string | null {
  try {
    const value = localStorage.getItem(LAST_ORG_STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    // Private mode, blocked cookies, or a node test with no storage shim.
    return null;
  }
}

/** Remembers a slug. A no-op on failure — this is a convenience, not state. */
export function setLastOrgSlug(slug: string): void {
  try {
    localStorage.setItem(LAST_ORG_STORAGE_KEY, slug);
  } catch {
    // Storage full or unavailable; the session still works, it just forgets.
  }
}

/** Forgets the remembered org — used when the user leaves it. */
export function clearLastOrgSlug(): void {
  try {
    localStorage.removeItem(LAST_ORG_STORAGE_KEY);
  } catch {
    // Nothing to do; the value simply stays.
  }
}

/** Where `/` sends someone: an org, the picker, or "not decidable yet". */
export type HomeTarget = { kind: 'org'; slug: string } | { kind: 'picker' };

/**
 * Chooses where `/` should send someone.
 *
 * ═══ SINGLE-ORG MODE SHORT-CIRCUITS, AND DOES NOT WAIT ═════════════════════
 *
 * A single-org deployment has exactly one workspace, so `/` is never a choice —
 * it is a redirect, and it can be decided from the instance config ALONE. That
 * is why this rung runs before the `!orgs` guard: making a single-org install
 * hold `/` on a spinner until `GET /orgs` returns would be a request spent
 * confirming something the config already said.
 *
 * The zero-org case is real and must not be assumed away: a freshly installed
 * instance is in single mode with `defaultOrgSlug: null` until an admin creates
 * the first organization. That falls through to the picker, which renders the
 * empty state (and, for an effective admin, the create CTA).
 *
 * ═══ MULTI MODE: THE ORIGINAL LADDER, UNCHANGED ════════════════════════════
 *
 *   1. **The remembered org, if they are still in it** — the common case, and
 *      the only one that feels like the app resumed rather than restarted. The
 *      membership re-check is what makes a removed member land on the picker
 *      instead of a 403.
 *   2. **Their only org** — a picker with one card is a click that teaches
 *      nothing.
 *   3. **The picker** — several orgs, or none.
 *
 * Returns `null` while the org list is still loading, and `'picker'` when there
 * is a genuine choice to make.
 */
export function resolveHomeTarget(
  orgs: readonly OrgWithRole[] | undefined,
  lastSlug: string | null,
  defaultOrgSlug: string | null = null,
  orgMode: OrgMode = 'multi',
): HomeTarget | null {
  if (orgMode === 'single') {
    return defaultOrgSlug === null ? { kind: 'picker' } : { kind: 'org', slug: defaultOrgSlug };
  }

  if (!orgs) return null;
  if (orgs.length === 0) return { kind: 'picker' };

  if (lastSlug && orgs.some((org) => org.slug === lastSlug)) {
    return { kind: 'org', slug: lastSlug };
  }

  const only = orgs.length === 1 ? orgs[0] : undefined;
  if (only) return { kind: 'org', slug: only.slug };

  return { kind: 'picker' };
}

/**
 * Records the org in the current URL as the last one visited.
 *
 * Mounted once in the app shell's topbar rather than in each org page: every
 * org-scoped route matches `/o/:orgSlug/*`, so one observer high in the tree
 * catches all of them — including a deep link straight to a board, which is
 * exactly the navigation worth remembering.
 */
export function useRememberLastOrg(): void {
  const { orgSlug } = useRouteScope();

  useEffect(() => {
    if (orgSlug) setLastOrgSlug(orgSlug);
  }, [orgSlug]);
}

/** `[lastSlug, remember]` for components that switch orgs explicitly. */
export function useLastOrg(): [string | null, (slug: string) => void] {
  const remember = useCallback((slug: string) => {
    setLastOrgSlug(slug);
  }, []);
  return [getLastOrgSlug(), remember];
}
