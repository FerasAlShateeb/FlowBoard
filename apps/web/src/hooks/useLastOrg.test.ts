import { beforeEach, describe, expect, it } from 'vitest';
import type { OrgWithRole } from '@flowboard/shared';

import {
  clearLastOrgSlug,
  getLastOrgSlug,
  LAST_ORG_STORAGE_KEY,
  resolveHomeTarget,
  setLastOrgSlug,
} from '@/hooks/useLastOrg';

/**
 * Where `/` sends someone.
 *
 * This is the most-executed decision in the product — every cold boot, every
 * brand-mark click, every "All organizations" — and it is now also an ESCAPE
 * ROUTE: `/` is where the sidebar's Home row, the switcher's footer and the
 * admin console's way out all land. A wrong answer here is not a cosmetic bug,
 * it is a user who cannot get anywhere.
 */

function org(slug: string): OrgWithRole {
  return {
    id: `id-${slug}`,
    name: slug,
    slug,
    role: 'member',
    memberCount: 1,
    projectCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as OrgWithRole;
}

const ACME = org('acme');
const GLOBEX = org('globex');

beforeEach(() => {
  clearLastOrgSlug();
});

describe('resolveHomeTarget — multi-org mode', () => {
  it('waits while the org list is still loading', () => {
    expect(resolveHomeTarget(undefined, null)).toBeNull();
    expect(resolveHomeTarget(undefined, 'acme')).toBeNull();
  });

  it('resumes in the remembered org when the user is still a member', () => {
    expect(resolveHomeTarget([ACME, GLOBEX], 'globex')).toEqual({ kind: 'org', slug: 'globex' });
  });

  /** A removed member must land on the picker, not on a 403. */
  it('ignores a remembered org the user is no longer in', () => {
    expect(resolveHomeTarget([ACME, GLOBEX], 'departed')).toEqual({ kind: 'picker' });
  });

  it('short-circuits to the only org — a picker with one card teaches nothing', () => {
    expect(resolveHomeTarget([ACME], null)).toEqual({ kind: 'org', slug: 'acme' });
    expect(resolveHomeTarget([ACME], 'departed')).toEqual({ kind: 'org', slug: 'acme' });
  });

  it('offers the picker when there is a genuine choice', () => {
    expect(resolveHomeTarget([ACME, GLOBEX], null)).toEqual({ kind: 'picker' });
  });

  it('offers the picker (with its empty state) when there are no orgs at all', () => {
    expect(resolveHomeTarget([], null)).toEqual({ kind: 'picker' });
    expect(resolveHomeTarget([], 'acme')).toEqual({ kind: 'picker' });
  });

  it('ignores the instance default in multi mode — it is a single-mode setting', () => {
    expect(resolveHomeTarget([ACME, GLOBEX], null, 'globex', 'multi')).toEqual({ kind: 'picker' });
  });
});

describe('resolveHomeTarget — single-org mode', () => {
  it('goes straight to the instance org', () => {
    expect(resolveHomeTarget([ACME], null, 'acme', 'single')).toEqual({
      kind: 'org',
      slug: 'acme',
    });
  });

  /**
   * The whole point of the short-circuit: the config already answered, so `/`
   * must not sit on a spinner waiting for a list it is not going to read.
   */
  it('decides without the org list, and without waiting for it', () => {
    expect(resolveHomeTarget(undefined, null, 'acme', 'single')).toEqual({
      kind: 'org',
      slug: 'acme',
    });
  });

  it('overrides the remembered org — one workspace means one destination', () => {
    expect(resolveHomeTarget([ACME, GLOBEX], 'globex', 'acme', 'single')).toEqual({
      kind: 'org',
      slug: 'acme',
    });
  });

  /** A freshly installed instance: single mode, no organization yet. */
  it('falls through to the picker when the instance has no default org', () => {
    expect(resolveHomeTarget([], null, null, 'single')).toEqual({ kind: 'picker' });
    expect(resolveHomeTarget(undefined, null, null, 'single')).toEqual({ kind: 'picker' });
  });
});

describe('the remembered slug', () => {
  it('round-trips through storage under the `fb-<name>-v1` convention', () => {
    expect(LAST_ORG_STORAGE_KEY).toBe('fb-last-org-v1');
    expect(getLastOrgSlug()).toBeNull();

    setLastOrgSlug('acme');
    expect(getLastOrgSlug()).toBe('acme');

    clearLastOrgSlug();
    expect(getLastOrgSlug()).toBeNull();
  });

  it('treats an empty stored value as "nothing remembered"', () => {
    localStorage.setItem(LAST_ORG_STORAGE_KEY, '');
    expect(getLastOrgSlug()).toBeNull();
  });
});
