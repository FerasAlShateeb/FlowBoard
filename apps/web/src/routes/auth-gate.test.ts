import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api';
import { isSessionRejection, resolveAuthGate, returnToPath } from '@/routes/auth-gate';

/**
 * The guard's decision table.
 *
 * `RequireAuth` is four `if`s and a redirect, but getting one of them wrong is
 * either a lock-out (signing someone out because a 500 came back) or a leak (a
 * revoked session that keeps rendering the shell). The decision is a pure
 * function precisely so it can be enumerated here without a DOM.
 */
describe('resolveAuthGate', () => {
  it('sends a visitor with no token to sign in', () => {
    expect(resolveAuthGate({ hasToken: false, hasUser: false, error: null })).toBe('signed-out');
  });

  it('ignores a stale user when the token is gone', () => {
    // Signing out clears the token first; a user still sitting in a cache must
    // not keep the shell alive.
    expect(resolveAuthGate({ hasToken: false, hasUser: true, error: null })).toBe('signed-out');
  });

  it('holds the route while /auth/me is still in flight', () => {
    expect(resolveAuthGate({ hasToken: true, hasUser: false, error: null })).toBe('checking');
  });

  it('renders once the session has been validated', () => {
    expect(resolveAuthGate({ hasToken: true, hasUser: true, error: null })).toBe('allowed');
  });

  it('rejects on a 401 — the "expired while away" case', () => {
    const error = new ApiError('nope', 401, 'token_invalid');
    expect(resolveAuthGate({ hasToken: true, hasUser: false, error })).toBe('rejected');
  });

  it('rejects on a 403 — a deactivated account can surface either way', () => {
    const error = new ApiError('nope', 403, 'account_disabled');
    expect(resolveAuthGate({ hasToken: true, hasUser: false, error })).toBe('rejected');
  });

  it('rejects even when a stale user is still cached', () => {
    const error = new ApiError('nope', 401, 'token_invalid');
    expect(resolveAuthGate({ hasToken: true, hasUser: true, error })).toBe('rejected');
  });

  it('does NOT sign anyone out because the server hiccupped', () => {
    // The judgement call: only a verdict FROM THE SERVER ABOUT THE TOKEN ends a
    // session. A 500 or a dropped connection lets the app through to its own
    // error states.
    const serverError = new ApiError('boom', 500, 'internal_error');
    expect(resolveAuthGate({ hasToken: true, hasUser: false, error: serverError })).toBe('allowed');

    const networkError = new ApiError('offline', 0, 'network_error');
    expect(resolveAuthGate({ hasToken: true, hasUser: false, error: networkError })).toBe(
      'allowed',
    );
  });

  it('does not return to a splash once a user has been seen', () => {
    // A background refetch failing must not blank a working screen.
    const serverError = new ApiError('boom', 502, 'internal_error');
    expect(resolveAuthGate({ hasToken: true, hasUser: true, error: serverError })).toBe('allowed');
  });
});

describe('isSessionRejection', () => {
  it('only treats an ApiError as a verdict about the token', () => {
    expect(isSessionRejection(new Error('401'))).toBe(false);
    expect(isSessionRejection('401')).toBe(false);
    expect(isSessionRejection(null)).toBe(false);
  });

  it('accepts 401 and 403 and nothing else', () => {
    expect(isSessionRejection(new ApiError('x', 401, 'a'))).toBe(true);
    expect(isSessionRejection(new ApiError('x', 403, 'a'))).toBe(true);
    expect(isSessionRejection(new ApiError('x', 404, 'a'))).toBe(false);
    expect(isSessionRejection(new ApiError('x', 500, 'a'))).toBe(false);
  });
});

describe('returnToPath', () => {
  it('preserves the query string of a deep link', () => {
    expect(returnToPath('/o/acme/p/FB/board', '?assignee=me')).toBe(
      '/o/acme/p/FB/board?assignee=me',
    );
  });

  it('refuses to stash /login, which would bounce a fresh sign-in', () => {
    expect(returnToPath('/login', '')).toBeNull();
  });
});
