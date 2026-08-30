import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { LoginResponse, User } from '@flowboard/shared';

import { VIEW_MODE_STORAGE_KEY } from '@/components/navigation/view-as';

/**
 * The session store: the JWT pair and a summary of who is signed in.
 *
 * It is deliberately DUMB — no fetching, no refresh logic, no navigation. That
 * keeps the dependency arrow one-way: `lib/api.ts` imports this store (for the
 * bearer token and to tear the session down when a refresh fails), and this
 * store imports nothing of the app. A store that called the API would close
 * that loop and make both untestable.
 *
 * Real `/auth/me` validation, the login mutation and the logout call land in
 * WP2.4; this wave only owns the shape and the persistence.
 *
 * The two shapes below are ALIASES of the shared contract, not copies: what is
 * persisted under `fb-auth-v1` is byte-for-byte what `POST /auth/login` returned
 * and `loginResponseSchema` parsed, so a contract change is a compile error here
 * rather than a stored session that no longer matches the API.
 */

/** The signed-in account — `@flowboard/shared`'s `userSchema` output. */
export type AuthUser = User;

/**
 * What `POST /api/auth/login` (and the invite-accept endpoint) return. A
 * `POST /auth/refresh` returns only the rotated pair — see {@link AuthState.setTokens}.
 */
export type AuthSession = LoginResponse;

/** Session key (conventions: `fb-<name>-v1`). */
export const AUTH_STORAGE_KEY = 'fb-auth-v1';

/**
 * The "view as member" flag, read and written OUTSIDE the persisted session.
 *
 * WHY ITS OWN KEY (`fb-view-mode-v1`) RATHER THAN A FIELD IN `fb-auth-v1`. The
 * session blob is byte-for-byte what `POST /auth/login` returned and
 * `loginResponseSchema` parsed — that alias-not-copy property is what makes a
 * contract change a compile error here instead of a stored session that no
 * longer matches the API. A local view preference is not part of that payload,
 * and adding it would break the identity. Two concerns, two keys.
 *
 * Both helpers swallow storage failures: private mode, blocked cookies and a
 * node test with no shim all end with the flag living in memory only, which is
 * a degraded preference rather than a crashed shell.
 */
function loadViewingAsMember(): boolean {
  try {
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistViewingAsMember(value: boolean): void {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Storage unavailable; the flag still lives in state for this tab.
  }
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  /**
   * WHICH SESSION THESE TOKENS BELONG TO — a counter, bumped by every
   * IDENTITY CHANGE ({@link AuthState.setSession} and
   * {@link AuthState.clearSession}) and by nothing else.
   *
   * ═══ THE BUG IT EXISTS TO KILL ════════════════════════════════════════════
   *
   * `lib/api.ts` refreshes the token pair in the background. A refresh is a
   * round trip, and a person can sign out — or sign in as someone else — while
   * one is in the air. The refresh then resolves against a store that has
   * MOVED ON and writes its rotated pair over the top: `clearSession()` ran,
   * the user watched the app return to the login screen, and a moment later a
   * valid pair is back in `localStorage`. The next boot signs them in again.
   *
   * A "was it cleared?" boolean would not close this: sign-out → sign-in →
   * the old refresh landing would find tokens present and overwrite the NEW
   * session's pair with the previous account's. Only a value that never
   * repeats can answer "is this still the session I started under", which is
   * what a monotonic counter is.
   *
   * NOT PERSISTED (see `partialize`): it compares two moments in ONE tab's
   * lifetime, and a number restored from storage would be compared against
   * refreshes that never happened.
   *
   * `setTokens` deliberately does NOT bump it — a rotation is the same session
   * with newer credentials, and bumping there would make every refresh
   * invalidate the next one.
   */
  sessionGeneration: number;
  /**
   * "Show me the product as a plain member sees it" — a global admin's own
   * preview switch. Persisted under `fb-view-mode-v1`, so it survives a reload
   * (the whole point: you look around, you come back tomorrow, you are still
   * looking around) but NOT a sign-out, which is where {@link
   * AuthState.clearSession} resets it.
   *
   * Meaningless for a non-admin — {@link AuthState.isEffectiveGlobalAdmin} is
   * false for them either way — and never trusted by the API.
   */
  viewingAsMember: boolean;
  /** True once a token exists. NOT proof it is still valid — see RequireAuth. */
  isAuthenticated: () => boolean;
  /**
   * The REAL global-admin flag from the last session payload; the API re-checks
   * it.
   *
   * This is the one that gates the view-as switch itself and the "viewing as
   * member" pill — the controls that must stay reachable precisely BECAUSE the
   * effective flag has gone false. Everything that decides what the product
   * looks like uses {@link AuthState.isEffectiveGlobalAdmin} instead.
   */
  isGlobalAdmin: () => boolean;
  /**
   * The flag every piece of CHROME asks: admin, and not currently pretending
   * otherwise.
   *
   * Sidebar sections, palette rows, the org switcher's admin footer and
   * `RequireGlobalAdmin` all read this. Nothing on the server does.
   */
  isEffectiveGlobalAdmin: () => boolean;
  /** Enter or leave member view. Persists; the navigation is the caller's. */
  setViewingAsMember: (value: boolean) => void;
  /** Store a freshly issued session (login, invite acceptance, refresh). */
  setSession: (session: AuthSession) => void;
  /**
   * Replace only the token pair, keeping the user summary — what the
   * single-flight refresh in `lib/api.ts` writes back after a rotation.
   */
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
  /**
   * Replace only the user summary, keeping the tokens — what `useMe()` writes
   * back after `GET /auth/me`, and what `useUpdateMe()` writes after a profile
   * edit.
   *
   * WHY THE SESSION NEEDS THIS. The persisted `user` is a SNAPSHOT of whatever
   * `POST /auth/login` returned, and it can be days old: a name change, an
   * avatar, a locale, or a revoked `isGlobalAdmin` flag would otherwise stay
   * wrong in the topbar and the sidebar until the next sign-in. `/auth/me` is
   * the authority, and this is where its answer lands.
   *
   * A no-op when the reference is unchanged, because every component calling
   * `useMe()` writes the same cached object on every render pass.
   */
  setUser: (user: AuthUser) => void;
  /** Drop everything. Called on sign-out and when a refresh definitively fails. */
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      sessionGeneration: 0,
      viewingAsMember: loadViewingAsMember(),

      isAuthenticated: () => get().accessToken !== null,
      isGlobalAdmin: () => get().user?.isGlobalAdmin === true,
      isEffectiveGlobalAdmin: () => get().isGlobalAdmin() && !get().viewingAsMember,

      setViewingAsMember: (value) => {
        persistViewingAsMember(value);
        set({ viewingAsMember: value });
      },

      setSession: ({ accessToken, refreshToken, user }) => {
        set({ accessToken, refreshToken, user, sessionGeneration: get().sessionGeneration + 1 });
      },

      setTokens: ({ accessToken, refreshToken }) => {
        set({ accessToken, refreshToken });
      },

      setUser: (user) => {
        if (get().user === user) return;
        set({ user });
      },

      clearSession: () => {
        // The view preference is dropped WITH the session, deliberately. It is
        // persisted so it survives a reload, not so it survives a change of
        // person: the next admin to sign in on this device would otherwise
        // arrive to a console with no Administration section and no idea why.
        persistViewingAsMember(false);
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          viewingAsMember: false,
          sessionGeneration: get().sessionGeneration + 1,
        });
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only the data, never the actions. Persisting a function is impossible
      // anyway, but being explicit also means a future derived field does not
      // silently become part of the stored payload. `sessionGeneration` is
      // deliberately absent — it is an in-tab comparison, not stored state —
      // and so is `viewingAsMember`, which owns `fb-view-mode-v1` for the
      // reason spelled out above `loadViewingAsMember`.
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    },
  ),
);
