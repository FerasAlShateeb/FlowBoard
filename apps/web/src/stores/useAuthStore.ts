import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { LoginResponse, User } from '@flowboard/shared';

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
  /** True once a token exists. NOT proof it is still valid — see RequireAuth. */
  isAuthenticated: () => boolean;
  /** Global-admin flag from the last session payload; the API re-checks it. */
  isGlobalAdmin: () => boolean;
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

      isAuthenticated: () => get().accessToken !== null,
      isGlobalAdmin: () => get().user?.isGlobalAdmin === true,

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
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
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
      // deliberately absent — it is an in-tab comparison, not stored state.
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    },
  ),
);
