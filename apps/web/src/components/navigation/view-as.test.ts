import { describe, expect, it } from 'vitest';

import {
  isAdminPath,
  viewChangeBounceTarget,
  VIEW_MODE_STORAGE_KEY,
} from '@/components/navigation/view-as';

/**
 * The two rules behind "view as member".
 *
 * Extracted from the toggle handler precisely so they can be asserted without a
 * router: the bounce is a one-line condition that decides whether an admin ends
 * up looking at a refusal screen, and a one-line condition is exactly what gets
 * inverted during a refactor with nothing to notice.
 */

describe('isAdminPath', () => {
  it.each([
    ['/admin', true],
    ['/admin/users', true],
    ['/admin/analytics/traffic', true],
    ['/', false],
    ['/o/acme', false],
    ['/me', false],
    // Not a false positive on a route that merely STARTS with the letters.
    ['/administration', false],
    ['/o/acme/p/ADMIN/board', false],
  ])('%s → %s', (pathname, expected) => {
    expect(isAdminPath(pathname)).toBe(expected);
  });
});

describe('viewChangeBounceTarget', () => {
  it('bounces to Home when member view is switched ON inside the console', () => {
    expect(viewChangeBounceTarget('/admin/users', true)).toBe('/');
    expect(viewChangeBounceTarget('/admin', true)).toBe('/');
  });

  it('stays put when member view is switched on ANYWHERE else', () => {
    expect(viewChangeBounceTarget('/o/acme/p/FLOW/board', true)).toBeNull();
    expect(viewChangeBounceTarget('/', true)).toBeNull();
  });

  /**
   * Returning to admin view only ADDS surfaces, so there is nothing to escape
   * from — and navigating would throw away the page the admin was reading.
   */
  it('never bounces on the way BACK to administrator view', () => {
    expect(viewChangeBounceTarget('/admin/users', false)).toBeNull();
    expect(viewChangeBounceTarget('/o/acme', false)).toBeNull();
  });
});

describe('storage key', () => {
  it('follows the `fb-<name>-v1` convention', () => {
    expect(VIEW_MODE_STORAGE_KEY).toBe('fb-view-mode-v1');
  });
});
