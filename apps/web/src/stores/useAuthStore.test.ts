import { beforeEach, describe, expect, it } from 'vitest';

import { AUTH_STORAGE_KEY, useAuthStore, type AuthUser } from '@/stores/useAuthStore';

/**
 * The session store.
 *
 * Most of it is a bag of fields, and the suites that exercise it in anger live
 * in `lib/api.test.ts` (the single-flight refresh) and the route guards. What
 * is asserted HERE is the one rule that is not obvious from reading the store:
 * WHICH writes count as a change of identity, and therefore bump
 * `sessionGeneration`.
 *
 * That counter is what lets an in-flight refresh discover it has been
 * superseded, so getting its bump set wrong re-opens the "logout undone by a
 * racing refresh" bug in a way nothing else would catch — a rotation that
 * bumped it would break every refresh instead, equally silently.
 */

const USER: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ada@flowboard.dev',
  name: 'Ada Lovelace',
  avatarUrl: null,
  isGlobalAdmin: false,
  locale: 'en',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SESSION = { user: USER, accessToken: 'access-1', refreshToken: 'refresh-1' };

beforeEach(() => {
  useAuthStore.setState({
    accessToken: null,
    refreshToken: null,
    user: null,
    sessionGeneration: 0,
  });
});

describe('sessionGeneration', () => {
  it('starts at zero', () => {
    expect(useAuthStore.getState().sessionGeneration).toBe(0);
  });

  it('bumps on setSession — a new identity', () => {
    useAuthStore.getState().setSession(SESSION);

    expect(useAuthStore.getState().sessionGeneration).toBe(1);
  });

  it('bumps on clearSession — the absence of an identity is also one', () => {
    useAuthStore.getState().setSession(SESSION);
    useAuthStore.getState().clearSession();

    expect(useAuthStore.getState().sessionGeneration).toBe(2);
  });

  it('does NOT bump on setTokens — a rotation is the same session', () => {
    useAuthStore.getState().setSession(SESSION);
    const before = useAuthStore.getState().sessionGeneration;

    useAuthStore.getState().setTokens({ accessToken: 'access-2', refreshToken: 'refresh-2' });

    expect(useAuthStore.getState().sessionGeneration).toBe(before);
    expect(useAuthStore.getState().accessToken).toBe('access-2');
  });

  it('does NOT bump on setUser — a profile edit is not a sign-in', () => {
    useAuthStore.getState().setSession(SESSION);
    const before = useAuthStore.getState().sessionGeneration;

    useAuthStore.getState().setUser({ ...USER, name: 'Ada L.' });

    expect(useAuthStore.getState().sessionGeneration).toBe(before);
  });

  /**
   * Sign out, sign in, and the OLD refresh lands. A boolean "was it cleared?"
   * flag would read `false` here (a session exists again) and let the stale
   * pair overwrite the new one. Only a value that never repeats separates
   * these two moments, which is the whole argument for a counter.
   */
  it('never returns to a value it has already had', () => {
    const seen = new Set<number>([useAuthStore.getState().sessionGeneration]);

    for (const step of [1, 2, 3]) {
      useAuthStore.getState().setSession({ ...SESSION, accessToken: `access-${String(step)}` });
      seen.add(useAuthStore.getState().sessionGeneration);
      useAuthStore.getState().clearSession();
      seen.add(useAuthStore.getState().sessionGeneration);
    }

    expect(seen.size).toBe(7);
  });
});

describe('persistence', () => {
  it('keeps the counter OUT of storage — it compares two moments in one tab', () => {
    useAuthStore.getState().setSession(SESSION);

    const stored: unknown = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? '{}');
    const state = (stored as { state?: Record<string, unknown> }).state ?? {};

    expect(Object.keys(state).sort()).toEqual(['accessToken', 'refreshToken', 'user']);
  });
});
